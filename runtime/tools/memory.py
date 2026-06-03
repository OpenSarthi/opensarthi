from tools.base import BaseTool, RiskLevel
from planner.schemas import ToolResult, ToolResultConfidence
from memory.manager import MemoryManager

class RememberTool(BaseTool):
    name = "remember"
    description = "Store a fact, preference, name, or rule about the user permanently in long-term memory."
    risk_level = RiskLevel.SAFE
    schema = {
        "type": "object",
        "properties": {
            "fact": {"type": "string", "description": "The specific fact, preference, or rule to remember, written as a complete sentence"},
            "importance": {"type": "number", "description": "Importance score from 0.1 (trivial) to 1.0 (critical), default 0.8"},
        },
        "required": ["fact"],
    }

    async def execute(self, args: dict) -> ToolResult:
        fact = args.get("fact", "").strip()
        importance = float(args.get("importance", 0.8))

        if not fact:
            return ToolResult.fail("Missing fact parameter", retryable=False)

        try:
            thread_id = "global_user_memory"
            manager = MemoryManager(thread_id)
            await manager.store(content=fact, source="agent_tool", importance=importance)
            return ToolResult.ok(f"I will remember that: '{fact}'")
        except Exception as e:
            return ToolResult.fail(str(e))


class RecallTool(BaseTool):
    name = "recall"
    description = "Search and retrieve stored facts, preferences, or rules from long-term memory based on a query."
    risk_level = RiskLevel.SAFE
    schema = {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "Keyword or phrase to search memories for, e.g. 'user name', 'coffee preference'"},
        },
        "required": ["query"],
    }

    async def execute(self, args: dict) -> ToolResult:
        query = args.get("query", "").strip()
        if not query:
            return ToolResult.fail("Missing query parameter", retryable=False)

        try:
            thread_id = "global_user_memory"
            manager = MemoryManager(thread_id)
            results = await manager.recall(query, top_k=5)
            if not results:
                return ToolResult.ok("No matching memories found for this query.")
            
            summary = "\n".join([f"- {r.content}" for r in results])
            return ToolResult.ok(f"Recalled memories:\n{summary}")
        except Exception as e:
            return ToolResult.fail(str(e))


class ForgetMemoryTool(BaseTool):
    name = "forget_memory"
    description = (
        "Forget a specific stored memory. Use when the user says 'forget that I...', "
        "'I don't X anymore', or corrects something you stored. "
        "Searches for and removes the best matching memory."
    )
    risk_level = RiskLevel.SAFE
    schema = {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "Topic or phrase to search and remove from memory, e.g. 'coffee preference', 'lives in Mumbai'"},
        },
        "required": ["query"],
    }

    async def execute(self, args: dict) -> ToolResult:
        query = args.get("query", "").strip()
        if not query:
            return ToolResult.fail("Missing query parameter", retryable=False)

        try:
            import sqlite3
            from db import DB_PATH

            conn = sqlite3.connect(DB_PATH)
            cursor = conn.cursor()
            words = [f"%{w.strip()}%" for w in query.split() if len(w.strip()) > 2]
            if not words:
                conn.close()
                return ToolResult.fail("Query too short to identify a specific memory", retryable=False)

            where_clause = " OR ".join(["content LIKE ?" for _ in words])
            cursor.execute(
                f"SELECT id, content FROM long_term_memories WHERE {where_clause} ORDER BY importance DESC LIMIT 1",
                words
            )
            row = cursor.fetchone()
            if not row:
                conn.close()
                return ToolResult.ok(f"No stored memory matched '{query}'. Nothing was deleted.")

            memory_id, content = row
            cursor.execute("DELETE FROM long_term_memories WHERE id = ?", (memory_id,))
            conn.commit()
            conn.close()
            return ToolResult.ok(f"Forgotten: '{content[:100]}'")
        except Exception as e:
            return ToolResult.fail(str(e))
