"""
Web Search Tool — Enhanced with Parallel Search (First-Wins)

Replaces the existing WebSearchTool with parallel search capability.
"""
import structlog
from typing import Dict, Any, Optional, List
from tools.base import BaseTool, RiskLevel, ToolResult
from tools.parallel_search import get_parallel_search

logger = structlog.get_logger()


class WebSearchTool(BaseTool):
    """Search the web using parallel first-wins strategy."""

    name = "web_search"
    description = "Search the web for information. Uses parallel first-wins across multiple engines."
    schema = {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "Search query"},
            "max_results": {"type": "integer", "default": 5, "description": "Maximum number of results"},
        },
        "required": ["query"],
    }
    risk_level = RiskLevel.SAFE

    def __init__(self):
        self.parallel = get_parallel_search()

    async def execute(self, args: Dict[str, Any]) -> ToolResult:
        query = args.get("query", "")
        max_results = args.get("max_results", 5)

        if not query:
            return ToolResult(success=False, result=None, error="Empty query")

        logger.info("Parallel web search", query=query[:50])

        result = await self.parallel.search(query, max_results)

        if result["success"]:
            # Format results for display
            formatted_results = []
            for i, r in enumerate(result["results"]):
                formatted_results.append({
                    "rank": i + 1,
                    "title": r.get("title", ""),
                    "url": r.get("url", ""),
                    "snippet": r.get("snippet", ""),
                })

            return ToolResult(
                success=True,
                result={
                    "results": formatted_results,
                    "engine_used": result["engine_used"],
                    "fallback_used": result.get("fallback_used", False),
                },
            )
        else:
            return ToolResult(
                success=False,
                result=None,
                error="All search engines failed or timed out",
            )


web_search_tool = WebSearchTool()