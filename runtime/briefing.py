"""
Two-Phase Morning Briefing for OpenSarthi

Phase 1: Instant greeting (<1s) — no tools, immediate acknowledgment
Phase 2: Full briefing with Content Panel data (calendar, weather, news, memories)

Uses Google OAuth (read-only) for calendar/gmail, weather API, and long-term memory.
"""
import asyncio
import json
import structlog
from typing import Optional, Any, Dict, List
from datetime import datetime, timedelta

logger = structlog.get_logger()


class MorningBriefing:
    """
    Orchestrates the two-phase morning briefing.

    Phase 1: Send instant greeting immediately (no tool calls).
    Phase 2: Gather calendar, weather, news, and memories in parallel,
             then send full briefing + Content Panel data.
    """

    def __init__(self, ws_handler, settings, memory_manager=None, thread_id: str = None):
        self.ws = ws_handler
        self.settings = settings
        self.memory = memory_manager
        self.thread_id = thread_id
        self._phase2_task: Optional[asyncio.Task] = None

    async def start_briefing(self):
        """Entry point: send Phase 1, then trigger Phase 2 in background."""
        # Phase 1: instant greeting (no tools, <1s)
        await self._send_phase1()

        # Phase 2: full briefing with parallel data fetch
        self._phase2_task = asyncio.create_task(self._run_phase2())

    async def _send_phase1(self):
        """Send instant greeting — no tool calls."""
        greeting = self._generate_greeting()
        await self.ws.send_message("briefing_phase1", {
            "text": greeting,
            "thread_id": self.thread_id,
        })
        logger.info("Briefing Phase 1 sent", thread_id=self.thread_id)

    async def _run_phase2(self):
        """Gather all briefing data in parallel and send Phase 2."""
        try:
            # Gather data in parallel
            tasks = {
                "calendar": self._get_calendar_events(),
                "weather": self._get_weather(),
                "news": self._get_news_headlines(),
                "memories": self._get_relevant_memories(),
            }

            results = {}
            for key, task in tasks.items():
                try:
                    results[key] = await task
                except Exception as e:
                    logger.warning(f"Briefing data fetch failed: {key}", error=str(e))
                    results[key] = None

            # Build content panel data
            content_data = self._build_content_data(results)

            # Generate summary text using LLM (if available)
            summary_text = await self._generate_summary(results)

            # Send Phase 2
            await self.ws.send_message("briefing_phase2", {
                "text": summary_text,
                "content_panel_data": content_data,
                "thread_id": self.thread_id,
            })

            # Also send content_update for the Content Panel
            await self.ws.send_message("content_update", {
                "content_type": "briefing",
                "data": content_data,
                "thread_id": self.thread_id,
            })

            logger.info("Briefing Phase 2 sent", thread_id=self.thread_id)

        except Exception as e:
            logger.error("Briefing Phase 2 failed", error=str(e))
            await self.ws.send_message("briefing_phase2", {
                "text": "I had trouble gathering your full briefing, but I'm here to help!",
                "thread_id": self.thread_id,
            })

    def _generate_greeting(self) -> str:
        """Generate a time-appropriate greeting."""
        hour = datetime.now().hour
        if 5 <= hour < 12:
            return "Good morning! I'm compiling your briefing..."
        elif 12 <= hour < 17:
            return "Good afternoon! Let me pull together your briefing..."
        elif 17 <= hour < 22:
            return "Good evening! Here's your briefing..."
        else:
            return "Hello! Let me get your briefing ready..."

    async def _get_calendar_events(self) -> Optional[List[Dict]]:
        """Fetch upcoming calendar events via Google OAuth (read-only)."""
        if not self.settings.google_oauth_enabled:
            return None

        try:
            from tools.google_tools import CalendarReadTool
            tool = CalendarReadTool()
            result = await tool.execute({"max_results": 10, "time_min": datetime.now().isoformat()})
            if result.get("success"):
                return result.get("events", [])
        except ImportError:
            logger.warning("Google calendar tool not available")
        except Exception as e:
            logger.warning("Calendar fetch failed", error=str(e))
        return None

    async def _get_weather(self) -> Optional[Dict]:
        """Fetch current weather."""
        try:
            from tools.productivity import WeatherTool
            tool = WeatherTool()
            # Default to a generic query; user location from settings if available
            result = await tool.execute({"location": "current"})
            if result.get("success"):
                return result.get("data", {})
        except Exception as e:
            logger.warning("Weather fetch failed", error=str(e))
        return None

    async def _get_news_headlines(self) -> Optional[List[Dict]]:
        """Fetch news headlines (via web search or news API)."""
        try:
            from tools.productivity import WebSearchTool
            tool = WebSearchTool()
            result = await tool.execute({"query": "top news headlines today", "max_results": 5})
            if result.get("success"):
                return result.get("results", [])
        except Exception as e:
            logger.warning("News fetch failed", error=str(e))
        return None

    async def _get_relevant_memories(self) -> Optional[List[Dict]]:
        """Fetch relevant memories from long-term memory."""
        if not self.memory:
            return None
        try:
            entries = await self.memory.recall("morning briefing relevant context", top_k=5)
            return [
                {"content": e.content, "source": e.source, "importance": e.importance}
                for e in entries
            ]
        except Exception as e:
            logger.warning("Memory fetch failed", error=str(e))
        return None

    def _build_content_data(self, results: Dict) -> Dict:
        """Build Content Panel data structure."""
        return {
            "title": "Morning Briefing",
            "generated_at": datetime.now().isoformat(),
            "calendar_events": results.get("calendar") or [],
            "weather": results.get("weather") or {},
            "news_headlines": results.get("news") or [],
            "memories": results.get("memories") or [],
        }

    async def _generate_summary(self, results: Dict) -> str:
        """Generate a natural-language summary of the briefing."""
        parts = []

        # Calendar
        cal = results.get("calendar")
        if cal:
            count = len(cal)
            parts.append(f"You have {count} upcoming event{'s' if count != 1 else ''} today.")

        # Weather
        weather = results.get("weather")
        if weather:
            temp = weather.get("temperature")
            desc = weather.get("description", "unknown conditions")
            if temp is not None:
                parts.append(f"It's {temp}°C with {desc}.")

        # News
        news = results.get("news")
        if news:
            parts.append(f"Here are {len(news)} top news stories.")

        # Memories
        memories = results.get("memories")
        if memories:
            parts.append(f"I've recalled {len(memories)} relevant memories from our past conversations.")

        if not parts:
            return "Here's your briefing for today. I couldn't fetch live data, but I'm ready to help with anything you need!"

        return "Your briefing: " + " ".join(parts)


# Global instance for easy access
_briefing_instance: Optional[MorningBriefing] = None

def get_briefing(ws_handler, settings, memory_manager=None, thread_id: str = None) -> MorningBriefing:
    """Get or create the morning briefing instance."""
    global _briefing_instance
    if _briefing_instance is None:
        _briefing_instance = MorningBriefing(ws_handler, settings, memory_manager, thread_id)
    return _briefing_instance
