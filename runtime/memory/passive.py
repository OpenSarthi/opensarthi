"""
Passive memory extraction — GWEN-style automatic fact extraction from conversations.
After every agent turn, a lightweight background call asks the LLM to extract
any user facts, preferences, or decisions mentioned in the exchange and stores
them silently in long-term memory.

This is fire-and-forget: it never blocks the response loop.
"""
import asyncio
import structlog

logger = structlog.get_logger()

# Facts that are too generic to be worth storing
_SKIP_PHRASES = {
    "yes", "no", "okay", "ok", "sure", "thanks", "thank you",
    "got it", "understood", "please", "hello", "hi", "bye", "goodbye",
}

async def extract_and_store_facts(
    user_input: str,
    assistant_response: str,
    model,
    thread_id: str = "global_user_memory",
) -> None:
    """
    Fire-and-forget: extract facts from a conversation turn and store them.
    Never raises — all errors are logged and swallowed.
    """
    # Skip trivial one-word exchanges
    if not user_input or user_input.lower().strip() in _SKIP_PHRASES:
        return
    if len(user_input.strip()) < 10:
        return

    try:
        from pydantic_ai import Agent as PydanticAgent

        extractor = PydanticAgent(model=model)
        prompt = f"""You are a fact extractor for a personal AI assistant.

Analyze this exchange and extract ONLY concrete, specific facts about the USER (not the assistant).
Focus on: name, location, preferences, habits, rules, important facts they stated.

USER SAID: "{user_input[:300]}"
ASSISTANT REPLIED: "{assistant_response[:200]}"

OUTPUT RULES:
- Output each fact as a single clear sentence starting with "User "
- Output NOTHING if there are no concrete user facts to extract
- Max 3 facts, one per line
- Do not extract questions, vague statements, or task instructions
- Examples of good facts:
  "User prefers dark mode in all applications."
  "User's name is XYZ."
  "User works from home on Tuesdays."
  "User drinks black coffee in the morning."

OUTPUT (facts only, or empty):"""

        result = await extractor.run(prompt)
        raw = result.output.strip()

        if not raw or raw.lower() in ("none", "no facts", "nothing", "empty", "-"):
            return

        lines = [ln.strip() for ln in raw.splitlines() if ln.strip() and len(ln.strip()) > 10]

        from memory.manager import MemoryManager
        manager = MemoryManager(thread_id)

        for fact in lines[:3]:
            # Don't store if it's a duplicate of something already in memory
            existing = await manager.recall(fact[:50], top_k=1)
            if existing and _content_similar(fact, existing[0].content):
                continue
            await manager.store(content=fact, source="passive_extraction", importance=0.6)
            logger.debug("Passive memory stored", fact=fact[:80])

    except asyncio.CancelledError:
        pass
    except Exception as e:
        logger.debug("Passive memory extraction skipped", error=str(e))


def _content_similar(a: str, b: str, threshold: float = 0.7) -> bool:
    """Simple word-overlap similarity to avoid storing near-duplicate facts."""
    words_a = set(a.lower().split())
    words_b = set(b.lower().split())
    if not words_a or not words_b:
        return False
    overlap = len(words_a & words_b) / max(len(words_a), len(words_b))
    return overlap >= threshold
