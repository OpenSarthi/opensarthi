"""
HealerAgent — Self-healing step correction for OpenSarthi.

When a plan step fails, instead of immediately retrying with the same args,
the Healer performs a targeted LLM diagnosis and returns a corrected PlanStep
with patched args or an alternative tool. If healing isn't possible, returns None
and the caller falls back to normal replanning.
"""
import json
import asyncio
import structlog
from typing import Optional

logger = structlog.get_logger()


class HealerAgent:
    """
    Diagnoses a failed desktop automation step and proposes a corrected version.
    Uses the same active model but with a short, focused prompt to minimise latency.
    """

    # Known healing heuristics that require no LLM call at all
    _QUICK_HEALS = {
        "click": "Try using click_element instead of absolute-coordinate click.",
        "type_text": "Ensure the target field has focus — add a click step before typing.",
        "open_app": "Verify the app name is correct for this Linux distro.",
        "wait_for_window": "Increase timeout or check the exact window title with observe_desktop.",
    }

    def __init__(self, model, deps):
        self.model = model
        self.deps = deps
        # Create the pydantic-ai agent once — re-used on every diagnosis call
        try:
            from pydantic_ai import Agent as PydanticAgent
            self._agent = PydanticAgent(model=self.model)
        except Exception:
            self._agent = None  # Graceful degradation if model not ready yet

    async def diagnose_and_fix(
        self,
        failed_tool: str,
        failed_args: dict,
        description: str,
        error: str,
        screen_summary: str,
    ) -> Optional[dict]:
        """
        Returns a corrected step dict `{tool, args, description}`, or None.
        """
        logger.info(
            "HealerAgent diagnosing failure",
            tool=failed_tool,
            error=error[:120],
        )

        # ── 1. Quick heuristic fix (no LLM needed) ────────────────────────
        if failed_tool == "type_text" and "focus" in (error or "").lower():
            logger.info("HealerAgent: quick-heal — inject click before type_text")
            return {
                "tool": "click_element",
                "args": {"role": "entry", "name": ""},
                "description": "[HEALED] Focus input field before typing",
            }

        # ── 2. LLM-based diagnosis ─────────────────────────────────────────
        try:
            if self._agent is None:
                # Lazy fallback: try again if it wasn't ready at init
                from pydantic_ai import Agent as PydanticAgent
                self._agent = PydanticAgent(model=self.model)

            from tools.registry import all_tools
            tool_names = [t.name for t in all_tools()]

            prompt = f"""You are a desktop-automation self-healing module.
A step in an automation task failed. Your job is to propose a corrected version of that step.

FAILED STEP:
  tool: {failed_tool}
  args: {json.dumps(failed_args)}
  description: {description}
  error: {error}

CURRENT SCREEN STATE:
{screen_summary[:800] if screen_summary else "(unavailable)"}

AVAILABLE TOOLS (you may only suggest one of these):
{", ".join(tool_names)}

HEALING RULES:
- If click fails with coordinate issues → use click_element with accessible role/name
- If type_text fails without focus → prepend a click/focus step (return the FOCUS step only)
- If open_app fails → try alternate app name (e.g. "google-chrome-stable" instead of "chrome")
- If wait_for_window times out → return with increased timeout (add 3000ms)
- If the tool is fundamentally wrong → suggest a better tool
- If you cannot fix it → respond with exactly: null

RESPONSE FORMAT (JSON object or null — nothing else):
{{"tool": "tool_name", "args": {{"key": "value"}}, "description": "brief human description"}}
"""
            result = await asyncio.wait_for(
                self._agent.run(prompt),
                timeout=20.0
            )
            raw = result.output.strip()

            if raw.lower() in ("null", "none", ""):
                logger.info("HealerAgent: LLM could not propose a fix")
                return None

            fixed_step = None
            try:
                fixed_step = json.loads(raw)
            except json.JSONDecodeError:
                start_idx = raw.find('{')
                end_idx = raw.rfind('}')
                if start_idx != -1 and end_idx != -1 and end_idx > start_idx:
                    try:
                        fixed_step = json.loads(raw[start_idx:end_idx+1])
                    except json.JSONDecodeError:
                        pass

            if not fixed_step or not isinstance(fixed_step, dict) or "tool" not in fixed_step:
                return None

            if fixed_step["tool"] not in tool_names:
                logger.warning("HealerAgent proposed unknown tool", tool=fixed_step["tool"])
                return None

            logger.info(
                "HealerAgent proposed fix",
                original=failed_tool,
                healed=fixed_step["tool"],
                args=fixed_step.get("args"),
            )
            return fixed_step

        except asyncio.TimeoutError:
            logger.warning("HealerAgent timed out after 20s")
            return None
        except Exception as e:
            logger.warning("HealerAgent error", error=str(e))
            return None
