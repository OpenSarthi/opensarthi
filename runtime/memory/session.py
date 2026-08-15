"""
Session Memory Manager — Mark-L Style

Replaces the simple sliding window with efficient 1-2 sentence summaries
that are consumed after use (never re-summarized).

Key properties:
- Consumed after use: Once injected, marked consumed=TRUE
- Never repeats: Each summary covers only new turns since last summary
- Fast model: Uses gemini-2.5-flash or equivalent for near-instant summarization
- Replaces context compaction: More efficient than rolling LLM summaries
"""
import asyncio
import json
import sqlite3
import structlog
import uuid
from typing import Optional, List, Dict, Any
from datetime import datetime
from pathlib import Path
import os

from config import settings, get_active_api_key

logger = structlog.get_logger()

# Database path
USER_CONFIG_DIR = Path.home() / ".config" / "opensarthi"
DB_PATH = str(USER_CONFIG_DIR / "opensarthi.db")


def init_session_db():
    """Create session_memories table if it doesn't exist."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS session_memories (
            id TEXT PRIMARY KEY,
            thread_id TEXT NOT NULL,
            summary TEXT NOT NULL,
            turns_covered INTEGER,
            model_used TEXT,
            created_at REAL NOT NULL,
            consumed BOOLEAN DEFAULT FALSE
        )
    ''')
    conn.commit()
    conn.close()


init_session_db()


class SessionMemoryManager:
    """
    Manages Mark-L style session memory: 1-2 sentence summaries consumed after use.
    """

    def __init__(self, thread_id: str):
        self.thread_id = thread_id
        self.turns_since_summary = 0
        self._summary_task: Optional[asyncio.Task] = None

    async def add_turn(self, role: str, content: str):
        """Record a new turn and check if summarization is needed."""
        self.turns_since_summary += 1

        if self.turns_since_summary >= settings.session_memory_turns:
            await self.create_session_summary()
            self.turns_since_summary = 0

    async def create_session_summary(self):
        """Create a new session summary using fast flash model."""
        try:
            # Fetch last N messages from DB
            messages = await self._get_recent_messages(settings.session_memory_turns)
            if not messages:
                return

            # Format for summarization
            conversation = "\n".join([
                f"{m['role'].upper()}: {str(m['content'])[:500]}"
                for m in messages
            ])

            # Generate summary using fast model
            summary = await self._summarize(conversation)
            if not summary:
                return

            # Store in DB
            await self._store_summary(summary)

            # Mark previous as consumed
            await self._mark_previous_consumed()

            logger.info("Session summary created", thread_id=self.thread_id, turns=len(messages))

        except Exception as e:
            logger.error("Session summary creation failed", error=str(e))

    async def get_active_summary(self) -> Optional[str]:
        """Get the latest unconsumed summary for context injection."""
        try:
            conn = sqlite3.connect(DB_PATH)
            cursor = conn.cursor()
            cursor.execute(
                "SELECT summary FROM session_memories WHERE thread_id = ? AND consumed = FALSE ORDER BY created_at DESC LIMIT 1",
                (self.thread_id,)
            )
            row = cursor.fetchone()
            conn.close()
            return row[0] if row else None
        except Exception:
            return None

    async def consume_summary(self, summary: str):
        """Mark a summary as consumed after it's been injected into context."""
        try:
            conn = sqlite3.connect(DB_PATH)
            cursor = conn.cursor()
            cursor.execute(
                "UPDATE session_memories SET consumed = TRUE WHERE thread_id = ? AND summary = ? AND consumed = FALSE",
                (self.thread_id, summary)
            )
            conn.commit()
            conn.close()
        except Exception as e:
            logger.warning("Failed to mark summary consumed", error=str(e))

    async def _get_recent_messages(self, n: int) -> List[Dict]:
        """Fetch last N messages from DB."""
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute(
            "SELECT role, content FROM messages WHERE thread_id = ? ORDER BY timestamp DESC LIMIT ?",
            (self.thread_id, n)
        )
        rows = cursor.fetchall()
        conn.close()

        # Reverse to chronological order
        messages = [{"role": r[0], "content": r[1]} for r in reversed(rows)]
        return messages

    async def _summarize(self, text: str) -> Optional[str]:
        """Use fast model to create 1-2 sentence summary."""
        provider = settings.ai_provider.lower()
        api_key = get_active_api_key()

        if not api_key:
            # Fallback: simple extractive summary
            return self._fallback_summary(text)

        prompt = f"""Summarize this conversation in 1-2 sentences, focusing on key facts, decisions, and user preferences. Be concise and specific.

CONVERSATION:
{text[:3000]}

OUTPUT: A single 1-2 sentence summary only. No preamble."""

        try:
            if provider == "google":
                return await self._call_gemini(api_key, prompt, settings.session_memory_model)
            elif provider == "openai":
                return await self._call_openai(api_key, prompt, settings.session_memory_model)
            elif provider == "anthropic":
                return await self._call_anthropic(api_key, prompt, settings.session_memory_model)
            elif provider == "groq":
                return await self._call_groq(api_key, prompt, settings.session_memory_model)
            else:
                return self._fallback_summary(text)
        except Exception as e:
            logger.warning("Fast model summarization failed", error=str(e))
            return self._fallback_summary(text)

    async def _call_gemini(self, api_key: str, prompt: str, model: str) -> Optional[str]:
        """Call Gemini API for summarization."""
        import httpx
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
        async with httpx.AsyncClient() as client:
            response = await client.post(
                url,
                params={"key": api_key},
                json={"contents": [{"parts": [{"text": prompt}]}]},
                timeout=30,
            )
            response.raise_for_status()
            data = response.json()
            return data["candidates"][0]["content"]["parts"][0]["text"].strip()

    async def _call_openai(self, api_key: str, prompt: str, model: str) -> Optional[str]:
        """Call OpenAI API for summarization."""
        import httpx
        async with httpx.AsyncClient() as client:
            response = await client.post(
                "https://api.openai.com/v1/chat/completions",
                headers={"Authorization": f"Bearer {api_key}"},
                json={
                    "model": model,
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0.3,
                    "max_tokens": 150,
                },
                timeout=30,
            )
            response.raise_for_status()
            data = response.json()
            return data["choices"][0]["message"]["content"].strip()

    async def _call_anthropic(self, api_key: str, prompt: str, model: str) -> Optional[str]:
        """Call Anthropic API for summarization."""
        import httpx
        async with httpx.AsyncClient() as client:
            response = await client.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                json={
                    "model": model,
                    "max_tokens": 150,
                    "messages": [{"role": "user", "content": prompt}],
                },
                timeout=30,
            )
            response.raise_for_status()
            data = response.json()
            return data["content"][0]["text"].strip()

    async def _call_groq(self, api_key: str, prompt: str, model: str) -> Optional[str]:
        """Call Groq API for summarization."""
        import httpx
        async with httpx.AsyncClient() as client:
            response = await client.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={"Authorization": f"Bearer {api_key}"},
                json={
                    "model": model,
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0.3,
                    "max_tokens": 150,
                },
                timeout=30,
            )
            response.raise_for_status()
            data = response.json()
            return data["choices"][0]["message"]["content"].strip()

    def _fallback_summary(self, text: str) -> str:
        """Extractive fallback summary when no model available."""
        # Take first 2 sentences from user messages
        sentences = []
        for line in text.split("\n"):
            if line.startswith("USER:") and len(line) > 10:
                content = line[len("USER:"):].strip()
                sentences.append(content)
                if len(sentences) >= 2:
                    break
        if sentences:
            return " ".join(sentences)[:200]
        return "Conversation in progress."

    async def _store_summary(self, summary: str):
        """Store summary in DB."""
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO session_memories (id, thread_id, summary, turns_covered, model_used, created_at, consumed) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                str(uuid.uuid4()),
                self.thread_id,
                summary,
                settings.session_memory_turns,
                settings.session_memory_model,
                datetime.now().timestamp(),
                False,
            )
        )
        conn.commit()
        conn.close()

    async def _mark_previous_consumed(self):
        """Mark all previous summaries as consumed."""
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE session_memories SET consumed = TRUE WHERE thread_id = ? AND consumed = FALSE",
            (self.thread_id,)
        )
        # Keep only the most recent as unconsumed
        cursor.execute(
            "SELECT id FROM session_memories WHERE thread_id = ? ORDER BY created_at DESC LIMIT 1",
            (self.thread_id,)
        )
        latest_id = cursor.fetchone()
        if latest_id:
            cursor.execute(
                "UPDATE session_memories SET consumed = FALSE WHERE id = ?",
                (latest_id[0],)
            )
        conn.commit()
        conn.close()


# Global cache of session managers per thread
_session_managers: Dict[str, SessionMemoryManager] = {}

def get_session_manager(thread_id: str) -> SessionMemoryManager:
    """Get or create session manager for a thread."""
    if thread_id not in _session_managers:
        _session_managers[thread_id] = SessionMemoryManager(thread_id)
    return _session_managers[thread_id]
