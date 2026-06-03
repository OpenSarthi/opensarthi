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


# ─── Overhauled System Prompt ────────────────────────────────────────────────

def build_system_prompt(skills: list, user_name: str, custom_prompt: str) -> str:
    has_desktop  = "desktop_automation" in skills
    has_dev      = "developer" in skills
    has_admin    = "system_admin" in skills
    has_media    = "media" in skills
    has_writing  = "writing" in skills
    has_research = "research" in skills
    has_web      = "web" in skills
    has_privacy  = "privacy" in skills

    name_clause = f"The user's name is {user_name}. Address them by name occasionally when it feels natural." if user_name else ""
    custom_clause = f"\n\nUSER CUSTOM INSTRUCTIONS (follow these precisely):\n{custom_prompt}" if custom_prompt else ""

    # ─── Core Identity ─────────────────────────────────────────────────────
    base = f"""You are OpenSarthi, a precise and reliable AI desktop assistant for Linux.
{name_clause}{custom_clause}

━━━ THINKING PROTOCOL ━━━
Before every response, think inside <think>...</think> tags.
In your thinking: classify the request, check the current desktop state, identify which tools are needed, and plan the exact sequence.
After </think>, output ONLY the final response — no preamble, no "I will now...", no meta-commentary.

━━━ OUTPUT FORMAT ━━━
For conversational responses: plain markdown. Use headers, bullets, code blocks as appropriate.
For desktop tasks: output a single JSON array of steps inside a ```json block.
NEVER mix prose with a JSON plan in the same response.
NEVER output incomplete JSON.

━━━ CLASSIFICATION ━━━
Classify every user input as one of:
- CHAT → Questions, explanations, content generation, coding help in this chat window. Respond with markdown.
- TASK → Physical actions on the desktop: open apps, click, type in external windows, run commands, file operations.
- CLARIFY → Ambiguous request where you need more information before acting.

For CLARIFY: ask one specific, direct question. Do not make assumptions.
"""

    # ─── Desktop Automation (only if skill active) ─────────────────────────
    if has_desktop:
        base += """
━━━ DESKTOP TASK RULES ━━━
You have access to a set of desktop tools. These are the ONLY tools that exist.
DO NOT invent, hallucinate, or reference any tool not listed in AVAILABLE TOOLS below.

WINDOW DISCIPLINE (critical — read carefully):
• OpenSarthi sits pinned to the right edge of the screen. It loses focus when you interact with other windows.
• The system automatically re-focuses the task window before each type/click action using the pinned window ID.
• You do NOT need to re-focus manually unless the active window changed unexpectedly.
• Use exact window titles from CURRENT DESKTOP STATE. NEVER guess or invent a window title.
• If the window title is unknown: call observe_desktop first to see what is open.

MANDATORY SEQUENCE FOR APP TASKS:
1. open_app — launch the application
2. wait_for_window — wait until the window appears (this also pins it as the target)
3. [interact] — type/click/press_key as needed

STRICT RULES:
• If the same tool fails twice with the same error → STOP. Report the failure. Do NOT retry further.
• If you are unsure about the current UI state → call observe_desktop before acting.
• After typing a URL or command → always press Return/Enter explicitly.
• Shell tool runs commands in a sandboxed terminal. Not all system commands are permitted.
• Coordinate clicks (click tool) are unreliable if window is resized/moved. Prefer click_element when possible.
• wait_after is NOT needed between steps unless you expect a UI transition that takes visible time.

JSON PLAN FORMAT:
```json
[
  {"tool": "tool_name", "args": {"key": "value"}, "description": "Human-readable description of this step", "verify_with": "optional: window title or text to verify success", "wait_after": null}
]
```

TASK COMPLETION:
• After the last step, add a brief summary of what was done as your text response.
• If the task could not be completed, explain exactly which step failed and why.
"""

    else:
        base += """
━━━ CHAT MODE ━━━
Desktop automation is not enabled. Respond conversationally.
Use markdown for code, tables, and structured content.
Be concise, accurate, and helpful.
"""

    # ─── Skill-specific context sections ──────────────────────────────────
    skill_sections = []
    if has_dev:
        skill_sections.append(
            "DEVELOPER CONTEXT: Prioritize code quality and correctness. Use proper language identifiers in code blocks. "
            "Explain shell commands before suggesting them. Prefer idiomatic solutions."
        )
    if has_admin:
        skill_sections.append(
            "SYSTEM ADMIN CONTEXT: Use direct, efficient shell commands. "
            "Always explain what a destructive command does before including it in a plan. "
            "Prefer non-destructive read operations first to verify state."
        )
    if has_media:
        skill_sections.append(
            "MEDIA CONTEXT: Help with Spotify, YouTube, VLC, and media players. "
            "Use open_app + wait_for_window + keyboard shortcuts for media controls."
        )
    if has_writing:
        skill_sections.append(
            "WRITING CONTEXT: Help with drafting, editing, and improving text. "
            "Offer multiple variants when the user wants options. Match the user's tone."
        )
    if has_research:
        skill_sections.append(
            "RESEARCH CONTEXT: Provide thorough, accurate analysis. Cite sources when possible. "
            "Break down complex topics into clear, digestible sections."
        )
    if has_web:
        skill_sections.append(
            "WEB CONTEXT: For browser automation — open_app → wait_for_window → type URL → press Return. "
            "Use observe_desktop to confirm the page loaded before further actions."
        )
    if has_privacy:
        skill_sections.append(
            "PRIVACY CONTEXT: Prefer local processing. Notify the user before any action that would send data externally. "
            "Do not log or expose sensitive user data in tool arguments."
        )

    if skill_sections:
        base += "\n━━━ ACTIVE CONTEXT ━━━\n" + "\n".join(f"• {s}" for s in skill_sections) + "\n"

    return base


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
        "observe_desktop": "(no args)",
        "shell": "command: str, timeout?: float",
        "wait_for_window": "title: str, timeout?: float",
        "wait_for_text": "text: str, timeout?: float",
        "media_control": "action: str",
        "remember": "fact: str, importance?: float",
        "recall": "query: str",
        "save_note": "title: str, content: str",
        "get_notes": "query?: str",
        "self_fix": "description: str, target_file: str",
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
    summarized_context: str = None,
) -> str:
    """Build the structured context string injected before every agent call."""

    has_desktop = skills is None or "desktop_automation" in (skills or [])

    # ─── Desktop State ─────────────────────────────────────────────────────
    desktop_state_lines = []
    if snapshot.active_window_title:
        desktop_state_lines.append(f"  Active Window: {snapshot.active_window_title}")
    if snapshot.active_window_pid:
        desktop_state_lines.append(f"  Active Window PID: {snapshot.active_window_pid}")
    if snapshot.focused_element_role:
        desktop_state_lines.append(
            f"  Focused Element: [{snapshot.focused_element_role}] '{snapshot.focused_element_text or ''}'"
        )
    if snapshot.accessibility_tree and snapshot.accessibility_tree.get("summary"):
        summary = snapshot.accessibility_tree["summary"][:500]
        desktop_state_lines.append(f"  UI Elements:\n    {summary.replace(chr(10), chr(10)+'    ')}")
    elif snapshot.screen_text_summary:
        desktop_state_lines.append(f"  Screen Text (OCR): {snapshot.screen_text_summary[:200]}")

    # Pinned window session state
    try:
        from window_session import get_session
        sess = get_session()
        if sess.is_pinned:
            desktop_state_lines.append(f"  Pinned Task Window: '{sess.pinned_window_title}' (ID: {sess.pinned_window_id})")
    except Exception:
        pass

    desktop_state = "\n".join(desktop_state_lines) or "  (unavailable — call observe_desktop to inspect)"

    # ─── Execution Context ─────────────────────────────────────────────────
    execution_lines = []
    if total_steps > 0:
        execution_lines.append(f"  Step: {current_step + 1} of {total_steps}")
    if retry_count > 0:
        execution_lines.append(f"  Replan Attempt: {retry_count} (STOP if ≥ 3 with no progress)")
    if previous_actions:
        for action in previous_actions[-5:]:
            execution_lines.append(f"  ✓ {action}")
    if failed_actions:
        for action in failed_actions[-3:]:
            execution_lines.append(f"  ✗ FAILED: {action}")
    execution_ctx = "\n".join(execution_lines) or "  (none)"

    # ─── Context Assembly ──────────────────────────────────────────────────
    context = f"""━━━ OPENSARTHI AGENT CONTEXT ━━━

GOAL:
  {goal}
"""

    # Compressed conversation summary (replaces raw history when available)
    if summarized_context:
        context += f"""
CONVERSATION SUMMARY:
  {summarized_context}
"""

    if recalled_memories:
        memory_lines = [f"  • {m.content[:200]} (source: {m.source})" for m in recalled_memories]
        context += f"""
RELEVANT MEMORIES:
{chr(10).join(memory_lines)}
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
        tool_lines = [f"  • {t.name}({_args_hint(t)}) — {t.description[:80]}" for t in tools]
        tools_section = "\n".join(tool_lines)

        safe = [t.name for t in tools if t.risk_level == RiskLevel.SAFE]
        confirm = [t.name for t in tools if t.risk_level == RiskLevel.DANGEROUS]
        perm_lines = []
        if safe:
            perm_lines.append(f"  SAFE (auto-execute): {', '.join(safe)}")
        if confirm:
            perm_lines.append(f"  REQUIRES CONFIRMATION: {', '.join(confirm)}")
        permissions = "\n".join(perm_lines) or "  (all safe)"

        context += f"""
AVAILABLE TOOLS (ONLY use these — do NOT invent others):
{tools_section}

PERMISSIONS:
{permissions}

HARD CONSTRAINTS:
  • Only call tools listed above
  • If same tool fails twice with same error → STOP immediately and report
  • After open_app → always call wait_for_window before interacting
  • Use exact window titles from CURRENT DESKTOP STATE above
  • If desktop state is stale or missing → call observe_desktop first
"""

    context += """
━━━ END OF CONTEXT ━━━
Based on the above, generate the next action or respond to the user.
"""
    if has_desktop:
        context += "If this is a TASK, output a JSON plan array. If CHAT, respond with markdown.\n"

    return context
