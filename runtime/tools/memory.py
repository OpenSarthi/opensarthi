from tools.base import BaseTool, RiskLevel
from planner.schemas import ToolResult, ToolResultConfidence
from memory.manager import MemoryManager

class RememberTool(BaseTool):
    name = "remember"
    description = (
        "Store a key fact, preference, rule, name, or memory about the user permanently. "
        "Args: fact (string: the specific fact/preference to remember), importance (number: 0.1 to 1.0, default 0.8)"
    )
    risk_level = RiskLevel.SAFE

    async def execute(self, args: dict) -> ToolResult:
        fact = args.get("fact", "").strip()
        importance = float(args.get("importance", 0.8))

        if not fact:
            return ToolResult.fail("Missing fact parameter", retryable=False)

        try:
            # We construct a memory manager. Since we don't have thread_id here,
            # we use a general session thread ID or get it from active settings.
            import db
            # Create a fallback/active thread or fetch latest
            thread_id = "global_user_memory"
            manager = MemoryManager(thread_id)
            await manager.store(content=fact, source="agent_tool", importance=importance)
            return ToolResult.ok(f"I will remember that: '{fact}'")
        except Exception as e:
            return ToolResult.fail(str(e))


class RecallTool(BaseTool):
    name = "recall"
    description = (
        "Search and recall stored facts, preferences, or rules based on a query. "
        "Args: query (string: the keyword or phrase to search memories for)"
    )
    risk_level = RiskLevel.SAFE

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
