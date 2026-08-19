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
        await self.ws.send_message("activity_log", {"text": "SYS: Initializing startup briefing..."})
        greeting = self._generate_greeting()

        # Save Phase 1 greeting message to DB so it persists in active thread history
        try:
            import db
            import time
            import uuid
            msg_id = str(uuid.uuid4())
            timestamp = int(time.time() * 1000)
            db.save_message(self.thread_id, msg_id, "assistant", greeting, timestamp)
        except Exception as e:
            logger.warning("Failed to save briefing Phase 1 message to db", error=str(e))

        await self.ws.send_message("briefing_phase1", {
            "text": greeting,
            "thread_id": self.thread_id,
        })
        logger.info("Briefing Phase 1 sent", thread_id=self.thread_id)
        await self.ws.send_message("activity_log", {"text": "SYS: Fetching weather, calendar, news, and long-term memory in parallel..."})

        # Speak Phase 1
        spoken = False
        if getattr(self.settings, "use_native_voice", False):
            try:
                from voice.native_audio import get_native_audio_pipeline
                pipeline = get_native_audio_pipeline()
                # Wait up to 3 seconds for connection
                for _ in range(30):
                    if pipeline and pipeline.is_connected():
                        break
                    await asyncio.sleep(0.1)

                if pipeline and pipeline.is_connected():
                    # Stream prompt to Gemini Live to speak it natively
                    import json as _json
                    msg = {
                        "client_content": {
                            "turns": [{"parts": [{"text": f"Greet the user: {greeting}"}]}],
                            "turn_complete": True
                        }
                    }
                    await pipeline.session.websocket.send(_json.dumps(msg))
                    spoken = True
            except Exception as e:
                logger.warning("Failed to stream briefing Phase 1 to native voice", error=str(e))

        if not spoken:
            # Fallback to local TTS
            asyncio.create_task(self.ws.speak(greeting))

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
            await self.ws.send_message("activity_log", {"text": "SYS: Gathering complete. Compiling summary..."})

            # Generate summary text using LLM (if available)
            summary_text = await self._generate_summary(results)

            # Save Phase 2 summary message to DB so it persists in active thread history
            try:
                import db
                import time
                import uuid
                msg_id = str(uuid.uuid4())
                timestamp = int(time.time() * 1000)
                db.save_message(self.thread_id, msg_id, "assistant", summary_text, timestamp)
            except Exception as e:
                logger.warning("Failed to save briefing Phase 2 message to db", error=str(e))

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
            await self.ws.send_message("activity_log", {"text": "SYS: Startup briefing ready."})

            # Speak Phase 2
            spoken = False
            if getattr(self.settings, "use_native_voice", False):
                try:
                    from voice.native_audio import get_native_audio_pipeline
                    pipeline = get_native_audio_pipeline()
                    if pipeline and pipeline.is_connected():
                        # Construct a briefing summary prompt so Gemini Live speaks it natively
                        import json as _json
                        prompt = (
                            f"[BRIEFING DATA SUMMARY]\n"
                            f"Weather: {results.get('weather')}\n"
                            f"Calendar: {results.get('calendar')}\n"
                            f"News Headlines: {results.get('news')}\n"
                            f"Memories Recalled: {results.get('memories')}\n\n"
                            "Summarize this briefing data naturally and conversationally for the user. Keep it brief."
                        )
                        msg = {
                            "client_content": {
                                "turns": [{"parts": [{"text": prompt}]}],
                                "turn_complete": True
                            }
                        }
                        await pipeline.session.websocket.send(_json.dumps(msg))
                        spoken = True
                except Exception as e:
                    logger.warning("Failed to stream briefing Phase 2 to native voice", error=str(e))

            if not spoken:
                # Fallback to local TTS
                asyncio.create_task(self.ws.speak(summary_text))

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
            if result.success:
                raw = result.raw_output or {}
                if "events" in raw:
                    return raw["events"]
                # Fallback to parsing observation
                events = []
                if result.observation:
                    for line in result.observation.split("\n"):
                        if line.strip().startswith("- "):
                            events.append({"summary": line.strip()[2:]})
                return events
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
            if result.success:
                return {"description": result.observation}
        except Exception as e:
            logger.warning("Weather fetch failed", error=str(e))
        return None

    async def _get_news_headlines(self) -> Optional[List[Dict]]:
        """Fetch news headlines (via web search or news API)."""
        try:
            from tools.productivity import WebSearchTool
            tool = WebSearchTool()
            result = await tool.execute({"query": "top news headlines today", "count": 5})
            if result.success:
                headlines = []
                if result.observation:
                    # WebSearchTool format is "**{title}**\n{snippet}\n{target_url}" separated by double newlines
                    blocks = result.observation.split("\n\n")
                    for block in blocks:
                        lines = [line.strip() for line in block.split("\n") if line.strip()]
                        if lines:
                            title = lines[0]
                            # Clean leading/trailing asterisks
                            if title.startswith("**") and title.endswith("**"):
                                title = title[2:-2].strip()
                            
                            snippet = lines[1] if len(lines) > 1 else ""
                            url = lines[2] if len(lines) > 2 else ""
                            
                            headlines.append({
                                "title": title,
                                "snippet": snippet,
                                "url": url
                            })
                return headlines
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
        """Generate a natural-language summary of the briefing using active LLM."""
        has_data = results.get("calendar") or results.get("weather") or results.get("news") or results.get("memories")
        if not has_data:
            return "I couldn't fetch live data, but I'm ready to help with anything you need!"

        try:
            from config import settings, get_active_api_key
            from llm import build_model
            from pydantic_ai import Agent as PydanticAgent
            import json as _json

            provider = settings.ai_provider.lower()
            model_name = settings.local_model if provider == "ollama" else settings.cloud_model
            api_key = get_active_api_key()

            active_model = build_model(provider, model_name, api_key)
            
            prompt = (
                "You are OpenSarthi morning briefing assistant.\n"
                "Please generate a short, friendly, and natural morning/afternoon/evening briefing summary for the user.\n"
                "Address them by name if provided, and describe their upcoming calendar events, current weather, and top news headlines.\n\n"
                f"User Name: {getattr(self.settings, 'user_name', '')}\n"
                f"Weather Data: {_json.dumps(results.get('weather') or {})}\n"
                f"Calendar Events: {_json.dumps(results.get('calendar') or [])}\n"
                f"News Headlines: {_json.dumps(results.get('news') or [])}\n"
                f"Recalled Memories: {_json.dumps(results.get('memories') or [])}\n\n"
                "Rules:\n"
                "1. Keep the summary friendly, brief, and under 3-4 sentences.\n"
                "2. Summarize the items naturally and conversationally (do not output json or bullet points)."
            )

            agent = PydanticAgent(active_model)
            result = await agent.run(prompt)
            summary = result.output.strip()
            if summary:
                return summary
        except Exception as e:
            logger.warning("LLM briefing summary generation failed, falling back to python generator", error=str(e))

        return self._generate_fallback_summary(results)

    def _generate_fallback_summary(self, results: Dict) -> str:
        """Fallback python-based natural-language summary generator."""
        parts = []

        # Calendar
        cal = results.get("calendar")
        if cal:
            count = len(cal)
            parts.append(f"You have {count} upcoming event{'s' if count != 1 else ''} today.")

        # Weather
        weather = results.get("weather")
        if weather:
            desc = weather.get("description", "unknown conditions")
            parts.append(f"For weather: {desc}.")

        # News
        news = results.get("news")
        if news:
            parts.append(f"Here are {len(news)} top news stories.")

        # Memories
        memories = results.get("memories")
        if memories:
            parts.append(f"I've recalled {len(memories)} relevant memories from our past conversations.")

        if not parts:
            return "I couldn't fetch live data, but I'm ready to help with anything you need!"

        return "Your briefing: " + " ".join(parts)


# Global instance for easy access
_briefing_instance: Optional[MorningBriefing] = None

def get_briefing(ws_handler, settings, memory_manager=None, thread_id: str = None) -> MorningBriefing:
    """Get or create the morning briefing instance."""
    global _briefing_instance
    if _briefing_instance is None:
        _briefing_instance = MorningBriefing(ws_handler, settings, memory_manager, thread_id)
    return _briefing_instance
