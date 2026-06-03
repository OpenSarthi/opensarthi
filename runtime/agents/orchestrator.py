import asyncio
import structlog
from typing import Optional, Any
from agents.classifier import Classification, classify_intent

logger = structlog.get_logger()

class OrchestratorAgent:
    """
    Master routing agent. Receives every user message and routes it:
    - CHAT → direct LLM response (no desktop tools, fast)
    - TASK → planner agent with full desktop context
    - CLARIFY → ask one focused question

    Also manages context summarization to prevent token bloat.
    """

    MAX_HISTORY_RAW = 10     # Messages before we compress to summary
    MAX_HISTORY_SEND = 5     # Most recent messages to always send verbatim

    def __init__(self, ws_handler, model, deps, memory_manager=None):
        self.ws = ws_handler
        self.model = model
        self.deps = deps
        self.memory = memory_manager
        self._conversation_summary: Optional[str] = None

    async def route(
        self,
        goal: str,
        message_history: list,
        observer,
    ) -> tuple[Classification, Optional[str], Optional[Any], Optional[Any]]:
        """
        Classify and route. Returns (classification, context_string, class_usage, sum_usage).
        The runtime uses the context_string for the actual agent.run() call.
        """
        from agents.classifier import classify_intent_with_usage
        classification, class_usage = await classify_intent_with_usage(self.model, goal)
        logger.info("Orchestrator classified intent", goal=goal[:80], classification=classification)

        # Compress history if it has grown large
        summarized_context, sum_usage = await self._maybe_summarize(message_history, goal)

        return classification, summarized_context, class_usage, sum_usage

    async def _maybe_summarize(self, message_history: list, current_goal: str) -> tuple[Optional[str], Optional[Any]]:
        """
        If message history > MAX_HISTORY_RAW, use a lightweight LLM call to compress
        older turns into a dense summary paragraph. Recent turns are always sent verbatim.
        """
        if len(message_history) <= self.MAX_HISTORY_RAW:
            return self._conversation_summary, None  # Use cached if available

        # Already have a summary — update it with the accumulated new messages
        older_messages = message_history[:-self.MAX_HISTORY_SEND]

        # Build summary prompt from older messages
        history_text = "\n".join([
            f"{m.get('role', 'user').upper()}: {str(m.get('content', ''))[:200]}"
            for m in older_messages[-10:]  # last 10 of the older batch
        ])

        try:
            from llm import build_model
            from config import settings, get_active_api_key
            provider = settings.ai_provider.lower()
            model_name = settings.local_model if provider == "ollama" else settings.cloud_model
            api_key = get_active_api_key()
            summarizer_model = build_model(provider, model_name, api_key)

            from pydantic_ai import Agent as PydanticAgent
            summarizer = PydanticAgent(model=summarizer_model)

            prompt = f"""Compress the following conversation history into a single dense paragraph (max 150 words).
Preserve: key facts, completed actions, user preferences, current task state.
Discard: pleasantries, repetition, verbose tool outputs.
Current goal: {current_goal[:100]}

CONVERSATION:
{history_text}

OUTPUT: A single paragraph summary only. No preamble."""

            result = await summarizer.run(prompt)
            self._conversation_summary = result.output.strip()
            logger.info("Context compressed by summarizer", length=len(self._conversation_summary))
            return self._conversation_summary, getattr(result, "usage", None)

        except Exception as e:
            logger.warning("Context summarizer failed, using raw history", error=str(e))
            return self._conversation_summary, None

    def reset_summary(self):
        """Call when a new chat thread starts."""
        self._conversation_summary = None
