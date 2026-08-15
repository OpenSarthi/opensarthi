"""
Multi-Agent Supervisor — Mark-L Parity Feature

Routes complex tasks to domain-specific sub-agents:
- WebAgent: web search, browsing
- CalendarAgent: Google Calendar operations (read-only)
- MailAgent: Gmail operations (read-only)
- BrowserAgent: Playwright browser automation
- MusicAgent: music/video playback
- SocialAgent: social media posting
- CodeAgent: code generation/execution
- DesktopUIAgent: desktop automation
- ShellAgent: system commands

Each sub-agent sees only its domain-specific tool subset.
"""
import asyncio
import structlog
from typing import Optional, Any, Dict, List, Tuple
from enum import Enum
from pydantic_ai import Agent as PydanticAgent

from tools.registry import get_schemas
from config import settings

logger = structlog.get_logger()


class AgentDomain(str, Enum):
    WEB = "WebAgent"
    CALENDAR = "CalendarAgent"
    MAIL = "MailAgent"
    BROWSER = "BrowserAgent"
    MUSIC = "MusicAgent"
    SOCIAL = "SocialAgent"
    CODE = "CodeAgent"
    DESKTOP_UI = "DesktopUIAgent"
    SHELL = "ShellAgent"
    GENERAL = "GeneralAgent"


# Tool domain mapping
DOMAIN_TOOLS: Dict[str, List[str]] = {
    AgentDomain.WEB.value: ["web_search", "calendar_search", "gmail_search"],
    AgentDomain.CALENDAR.value: ["calendar_read", "calendar_search"],
    AgentDomain.MAIL.value: ["gmail_read", "gmail_search"],
    AgentDomain.BROWSER.value: [
        "browser_go_to", "browser_back", "browser_forward", "browser_reload",
        "browser_get_url", "browser_click", "browser_type", "browser_press",
        "browser_scroll", "browser_fill_form", "browser_smart_click",
        "browser_get_text", "browser_screenshot", "browser_new_tab",
        "browser_close_tab", "browser_switch_tab", "browser_list_tabs",
        "browser_close", "browser_close_all",
    ],
    AgentDomain.MUSIC.value: ["youtube_search", "youtube_control", "music_play", "media_control"],
    AgentDomain.SOCIAL.value: [
        "twitter_post", "linkedin_post", "telegram_send",
        "whatsapp_send", "discord_send", "email_send",
    ],
    AgentDomain.CODE.value: ["shell", "code_helper", "dev_agent", "file_processor"],
    AgentDomain.DESKTOP_UI.value: [
        "click", "type_text", "press_key", "open_app", "focus_window",
        "click_element", "observe_desktop", "wait_for_window", "wait_for_text",
    ],
    AgentDomain.SHELL.value: ["shell", "shell_output"],
    AgentDomain.GENERAL.value: [],  # All tools
}


class MultiAgentSupervisor:
    """
    Supervisor that routes tasks to appropriate sub-agents.
    """

    def __init__(self, ws_handler, model, deps, thread_id: str = None):
        self.ws = ws_handler
        self.model = model
        self.deps = deps
        self.thread_id = thread_id
        self._classifier_agent: Optional[PydanticAgent] = None

    async def classify_domain(self, goal: str) -> Tuple[AgentDomain, float]:
        """
        Classify the task domain using LLM.
        Returns (domain, confidence).
        """
        if not self._classifier_agent:
            self._classifier_agent = PydanticAgent(
                model=self.model,
                system_prompt=self._build_classifier_prompt(),
            )

        try:
            result = await self._classifier_agent.run(goal[:500])
            domain_str = result.output.strip().upper()

            # Map to domain
            domain_map = {
                "WEB": AgentDomain.WEB,
                "CALENDAR": AgentDomain.CALENDAR,
                "MAIL": AgentDomain.MAIL,
                "BROWSER": AgentDomain.BROWSER,
                "MUSIC": AgentDomain.MUSIC,
                "SOCIAL": AgentDomain.SOCIAL,
                "CODE": AgentDomain.CODE,
                "DESKTOP": AgentDomain.DESKTOP_UI,
                "SHELL": AgentDomain.SHELL,
                "GENERAL": AgentDomain.GENERAL,
            }

            for key, domain in domain_map.items():
                if key in domain_str:
                    return domain, 0.9

            return AgentDomain.GENERAL, 0.5

        except Exception as e:
            logger.warning("Domain classification failed", error=str(e))
            return AgentDomain.GENERAL, 0.3

    def _build_classifier_prompt(self) -> str:
        """Build the domain classifier system prompt."""
        return (
            "You are a task domain classifier for OpenSarthi (AI desktop assistant).\n"
            "Classify the user's request into exactly one domain:\n"
            "1. WEB - web searches, information lookup, general internet queries\n"
            "2. CALENDAR - Google Calendar operations, scheduling, event queries\n"
            "3. MAIL - Gmail operations, email reading, email queries\n"
            "4. BROWSER - browser automation, navigating websites, clicking, typing in browser\n"
            "5. MUSIC - playing music, YouTube videos, media playback\n"
            "6. SOCIAL - posting to social media, sending messages to social platforms\n"
            "7. CODE - writing/executing code, file processing, development tasks\n"
            "8. DESKTOP - desktop automation, window management, clicking/typing in apps\n"
            "9. SHELL - system commands, terminal operations\n"
            "10. GENERAL - anything else, general conversation\n\n"
            "Respond with ONLY one word: WEB, CALENDAR, MAIL, BROWSER, MUSIC, SOCIAL, CODE, DESKTOP, SHELL, or GENERAL."
        )

    async def dispatch(self, goal: str, message_history: List[Dict]) -> Dict[str, Any]:
        """
        Dispatch task to appropriate sub-agent.
        Returns dispatch info for telemetry/UI.
        """
        domain, confidence = await self.classify_domain(goal)

        # Get domain-specific tools
        tools = self._get_domain_tools(domain)

        # Emit dispatch event
        await self.ws.send_message("multi_agent_dispatch", {
            "supervisor_decision": f"Routing to {domain.value} (confidence: {confidence:.2f})",
            "sub_agents": [domain.value],
            "thread_id": self.thread_id,
        })

        logger.info("Multi-agent dispatch", domain=domain.value, confidence=confidence)

        return {
            "domain": domain,
            "confidence": confidence,
            "tools": tools,
        }

    def _get_domain_tools(self, domain: AgentDomain) -> List[str]:
        """Get tool names available to a domain."""
        if domain == AgentDomain.GENERAL:
            # General agent gets all tools
            from tools.registry import all_tools
            return [t.name for t in all_tools()]

        return DOMAIN_TOOLS.get(domain.value, [])

    async def execute_with_domain(self, domain: AgentDomain, goal: str, context: str = "") -> Any:
        """
        Execute a task with the appropriate domain sub-agent.
        The sub-agent uses only its domain-specific tools.
        """
        tools = self._get_domain_tools(domain)

        if domain == AgentDomain.GENERAL:
            # Use general planner with all tools
            from planner.agent import agent as planner_agent
            result = await planner_agent.run(goal)
            return result

        # Build domain-specific agent
        domain_agent = PydanticAgent(
            model=self.model,
            system_prompt=self._build_domain_prompt(domain),
            tools=self._get_tool_functions(tools),
        )

        result = await domain_agent.run(goal)
        return result

    def _build_domain_prompt(self, domain: AgentDomain) -> str:
        """Build system prompt for a domain sub-agent."""
        base = (
            f"You are the {domain.value} for OpenSarthi (AI desktop assistant).\n"
            f"Your job is to handle {domain.value} tasks using only your specialized tools.\n\n"
        )

        domain_instructions = {
            AgentDomain.WEB: "Search the web, fetch information, summarize findings.",
            AgentDomain.CALENDAR: "Read calendar events (read-only access). Provide event details and summaries.",
            AgentDomain.MAIL: "Read Gmail messages (read-only access). Summarize emails and provide details.",
            AgentDomain.BROWSER: "Automate browser actions: navigate, click, type, extract content from web pages.",
            AgentDomain.MUSIC: "Play music and videos, control media playback.",
            AgentDomain.SOCIAL: "Post to social media platforms and send messages (requires user approval).",
            AgentDomain.CODE: "Write, execute, and debug code. Process files. Use shell when needed.",
            AgentDomain.DESKTOP_UI: "Automate desktop: open apps, click, type, manage windows.",
            AgentDomain.SHELL: "Execute system commands safely with sandboxing.",
        }

        return base + domain_instructions.get(domain, "Handle general tasks.")

    def _get_tool_functions(self, tool_names: List[str]) -> List[callable]:
        """Get tool functions for the given tool names."""
        from tools.registry import get
        functions = []
        for name in tool_names:
            tool = get(name)
            if tool:
                # Wrap tool.execute as callable for pydantic-ai
                functions.append(tool.execute)
        return functions


# Global supervisor cache
_supervisors: Dict[str, MultiAgentSupervisor] = {}

def get_supervisor(ws_handler, model, deps, thread_id: str = None) -> MultiAgentSupervisor:
    """Get or create supervisor for a session."""
    key = thread_id or "default"
    if key not in _supervisors:
        _supervisors[key] = MultiAgentSupervisor(ws_handler, model, deps, thread_id)
    return _supervisors[key]
