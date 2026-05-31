from typing import List, Dict, Any, Optional
from memory.short_term import ShortTermMemory
from memory.long_term import LongTermMemory, MemoryEntry

class MemoryManager:
    """
    Unified manager coordinating short-term (SQLite messages) and long-term (semantic SQLite/vector) memory.
    """

    def __init__(self, thread_id: str):
        self.thread_id = thread_id
        self.short = ShortTermMemory(thread_id)
        self.long = LongTermMemory()

    async def store(self, content: str, source: str, importance: float = 0.5) -> None:
        """Store a new memory entry."""
        entry = MemoryEntry(content=content, source=source, thread_id=self.thread_id, importance=importance)
        # Short term addition is handled by save_message in db
        if importance >= 0.7:
            await self.long.store(entry)

    async def recall(self, query: str, top_k: int = 5) -> List[MemoryEntry]:
        """Recall semantically relevant memories from long-term memory."""
        return await self.long.search(query, top_k=top_k)

    def get_context_window(self, max_messages: int = 20) -> List[Dict[str, Any]]:
        """Retrieve recent conversation history."""
        return self.short.get_recent(max_messages)
