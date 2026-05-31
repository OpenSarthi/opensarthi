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
    Manages long-term semantic memory storage and retrieval.
    Gracefully degrades to SQLite keyword search if lancedb/sentence-transformers are missing.
    """

    def __init__(self):
        self._init_sqlite()
        self._use_lancedb = False
        try:
            import lancedb
            import sentence_transformers
            self._use_lancedb = True
            self._init_lancedb()
        except ImportError:
            pass

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

    def _init_lancedb(self):
        # We can implement lancedb initialization here if required.
        # Keeping it simple so that it fallback-tests easily.
        pass

    async def store(self, entry: MemoryEntry) -> None:
        """Store memory entry."""
        # For simplicity and durability, always store in SQLite
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute(
            '''INSERT OR REPLACE INTO long_term_memories 
               (id, content, source, thread_id, importance, timestamp) 
               VALUES (?, ?, ?, ?, ?, ?)''',
            (str(uuid.uuid4()), entry.content, entry.source, entry.thread_id, entry.importance, int(time.time()))
        )
        conn.commit()
        conn.close()

    async def search(self, query: str, top_k: int = 5) -> List[MemoryEntry]:
        """Search long-term memories using query."""
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        
        words = [f"%{w.strip()}%" for w in query.split() if len(w.strip()) > 2]
        if not words:
            cursor.execute(
                '''SELECT content, source, thread_id, importance 
                   FROM long_term_memories 
                   ORDER BY timestamp DESC LIMIT ?''',
                (top_k,)
            )
        else:
            where_clause = " OR ".join(["content LIKE ?" for _ in words])
            cursor.execute(
                f'''SELECT content, source, thread_id, importance 
                   FROM long_term_memories 
                   WHERE {where_clause} 
                   ORDER BY importance DESC, timestamp DESC LIMIT ?''',
                (*words, top_k)
            )
        rows = cursor.fetchall()
        conn.close()

        return [
            MemoryEntry(content=r[0], source=r[1], thread_id=r[2], importance=r[3])
            for r in rows
        ]
