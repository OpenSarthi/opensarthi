"""
Parallel Search — Mark-L Parity Feature

First-wins pattern: Launch multiple search engines concurrently,
return results from the first engine to respond with valid results.
"""
import asyncio
import structlog
from typing import Optional, Dict, Any, List
from concurrent.futures import TimeoutError

logger = structlog.get_logger()


class ParallelSearchEngine:
    """
    Executes searches across multiple engines in parallel.
    Returns results from the first engine to complete successfully.
    """

    def __init__(self, engines: List[str] = None, timeout: float = 8.0):
        from config import settings
        self.engines = engines or settings.search_engines
        self.timeout = timeout

    async def search(self, query: str, max_results: int = 5) -> Dict[str, Any]:
        """
        Run parallel search across configured engines.

        Returns:
            {
                "success": bool,
                "results": list,
                "engine_used": str,
                "fallback_used": bool,
            }
        """
        # Create tasks for each engine
        tasks = []
        for engine in self.engines:
            task = asyncio.create_task(
                self._search_with_engine(engine, query, max_results),
                name=engine
            )
            tasks.append((engine, task))

        # Wait for first successful result (first-wins)
        try:
            done, pending = await asyncio.wait(
                [t for _, t in tasks],
                timeout=self.timeout,
                return_when=asyncio.FIRST_COMPLETED
            )

            # Check completed tasks for success
            for task in done:
                try:
                    result = task.result()
                    if result and result.get("success"):
                        # Cancel pending tasks
                        for _, p in tasks:
                            if not p.done():
                                p.cancel()
                        return {
                            "success": True,
                            "results": result["results"],
                            "engine_used": result["engine"],
                            "fallback_used": False,
                        }
                except Exception as e:
                    logger.warning("Search task failed", error=str(e))

            # If we get here, no task succeeded but some completed
            # Try remaining pending tasks with longer timeout
            if pending:
                try:
                    done2, _ = await asyncio.wait(pending, timeout=self.timeout)
                    for task in done2:
                        try:
                            result = task.result()
                            if result and result.get("success"):
                                return {
                                    "success": True,
                                    "results": result["results"],
                                    "engine_used": result["engine"],
                                    "fallback_used": True,
                                }
                        except Exception:
                            pass
                except Exception:
                    pass

        except asyncio.TimeoutError:
            logger.warning("All search engines timed out")

        # Cancel any remaining tasks
        for _, task in tasks:
            if not task.done():
                task.cancel()

        return {
            "success": False,
            "results": [],
            "engine_used": None,
            "fallback_used": False,
        }

    async def _search_with_engine(self, engine: str, query: str, max_results: int) -> Optional[Dict]:
        """Execute search with a specific engine."""
        try:
            if engine == "duckduckgo":
                return await self._search_duckduckgo(query, max_results)
            elif engine == "gemini":
                return await self._search_gemini(query, max_results)
            elif engine == "brave":
                return await self._search_brave(query, max_results)
            else:
                logger.warning(f"Unknown search engine: {engine}")
                return None
        except Exception as e:
            logger.warning(f"Search engine {engine} failed", error=str(e))
            return None

    async def _search_duckduckgo(self, query: str, max_results: int) -> Dict:
        """Search via DuckDuckGo (no API key required)."""
        import httpx
        async with httpx.AsyncClient() as client:
            response = await client.get(
                "https://html.duckduckgo.com/html/",
                params={"q": query},
                headers={"User-Agent": "Mozilla/5.0 (compatible; OpenSarthi/1.0)"},
                timeout=8,
            )
            response.raise_for_status()
            # Parse results (simplified)
            from bs4 import BeautifulSoup
            soup = BeautifulSoup(response.text, "html.parser")
            results = []
            for result in soup.select(".result__a")[:max_results]:
                href = result.get("href", "")
                title = result.get_text(strip=True)
                if href and title:
                    results.append({"title": title, "url": href, "snippet": ""})
            return {"success": len(results) > 0, "engine": "duckduckgo", "results": results}

    async def _search_gemini(self, query: str, max_results: int) -> Dict:
        """Search via Gemini (uses inline search capability)."""
        from config import settings, get_active_api_key
        api_key = get_active_api_key()
        if not api_key:
            return {"success": False, "engine": "gemini", "results": []}

        import httpx
        # Use Gemini's built-in search via prompt
        prompt = f"Search the web for: {query}\nProvide {max_results} relevant results with title, URL, and brief description."

        url = f"https://generativelanguage.googleapis.com/v1beta/models/{settings.cloud_model}:generateContent"
        async with httpx.AsyncClient() as client:
            response = await client.post(
                url,
                params={"key": api_key},
                json={"contents": [{"parts": [{"text": prompt}]}]},
                timeout=10,
            )
            response.raise_for_status()
            data = response.json()
            text = data["candidates"][0]["content"]["parts"][0]["text"]

            # Parse results from text (best effort)
            results = self._parse_gemini_results(text, max_results)
            return {"success": len(results) > 0, "engine": "gemini", "results": results}

    async def _search_brave(self, query: str, max_results: int) -> Dict:
        """Search via Brave Search API."""
        from config import settings
        api_key = getattr(settings, "brave_api_key", None)
        if not api_key:
            return {"success": False, "engine": "brave", "results": []}

        import httpx
        async with httpx.AsyncClient() as client:
            response = await client.get(
                "https://api.search.brave.com/res/v1/web/search",
                params={"q": query, "count": max_results},
                headers={"X-Subscription-Token": api_key},
                timeout=8,
            )
            response.raise_for_status()
            data = response.json()
            web_results = data.get("web", {}).get("results", [])
            results = [
                {
                    "title": r.get("title", ""),
                    "url": r.get("url", ""),
                    "snippet": r.get("description", ""),
                }
                for r in web_results[:max_results]
            ]
            return {"success": len(results) > 0, "engine": "brave", "results": results}

    def _parse_gemini_results(self, text: str, max_results: int) -> List[Dict]:
        """Best-effort parsing of Gemini search results from text."""
        results = []
        lines = text.split("\n")
        for line in lines:
            line = line.strip()
            # Look for URL patterns
            if "http" in line and len(line) > 10:
                # Extract title from preceding text
                results.append({
                    "title": line[:50],
                    "url": line,
                    "snippet": "",
                })
                if len(results) >= max_results:
                    break
        return results


# Global instance
_parallel_search: Optional[ParallelSearchEngine] = None

def get_parallel_search() -> ParallelSearchEngine:
    """Get or create parallel search instance."""
    global _parallel_search
    if _parallel_search is None:
        _parallel_search = ParallelSearchEngine()
    return _parallel_search
