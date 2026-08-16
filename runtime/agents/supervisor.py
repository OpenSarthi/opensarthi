"""
Multi-Agent Supervisor — LangGraph Multi-Domain Routing

Routes complex tasks to one or more domain-specific tool subsets:
- WebAgent: web search, browsing
- CalendarAgent: Google Calendar operations (read-only)
- MailAgent: Gmail operations (read-only)
- BrowserAgent: Playwright browser automation
- MusicAgent: music/video playback
- SocialAgent: social media posting
- CodeAgent: code generation/execution
- DesktopUIAgent: desktop automation
- ShellAgent: system commands
- GeneralAgent: anything else (fallback, all tools)

Design:
- The supervisor runs ONCE per task (no duplicate LLM calls) at the start of
  the graph, before planning.
- It returns a structured SupervisorResult: domains (ordered, multi-domain
  supported), confidence, a human-readable reason, and the resolved
  `allowed_tools` list (union of domain tools + GENERAL tools).
- If the classifier is unavailable or confidence is below threshold, it falls
  back to GENERAL (all tools available) rather than failing.
- Permission/risk/parallel systems are preserved: allowed_tools only *limits
  tool visibility*; the existing RiskLevel gating and parallel grouping still
  apply at execution time.

The supervisor is used by the LangGraph engine. AgentRuntime (legacy) ignores
supervisor output and passes allowed_tools=None (unrestricted), preserving
backward compatibility.
"""
import asyncio
import structlog
from typing import Optional, Any, Dict, List, Set, Tuple
from enum import Enum
from pydantic_ai import Agent as PydanticAgent

from tools.base import ToolDomain
from tools.registry import get_tool_names_by_domain, all_tools
from config import settings

logger = structlog.get_logger()


class AgentDomain(str, Enum):
    """Agent domains — kept aligned with ToolDomain values for mapping."""
    WEB = "web"
    CALENDAR = "calendar"
    MAIL = "mail"
    BROWSER = "browser"
    MUSIC = "music"
    SOCIAL = "social"
    CODE = "code"
    DESKTOP_UI = "desktop_ui"
    SHELL = "shell"
    GENERAL = "general"


# Confidence threshold below which we fall back to GENERAL.
CONFIDENCE_FALLBACK_THRESHOLD = 0.4


class SupervisorResult:
    """
    Structured output of the supervisor.

    Attributes:
        domains: Ordered list of domains (most relevant first). Always contains
            at least GENERAL when fallback is triggered.
        confidence: Overall routing confidence in [0, 1].
        reason: Human-readable explanation of the routing decision.
        allowed_tools: Resolved tool names the planner/healer/executor may use.
        dispatch_id: Optional stable id for telemetry/WebSocket correlation.
    """

    def __init__(
        self,
        domains: List[ToolDomain],
        confidence: float,
        reason: str,
        allowed_tools: List[str],
        dispatch_id: Optional[str] = None,
    ):
        self.domains = domains
        self.confidence = confidence
        self.reason = reason
        self.allowed_tools = allowed_tools
        self.dispatch_id = dispatch_id

    def to_dict(self) -> Dict[str, Any]:
        return {
            "domains": [d.value for d in self.domains],
            "confidence": self.confidence,
            "reason": self.reason,
            "allowed_tools": self.allowed_tools,
            "dispatch_id": self.dispatch_id,
        }

    @property
    def primary_domain(self) -> ToolDomain:
        return self.domains[0] if self.domains else ToolDomain.GENERAL

    def is_fallback(self) -> bool:
        """True when only GENERAL is selected (no specialized domain matched)."""
        return len(self.domains) == 1 and self.domains[0] == ToolDomain.GENERAL


def _all_tool_names() -> List[str]:
    return [t.name for t in all_tools()]


def resolve_allowed_tools(domains: List[ToolDomain]) -> List[str]:
    """
    Resolve the union of tools available to the given domains.

    GENERAL tools are always included (they belong to every domain). When
    GENERAL is among the domains, all tools are returned.
    """
    if not domains:
        return _all_tool_names()

    if ToolDomain.GENERAL in domains:
        return _all_tool_names()

    allowed: Set[str] = set()
    for domain in domains:
        allowed.update(get_tool_names_by_domain(domain))
    return sorted(allowed)


class MultiAgentSupervisor:
    """
    Supervisor that classifies a task's domain(s) and resolves the tool scope.

    Runs once per task. Produces a SupervisorResult consumed downstream by the
    planner (tool visibility), healer (tool visibility), and executor
    (authorization scope).
    """

    def __init__(self, ws_handler, model, deps=None, thread_id: str = None):
        self.ws = ws_handler
        self.model = model
        self.deps = deps
        self.thread_id = thread_id
        self._classifier_agent: Optional[PydanticAgent] = None

    async def classify(self, goal: str, dispatch_id: Optional[str] = None) -> SupervisorResult:
        """
        Classify the task into one or more domains and resolve allowed tools.

        Returns a SupervisorResult. Never raises — falls back to GENERAL on any
        failure so the task can always proceed.
        """
        try:
            domains, confidence, reason = await self._classify_domains(goal)
        except Exception as e:
            logger.warning("Domain classification failed; falling back to GENERAL", error=str(e))
            return await self._fallback_result(
                reason=f"Classifier unavailable ({type(e).__name__}); using all tools.",
                dispatch_id=dispatch_id,
            )

        # Fallback when confidence is too low.
        if confidence < CONFIDENCE_FALLBACK_THRESHOLD:
            return await self._fallback_result(
                reason=f"Low confidence ({confidence:.2f}); using all tools.",
                dispatch_id=dispatch_id,
            )

        allowed = resolve_allowed_tools(domains)

        result = SupervisorResult(
            domains=domains,
            confidence=confidence,
            reason=reason,
            allowed_tools=allowed,
            dispatch_id=dispatch_id,
        )

        # Emit dispatch event for telemetry/UI.
        if self.ws and hasattr(self.ws, "send_message"):
            try:
                await self.ws.send_message("multi_agent_dispatch", {
                    "domains": result.to_dict()["domains"],
                    "confidence": result.confidence,
                    "reason": result.reason,
                    "allowed_tools": result.allowed_tools,
                    "sub_agents": [f"{d.value}Agent" for d in domains],
                    "dispatch_id": dispatch_id,
                    "thread_id": self.thread_id,
                })
            except Exception:
                pass

        logger.info(
            "Multi-agent supervisor decision",
            domains=result.to_dict()["domains"],
            confidence=result.confidence,
            tool_count=len(allowed),
        )

        return result

    async def _classify_domains(self, goal: str) -> Tuple[List[ToolDomain], float, str]:
        """
        Run the LLM classifier. Returns (domains, confidence, reason).

        Supports multi-domain output: the classifier may emit several domains
        (comma-separated), which are parsed and ordered.
        """
        if not self._classifier_agent:
            self._classifier_agent = PydanticAgent(
                model=self.model,
                system_prompt=self._build_classifier_prompt(),
            )

        result = await self._classifier_agent.run(goal[:1000])
        raw = result.output.strip()

        # Expect JSON: {"domains": [...], "confidence": 0.x, "reason": "..."}
        domains, confidence, reason = self._parse_classification(raw)

        if not domains:
            # Parsing failed or empty — treat as low-confidence GENERAL.
            return [ToolDomain.GENERAL], 0.3, f"Could not parse classifier output: {raw[:100]}"

        return domains, confidence, reason

    def _parse_classification(self, raw: str) -> Tuple[List[ToolDomain], float, str]:
        """Parse the classifier's raw output into (domains, confidence, reason)."""
        import json
        raw_clean = raw.strip()

        # Try strict JSON first.
        try:
            data = json.loads(raw_clean)
            return self._extract_from_dict(data)
        except (json.JSONDecodeError, ValueError, TypeError):
            pass

        # Fallback: parse "DOMAINS: a, b | CONFIDENCE: 0.8 | REASON: ..."
        return self._extract_from_text(raw_clean)

    def _extract_from_dict(self, data: Dict) -> Tuple[List[ToolDomain], float, str]:
        domains_raw = data.get("domains") or data.get("domain") or []
        if isinstance(domains_raw, str):
            domains_raw = [domains_raw]
        domains = self._map_domains(domains_raw)
        confidence = float(data.get("confidence", 0.7))
        reason = str(data.get("reason", ""))
        return domains, confidence, reason

    def _extract_from_text(self, raw: str) -> Tuple[List[ToolDomain], float, str]:
        domains: List[ToolDomain] = []
        confidence = 0.6
        reason = raw

        upper = raw.upper()
        domain_map = {
            "WEB": ToolDomain.WEB,
            "CALENDAR": ToolDomain.CALENDAR,
            "MAIL": ToolDomain.MAIL,
            "BROWSER": ToolDomain.BROWSER,
            "MUSIC": ToolDomain.MUSIC,
            "SOCIAL": ToolDomain.SOCIAL,
            "CODE": ToolDomain.CODE,
            "DESKTOP": ToolDomain.DESKTOP_UI,
            "SHELL": ToolDomain.SHELL,
            "GENERAL": ToolDomain.GENERAL,
        }
        for key, domain in domain_map.items():
            if key in upper:
                domains.append(domain)

        if not domains:
            domains = [ToolDomain.GENERAL]

        return domains, confidence, reason

    def _map_domains(self, raw_list: List[str]) -> List[ToolDomain]:
        """Map raw domain strings to ToolDomain, preserving order. Unknown → GENERAL."""
        domain_map = {
            "web": ToolDomain.WEB,
            "calendar": ToolDomain.CALENDAR,
            "mail": ToolDomain.MAIL,
            "browser": ToolDomain.BROWSER,
            "music": ToolDomain.MUSIC,
            "social": ToolDomain.SOCIAL,
            "code": ToolDomain.CODE,
            "desktop": ToolDomain.DESKTOP_UI,
            "desktop_ui": ToolDomain.DESKTOP_UI,
            "shell": ToolDomain.SHELL,
            "general": ToolDomain.GENERAL,
        }
        mapped: List[ToolDomain] = []
        for item in raw_list:
            key = str(item).strip().lower()
            domain = domain_map.get(key)
            if domain and domain not in mapped:
                mapped.append(domain)
        if not mapped:
            mapped = [ToolDomain.GENERAL]
        return mapped

    def _build_classifier_prompt(self) -> str:
        """Build the domain classifier system prompt (multi-domain aware)."""
        return (
            "You are a task domain classifier for OpenSarthi (AI desktop assistant).\n"
            "Classify the user's request into one or more domains:\n"
            "1. WEB - web searches, information lookup, general internet queries\n"
            "2. CALENDAR - Google Calendar operations, scheduling, event queries\n"
            "3. MAIL - Gmail operations, email reading, email queries\n"
            "4. BROWSER - browser automation, navigating websites, clicking, typing in browser\n"
            "5. MUSIC - playing music, YouTube videos, media playback\n"
            "6. SOCIAL - posting to social media, sending messages to social platforms\n"
            "7. CODE - writing/executing code, file processing, development tasks\n"
            "8. DESKTOP - desktop automation, window management, clicking/typing in apps\n"
            "9. SHELL - system commands, terminal operations\n"
            "10. GENERAL - anything else, general conversation, or when multiple unrelated domains apply\n\n"
            "A single request may span multiple domains (e.g. 'check my calendar and email me a summary' "
            "spans CALENDAR and MAIL). List every relevant domain.\n\n"
            "Respond with ONLY a JSON object of the form:\n"
            '{"domains": ["WEB"], "confidence": 0.9, "reason": "user asked to search the web"}\n'
            "confidence is a float in [0,1]. Use GENERAL with high confidence only when no specialized "
            "domain fits or the request is genuinely general-purpose."
        )

    async def _fallback_result(self, reason: str, dispatch_id: Optional[str] = None) -> SupervisorResult:
        """Build a GENERAL fallback result (all tools available)."""
        result = SupervisorResult(
            domains=[ToolDomain.GENERAL],
            confidence=0.5,
            reason=reason,
            allowed_tools=_all_tool_names(),
            dispatch_id=dispatch_id,
        )
        if self.ws and hasattr(self.ws, "send_message"):
            try:
                await self.ws.send_message("multi_agent_dispatch", {
                    "domains": ["general"],
                    "confidence": result.confidence,
                    "reason": result.reason,
                    "allowed_tools": result.allowed_tools,
                    "sub_agents": ["GeneralAgent"],
                    "dispatch_id": dispatch_id,
                    "thread_id": self.thread_id,
                })
            except Exception:
                pass
        return result

    def get_domain_tools(self, domain: ToolDomain) -> List[str]:
        """Return tool names for a single domain (including GENERAL tools)."""
        return get_tool_names_by_domain(domain)


# Global supervisor cache
_supervisors: Dict[str, MultiAgentSupervisor] = {}

def get_supervisor(ws_handler, model, deps=None, thread_id: str = None) -> MultiAgentSupervisor:
    """Get or create supervisor for a session."""
    key = thread_id or "default"
    if key not in _supervisors:
        _supervisors[key] = MultiAgentSupervisor(ws_handler, model, deps, thread_id)
    return _supervisors[key]
