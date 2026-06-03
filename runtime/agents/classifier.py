from typing import Literal, Any
from pydantic_ai import Agent as PydanticAgent
import structlog

logger = structlog.get_logger()

Classification = Literal["CHAT", "TASK", "CLARIFY"]

async def classify_intent_with_usage(model, text: str) -> tuple[Classification, Any]:
    """
    Classifies the user query using a lightweight LLM call to decide the routing category:
    - CHAT: Informational requests, general conversational messages, explanation requests, or code generation that DO NOT require any desktop operations, browser tasks, or file manipulation.
    - TASK: Any command or instruction that requires executing system commands, running desktop apps, clicking, typing, taking screenshots, browsing URLs, searching in Chrome/browser, or editing local files.
    - CLARIFY: If the request is highly ambiguous or lacks clarity.
    """
    try:
        system_prompt = (
            "You are a master routing classifier for OpenSarthi (an AI desktop assistant).\n"
            "Your sole job is to classify the user's request into exactly one of three categories:\n"
            "1. 'CHAT': Conversational replies, general questions, explanations, writing essays, or code generation where the user is NOT asking you to perform any desktop actions, open apps, browse the web, or edit local files.\n"
            "2. 'TASK': Any command, instruction, or query that requires the agent to interact with the desktop, window manager, file system, browser, or applications (e.g., 'open firefox', 'type hello', 'click the button', 'search on chrome', 'write this essay in the Kate editor', 'search local files').\n"
            "3. 'CLARIFY': An ambiguous query that needs clarification.\n\n"
            "Respond with ONLY one word: 'CHAT', 'TASK', or 'CLARIFY'. Do not include punctuation, explanations, or formatting."
        )
        classifier_agent = PydanticAgent(
            model=model,
            system_prompt=system_prompt
        )
        result = await classifier_agent.run(text)
        val = result.output.strip().upper()
        
        # Parse result safely
        if "TASK" in val:
            classification = "TASK"
        elif "CLARIFY" in val:
            classification = "CLARIFY"
        else:
            classification = "CHAT"
            
        logger.info("LLM Classifier classified intent", input=text[:80], classification=classification)
        return classification, getattr(result, "usage", None)
    except Exception as e:
        logger.warning("LLM Classifier failed, falling back to CHAT", error=str(e))
        return "CHAT", None

async def classify_intent(model, text: str) -> Classification:
    classification, _ = await classify_intent_with_usage(model, text)
    return classification
