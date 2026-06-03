import sqlite3
import time
import uuid
from typing import List, Optional
from db import DB_PATH

class MemoryEntry:
    def __init__(self, content: str, source: str, thread_id: str, importance: float = 0.5):
        self.content = content
        self.source = source
        self.thread_id = thread_id
        self.importance = importance

class LongTermMemory:
    """
    Long-term semantic memory with two-tier search:
    1. sentence-transformers + cosine similarity (if available, local, offline)
    2. SQLite LIKE keyword search (fallback, always available)

    Embeddings are computed locally using all-MiniLM-L6-v2 (22MB model,
    downloaded once to ~/.cache/torch/sentence_transformers).
    """

    def __init__(self):
        self._init_sqlite()
        self._encoder = None
        self._use_semantic = False
        self._try_load_encoder()

    def _try_load_encoder(self):
        """Try to load the local sentence-transformers model. Non-fatal if unavailable."""
        try:
            from sentence_transformers import SentenceTransformer
            import numpy as np
            self._encoder = SentenceTransformer("all-MiniLM-L6-v2")
            self._use_semantic = True
            import structlog
            structlog.get_logger().info("Semantic memory activated (all-MiniLM-L6-v2)")
            self._migrate_embedding_column()
        except Exception as e:
            import structlog
            structlog.get_logger().info(
                "Semantic memory unavailable — falling back to keyword search",
                reason=str(e)
            )

    def _init_sqlite(self):
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS long_term_memories (
                id TEXT PRIMARY KEY,
                content TEXT,
                source TEXT,
                thread_id TEXT,
                importance REAL,
                timestamp INTEGER
            )
        ''')
        conn.commit()
        conn.close()

    def _migrate_embedding_column(self):
        """Add embedding column if it doesn't exist (safe migration)."""
        try:
            conn = sqlite3.connect(DB_PATH)
            cursor = conn.cursor()
            cursor.execute("PRAGMA table_info(long_term_memories)")
            columns = [row[1] for row in cursor.fetchall()]
            if "embedding" not in columns:
                cursor.execute("ALTER TABLE long_term_memories ADD COLUMN embedding BLOB")
                conn.commit()
                import structlog
                structlog.get_logger().info("Added embedding column to long_term_memories")
            conn.close()
        except Exception as e:
            import structlog
            structlog.get_logger().warning("Could not add embedding column", error=str(e))

    def _encode(self, text: str):
        """Encode text to embedding vector. Returns numpy array or None."""
        if not self._use_semantic or self._encoder is None:
            return None
        try:
            vec = self._encoder.encode(text, normalize_embeddings=True)
            return vec
        except Exception:
            return None

    def _cosine_sim(self, a, b) -> float:
        """Cosine similarity between two normalized numpy arrays."""
        try:
            import numpy as np
            return float(np.dot(a, b))
        except Exception:
            return 0.0

    async def store(self, entry: MemoryEntry) -> None:
        """Store memory entry with optional embedding."""
        import asyncio
        embedding_bytes = None
        if self._use_semantic:
            try:
                loop = asyncio.get_running_loop()
                vec = await loop.run_in_executor(None, self._encode, entry.content)
                if vec is not None:
                    import numpy as np
                    embedding_bytes = vec.astype("float32").tobytes()
            except Exception:
                pass

        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        if self._use_semantic:
            cursor.execute(
                '''INSERT OR REPLACE INTO long_term_memories
                   (id, content, source, thread_id, importance, timestamp, embedding)
                   VALUES (?, ?, ?, ?, ?, ?, ?)''',
                (str(uuid.uuid4()), entry.content, entry.source, entry.thread_id,
                 entry.importance, int(time.time()), embedding_bytes)
            )
        else:
            cursor.execute(
                '''INSERT OR REPLACE INTO long_term_memories
                   (id, content, source, thread_id, importance, timestamp)
                   VALUES (?, ?, ?, ?, ?, ?)''',
                (str(uuid.uuid4()), entry.content, entry.source, entry.thread_id,
                 entry.importance, int(time.time()))
            )
        conn.commit()
        conn.close()

    async def search(self, query: str, top_k: int = 5) -> List[MemoryEntry]:
        """
        Search using semantic similarity if available, otherwise keyword search.
        Results are sorted by relevance.
        """
        import asyncio

        if self._use_semantic:
            try:
                loop = asyncio.get_running_loop()
                query_vec = await loop.run_in_executor(None, self._encode, query)
                if query_vec is not None:
                    return await loop.run_in_executor(
                        None, self._semantic_search, query_vec, top_k
                    )
            except Exception:
                pass

        # Fallback to keyword search
        return self._keyword_search(query, top_k)

    def _semantic_search(self, query_vec, top_k: int) -> List[MemoryEntry]:
        """Cosine similarity search over all stored embeddings."""
        import numpy as np

        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute(
            "SELECT content, source, thread_id, importance, embedding "
            "FROM long_term_memories WHERE embedding IS NOT NULL "
            "ORDER BY importance DESC, timestamp DESC LIMIT 500"
        )
        rows = cursor.fetchall()
        conn.close()

        scored = []
        for content, source, thread_id, importance, emb_blob in rows:
            if not emb_blob:
                continue
            try:
                vec = np.frombuffer(emb_blob, dtype="float32")
                if len(vec) != len(query_vec):
                    continue
                sim = self._cosine_sim(query_vec, vec)
                # Boost by importance; filter low-relevance matches
                if sim >= 0.20:
                    scored.append((sim * 0.7 + importance * 0.3, content, source, thread_id, importance))
            except Exception:
                continue

        scored.sort(key=lambda x: -x[0])
        return [
            MemoryEntry(content=r[1], source=r[2], thread_id=r[3], importance=r[4])
            for r in scored[:top_k]
        ]

    def _keyword_search(self, query: str, top_k: int) -> List[MemoryEntry]:
        """SQLite LIKE-based keyword search fallback."""
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()

        words = [f"%{w.strip()}%" for w in query.split() if len(w.strip()) > 2]
        if not words:
            cursor.execute(
                "SELECT content, source, thread_id, importance "
                "FROM long_term_memories ORDER BY timestamp DESC LIMIT ?",
                (top_k,)
            )
        else:
            where_clause = " OR ".join(["content LIKE ?" for _ in words])
            cursor.execute(
                f"SELECT content, source, thread_id, importance "
                f"FROM long_term_memories WHERE {where_clause} "
                f"ORDER BY importance DESC, timestamp DESC LIMIT ?",
                (*words, top_k)
            )
        rows = cursor.fetchall()
        conn.close()

        return [
            MemoryEntry(content=r[0], source=r[1], thread_id=r[2], importance=r[3])
            for r in rows
        ]
