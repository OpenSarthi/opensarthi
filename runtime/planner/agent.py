from pydantic import BaseModel, ConfigDict
from pydantic_ai import Agent, RunContext
from pydantic_ai.models.ollama import OllamaModel
from typing import Any, Optional, List
import os

os.environ.setdefault("OLLAMA_BASE_URL", "http://localhost:11434")

from config import settings
from tools.desktop import ClickTool, TypeTextTool, PressKeyTool, OpenAppTool, ClickElementTool
from tools.system import ShellTool
from tools.wait_tools import WaitForWindowTool, WaitForTextTool
from observation import DesktopSnapshot

local_llm = OllamaModel(settings.local_model)

class AgentDependencies(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True)
    require_cloud: bool = False
    log_action: Any = None
    # Personalization (read from settings at run time)
    skills: List[str] = []
    user_name: str = ""
    custom_prompt: str = ""

# ─── Skill-aware system prompt builder ───────────────────────────────────────

def build_system_prompt(skills: list, user_name: str, custom_prompt: str) -> str:
    has_desktop  = "desktop_automation" in skills
    has_dev      = "developer" in skills
    has_admin    = "system_admin" in skills
    has_media    = "media" in skills
    has_writing  = "writing" in skills
    has_research = "research" in skills
    has_web      = "web" in skills
    has_privacy  = "privacy" in skills

    name_clause = f"The user's name is {user_name}. Address them by name occasionally." if user_name else ""
    custom_clause = f"\n\nUSER CUSTOM INSTRUCTIONS:\n{custom_prompt}" if custom_prompt else ""

    # Base identity
    base = f"""You are OpenSarthi, an intelligent AI assistant for Linux.
{name_clause}{custom_clause}

RESPONSE FORMAT RULES:
1. If you reason internally, wrap it in <think>...</think> FIRST.
2. Write ONLY the final response after </think> — no preamble.
3. NEVER start with "Since the user said..." or "There's no task...". Respond directly.
"""

    # Classification differs based on whether desktop automation is enabled
    if has_desktop:
        classification = """
CLASSIFICATION:
- CHAT: Greetings, questions, explanations, generating code/text INSIDE this chat window.
- TASK: Physical desktop actions — launch apps, click, type in external windows, run shell commands, file operations.

FOR CHAT: <think>reasoning</think>\nDirect answer here.

FOR TASK: <think>plan</think>\n```json\n[\n  {"tool": "tool_name", "args": {"key": "value"}, "description": "What this does"}\n]\n```
"""
    else:
        classification = """
CLASSIFICATION:
- Respond conversationally. You do NOT have desktop automation tools.
- Use markdown for code, tables, and structured content.
- Be concise and helpful.
"""

    # Skill-specific context sections
    skill_context = ""
    if has_dev:
        skill_context += "\nDEVELOPER MODE: Emphasize code quality, best practices, debugging. Use proper code blocks with language identifiers. Prefer terminal commands for dev tasks.\n"
    if has_admin:
        skill_context += "\nSYSTEM ADMIN MODE: You are comfortable with system administration. Prefer direct shell commands. Always explain what dangerous commands do before running them.\n"
    if has_media:
        skill_context += "\nMEDIA MODE: Help with Spotify, YouTube, media players, and entertainment. Use desktop automation for media controls.\n"
    if has_writing:
        skill_context += "\nWRITING MODE: Help with drafting, editing, and improving text. Use clear, engaging language. Offer multiple variants when helpful.\n"
    if has_research:
        skill_context += "\nRESEARCH MODE: Provide thorough analysis, cite sources when possible, summarize complex topics clearly.\n"
    if has_web:
        skill_context += "\nWEB MODE: Help automate browser tasks. Use open_app → wait_for_window → type_text for browser navigation.\n"
    if has_privacy:
        skill_context += "\nPRIVACY MODE: Prefer local processing. Minimize data exposure. Remind user if a task would send data externally.\n"

    # Tool rules only if desktop automation enabled
    tool_rules = ""
    if has_desktop:
        tool_rules = """
TOOL RULES:
- NEVER use tools not in the AVAILABLE TOOLS section.
- For desktop tasks: open_app → wait_for_window → interact.
- If a window is already open but not in focus, use focus_window first.
- Use shell tool for terminal commands.
- For dangerous tools (shell), describe the full command in "description".

EXAMPLES:
User: "Open Chrome and search for YouTube"
<think>Desktop task — open Chrome, wait, navigate.</think>
```json
[
  {"tool": "open_app", "args": {"app": "google-chrome"}, "description": "Open Google Chrome"},
  {"tool": "wait_for_window", "args": {"title": "Chrome"}, "description": "Wait for Chrome"},
  {"tool": "type_text", "args": {"text": "youtube.com"}, "description": "Type URL"},
  {"tool": "press_key", "args": {"key": "Return"}, "description": "Navigate"}
]
```

User: "Run garuda-update"
<think>Shell command.</think>
```json
[{"tool": "shell", "args": {"command": "garuda-update", "timeout": 120}, "description": "Run garuda-update"}]
```
"""

    return base + classification + skill_context + tool_rules


agent = Agent(
    model=local_llm,
    deps_type=AgentDependencies,
)

@agent.system_prompt
def dynamic_system_prompt(ctx: RunContext[AgentDependencies]) -> str:
    return build_system_prompt(
        skills=ctx.deps.skills or [],
        user_name=ctx.deps.user_name or "",
        custom_prompt=ctx.deps.custom_prompt or ""
    )


def _args_hint(tool) -> str:
    hints = {
        "click": "x: int, y: int, button?: str",
        "type_text": "text: str",
        "press_key": "key: str",
        "open_app": "app: str",
        "click_element": "role: str, name: str",
        "focus_window": "title: str",
        "shell": "command: str",
        "wait_for_window": "title: str, timeout?: float",
        "wait_for_text": "text: str, timeout?: float",
    }
    return hints.get(tool.name, "...")


def build_structured_context(
    goal: str,
    snapshot: DesktopSnapshot,
    history: list,
    current_step: int = 0,
    total_steps: int = 0,
    previous_actions: list = None,
    failed_actions: list = None,
    retry_count: int = 0,
    skills: list = None,
    recalled_memories: list = None,
) -> str:
    """Build the structured context string injected before every agent call."""

    has_desktop = skills is None or "desktop_automation" in (skills or [])

    desktop_state_lines = []
    if snapshot.active_window_title:
        desktop_state_lines.append(f"  Active Window: {snapshot.active_window_title}")
    if snapshot.focused_element_role:
        desktop_state_lines.append(
            f"  Focused Element: [{snapshot.focused_element_role}] '{snapshot.focused_element_text or ''}'"
        )
    if snapshot.accessibility_tree and snapshot.accessibility_tree.get("summary"):
        summary = snapshot.accessibility_tree["summary"][:400]
        desktop_state_lines.append(f"  UI Elements:\n    {summary.replace(chr(10), chr(10)+'    ')}")
    elif snapshot.screen_text_summary:
        desktop_state_lines.append(f"  Screen Text: {snapshot.screen_text_summary[:200]}")
    desktop_state = "\n".join(desktop_state_lines) or "  (not available)"

    execution_lines = []
    if total_steps > 0:
        execution_lines.append(f"  Step: {current_step + 1} of {total_steps}")
    if previous_actions:
        for action in previous_actions[-5:]:
            execution_lines.append(f"  ✓ {action}")
    if failed_actions:
        for action in failed_actions[-3:]:
            execution_lines.append(f"  ✗ FAILED: {action}")
    if retry_count > 0:
        execution_lines.append(f"  Retry Count: {retry_count}")
    execution_ctx = "\n".join(execution_lines) or "  (none)"

    context = f"""OPENSARTHI AGENT CONTEXT
════════════════════════════════════════════════

GOAL:
  {goal}
"""

    if recalled_memories:
        memory_lines = [f"  • {m.content[:200]} (source: {m.source})" for m in recalled_memories]
        context += f"""
RELEVANT PAST CONTEXT / MEMORIES:
{"\n".join(memory_lines)}
"""

    context += f"""
CURRENT DESKTOP STATE:
{desktop_state}

EXECUTION CONTEXT:
{execution_ctx}
"""

    if has_desktop:
        from tools.registry import all_tools
        from tools.base import RiskLevel
        tools = all_tools()
        tool_lines = [f"  • {t.name}({_args_hint(t)}) — {t.description}" for t in tools]
        tools_section = "\n".join(tool_lines)

        safe = [t.name for t in tools if t.risk_level == RiskLevel.SAFE]
        confirm = [t.name for t in tools if t.risk_level == RiskLevel.DANGEROUS]
        perm_lines = []
        if safe:
            perm_lines.append(f"  SAFE (no confirmation): {', '.join(safe)}")
        if confirm:
            perm_lines.append(f"  REQUIRES CONFIRMATION: {', '.join(confirm)}")
        permissions = "\n".join(perm_lines) or "  (all safe)"

        context += f"""
AVAILABLE TOOLS:
{tools_section}

PERMISSIONS:
{permissions}

CONSTRAINTS:
  • Only call tools listed above — do NOT invent tools like brave_search
  • After open_app, always use wait_for_window before interacting
  • If a step fails twice with the same error, report and stop
"""

    context += """
════════════════════════════════════════════════
Based on the above context, generate the next action or respond to the user.
"""
    if has_desktop:
        context += "If this requires multiple steps, output a JSON plan array.\n"

    return context
