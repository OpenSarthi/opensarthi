"""
BehavioralObserver — Passive preference learning for OpenSarthi.

After each completed conversation turn, the observer analyses the last few
messages to detect implicit user preferences (tone, style, corrections, etc.)
and stores them in long-term memory.  These preferences are always prepended
to the planner context with high priority.

Runs as a fire-and-forget asyncio task — never blocks the user response.
"""
import asyncio
import structlog
from typing import Optional

logger = structlog.get_logger()


class BehavioralObserver:
    """
    Detects implicit behavioral preferences from conversation patterns.

    Examples of what it catches:
    - User says 'shorter' → stores 'User prefers concise responses'
    - User corrects tool name → stores 'User uses "mousepad", not "leafpad"'
    - User shows frustration → stores 'User dislikes over-explanation'
    """

    def __init__(self, model, deps):
        self.model = model
        self.deps = deps

    async def observe_and_store(
        self,
        recent_messages: list,
        memory_manager,
    ) -> None:
        """
        Async fire-and-forget. Analyses last 3 conversation turns for preferences.
        """
        if not recent_messages or len(recent_messages) < 2:
            return

        # Only look at the last 3 exchanges (6 messages max)
        tail = recent_messages[-6:]
        conversation_text = "\n".join([
            f"{m.get('role', 'user').upper()}: {str(m.get('content', ''))[:300]}"
            for m in tail
        ])

        try:
            from pydantic_ai import Agent as PydanticAgent
            from datetime import datetime
            now = datetime.now()
            time_str = now.strftime("%A, %B %d, %Y %I:%M %p")
            tz_name = now.astimezone().tzname() or "Local Time"

            observer = PydanticAgent(model=self.model)

            prompt = f"""You are a preference-detection module for an AI desktop agent.
CURRENT DATE & TIME: {time_str} ({tz_name})
Analyse this conversation excerpt and detect any implicit user preferences.

CONVERSATION:
{conversation_text}

DETECT preferences like:
- Response style ("User prefers shorter answers" / "User likes step-by-step detail")
- Corrections ("User prefers app name X over Y")
- Frustration signals ("User wants direct action, not explanation first")
- Tool feedback ("User confirmed that keyboard shortcut X works better than Y")

RULES:
- Only extract a preference if there is CLEAR evidence in the text
- Do not invent preferences — when in doubt, return empty array
- Write each preference as a factual sentence starting with "User"

OUTPUT FORMAT — JSON array of strings (or empty array if nothing detected):
["preference 1"]
"""
            result = await asyncio.wait_for(
                observer.run(prompt),
                timeout=15.0
            )
            raw = result.output.strip()

            import re
            json_match = re.search(r"\[[\s\S]*?\]", raw)
            if not json_match:
                return

            import json
            preferences: list = json.loads(json_match.group(0))
            if not isinstance(preferences, list):
                return

            for pref in preferences[:2]:  # Max 2 preferences per turn
                if not isinstance(pref, str) or len(pref.strip()) < 10:
                    continue
                # Store as high-importance preference
                await memory_manager.store(
                    content=f"[PREFERENCE] {pref.strip()}",
                    source="behavioral_observer",
                    importance=0.95,
                )
                logger.info(
                    "BehavioralObserver stored preference",
                    preference=pref[:80],
                )

        except asyncio.TimeoutError:
            logger.debug("BehavioralObserver timed out — skipping")
        except Exception as e:
            logger.debug("BehavioralObserver error", error=str(e))
