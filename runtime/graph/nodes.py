"""
graph/nodes.py — All LangGraph node implementations for OpenSarthi.

Each node is an async function that:
  - Receives the full OpenSarthiState
  - Performs its work (LLM call, tool exec, memory lookup, etc.)
  - Returns a dict of partial state updates to merge

Nodes use the existing PydanticAI agents and tools — no duplication.
"""
from __future__ import annotations
import asyncio
import json
import structlog
from typing import Any, Optional
from langchain_core.runnables import RunnableConfig

from graph.state import OpenSarthiState

logger = structlog.get_logger()


# ── Step deduplication helpers ───────────────────────────────────────────────
def _normalise_step_sig(tool: str, args: dict, description: str) -> str:
    """Build a canonical string signature for a step to check for duplicates."""
    # Normalise args — sort keys so order doesn't matter
    try:
        args_sig = json.dumps(args or {}, sort_keys=True)
    except Exception:
        args_sig = str(args)
    return f"{tool}::{args_sig}"


def _is_step_already_done(tool: str, args: dict, description: str, completed_actions: list[str]) -> bool:
    """
    Returns True if this step appears to duplicate an already-completed action.
    Matching strategy (in order):
      1. Structural signature match: if the step tool and normalised arguments match.
      2. Description substring check: only if the description is custom/detailed (not generic).
    This is the hard programmatic guard — it works even when the LLM ignores
    the REPLANNING prompt instruction to skip completed steps.
    """
    if not completed_actions:
        return False
    
    sig = _normalise_step_sig(tool, args, description)
    desc_lower = (description or tool).lower().strip()
    
    # Generic descriptions we should NEVER duplicate-check based on description text alone
    GENERIC_DESCRIPTIONS = {
        "click", "type_text", "press_key", "click_element", "focus_window",
        "observe_desktop", "wait_for_window", "wait_for_text", "open_app",
        "scroll", "drag", "right_click", "double_click", "screenshot",
        "shell", "read_file", "write_file", "append_file", "delete_file",
        "list_dir", "web_search", "open_url", "python_eval",
        "executed: click", "executed: type_text", "executed: press_key",
        "executed: click_element", "executed: focus_window", "executed: observe_desktop",
        "executed: wait_for_window", "executed: wait_for_text", "executed: open_app",
        "executed: shell", "executed: read_file", "executed: write_file"
    }

    for done in completed_actions:
        done_lower = done.lower().strip()
        
        # If stored in format "sig:::description", extract parts
        if ":::" in done_lower:
            parts = done_lower.split(":::", 1)
            done_sig = parts[0]
            done_desc = parts[1]
        else:
            done_sig = ""
            done_desc = done_lower

        # 1. Structural check: exact tool + arguments signature match
        if done_sig and done_sig == sig.lower():
            return True
        if done_lower.startswith(f"{tool.lower()}::") and (done_lower == sig.lower() or done_sig == sig.lower()):
            return True

        # 2. Description substring check (only if description is NOT generic/short)
        if desc_lower and desc_lower not in GENERIC_DESCRIPTIONS and len(desc_lower) > 8:
            if desc_lower in done_desc or done_desc in desc_lower:
                return True
                
    return False


def _clean_completed_actions(completed: list[str]) -> list[str]:
    """Extract clean, human-readable descriptions from signatures."""
    cleaned = []
    for item in (completed or []):
        if ":::" in item:
            cleaned.append(item.split(":::", 1)[1])
        else:
            cleaned.append(item)
    return cleaned


# ── classify_node ───────────────────────────────────────────────────────────────
async def classify_node(state: OpenSarthiState, config: RunnableConfig) -> dict:
    """Classify the user goal into CHAT | TASK | CLARIFY."""
    model = config["configurable"]["model"]
    from agents.classifier import classify_intent_with_usage
    ws = config["configurable"].get("ws_handler")
    thread_id = config["configurable"].get("thread_id")
    if ws:
        await ws.send_message("graph_node_status", {"node": "CLASSIFY", "status": "running"}, thread_id=thread_id)
    
    if state.classification:
        logger.info("classify_node using pre-resolved classification", classification=state.classification)
        if ws:
            await ws.send_message("graph_node_status", {"node": "CLASSIFY", "status": "done"}, thread_id=thread_id)
        return {"classification": state.classification}

    try:
        classification, usage = await classify_intent_with_usage(model, state.goal)
        token_delta = _extract_tokens(usage)
        logger.info("classify_node", classification=classification, goal=state.goal[:60])
        if ws and usage:
            await ws.accumulate_and_update_tokens(usage, thread_id=thread_id)
        if ws:
            await ws.send_message("graph_node_status", {"node": "CLASSIFY", "status": "done"}, thread_id=thread_id)
        return {
            "classification": classification,
            **_accumulate_tokens(state, token_delta),
        }
    except Exception as e:
        logger.warning("classify_node failed, defaulting to TASK", error=str(e))
        if ws:
            await ws.send_message("graph_node_status", {"node": "CLASSIFY", "status": "done"}, thread_id=thread_id)
        return {"classification": "TASK"}


# ── supervise_node ───────────────────────────────────────────────────────────────
async def supervise_node(state: OpenSarthiState, config: RunnableConfig) -> dict:
    """
    Multi-agent supervisor: classify task into domain(s) and resolve allowed tools.

    Runs ONCE per task before planning. Falls back to GENERAL (all tools) when
    the supervisor is disabled or classification is unavailable.
    """
    from config import settings
    from metrics import start_dispatch_timer, record_dispatch
    ws = config["configurable"].get("ws_handler")
    thread_id = config["configurable"].get("thread_id")
    model = config["configurable"]["model"]
    deps = config["configurable"].get("deps")
    logger_instance = config["configurable"].get("dev_logger")

    # If supervisor is disabled via settings, short-circuit with GENERAL (all tools)
    if not getattr(settings, "use_supervisor", False):
        logger.info("supervise_node: supervisor disabled — using all tools")
        return {"supervisor_disabled": True}

    if ws:
        await ws.send_message("graph_node_status", {"node": "SUPERVISE", "status": "running"}, thread_id=thread_id)

    from agents.supervisor import get_supervisor
    import uuid

    dispatch_id = str(uuid.uuid4())
    supervisor = get_supervisor(ws_handler=ws, model=model, deps=deps, thread_id=thread_id)

    start = start_dispatch_timer()
    try:
        result = await supervisor.classify(state.goal, dispatch_id=dispatch_id)
        is_fallback = result.is_fallback()
        record_dispatch(
            domains=result.to_dict()["domains"],
            confidence=result.confidence,
            allowed_tools=result.allowed_tools,
            start_time=start,
            is_fallback=is_fallback,
        )
        update = {
            "supervisor_domains": result.to_dict()["domains"],
            "supervisor_confidence": result.confidence,
            "supervisor_reason": result.reason,
            "allowed_tools": result.allowed_tools,
            "dispatch_id": dispatch_id,
            "supervisor_result": result.to_dict(),
        }
        if logger_instance:
            prompt_str = supervisor._build_classifier_prompt() if hasattr(supervisor, "_build_classifier_prompt") else None
            logger_instance.log_supervisor_decision(
                domains=result.to_dict()["domains"],
                confidence=result.confidence,
                reason=result.reason,
                allowed_tools=result.allowed_tools,
                dispatch_id=dispatch_id,
                supervisor_prompt=prompt_str,
            )
        if ws:
            await ws.send_message("graph_node_status", {"node": "SUPERVISE", "status": "done"}, thread_id=thread_id)
        return update
    except Exception as e:
        logger.warning("supervise_node failed; falling back to GENERAL", error=str(e))
        # Record the fallback as a metrics event
        record_dispatch(
            domains=["general"],
            confidence=0.0,
            allowed_tools=[],
            start_time=start,
            is_fallback=True,
        )
        if ws:
            await ws.send_message("graph_node_status", {"node": "SUPERVISE", "status": "done"}, thread_id=thread_id)
        return {"supervisor_disabled": True, "allowed_tools": None}


# ── observe_node ────────────────────────────────────────────────────────────────
async def observe_node(state: OpenSarthiState, config: RunnableConfig) -> dict:
    """Take a desktop snapshot and recall relevant memories."""
    ws = config["configurable"].get("ws_handler")
    thread_id = config["configurable"].get("thread_id")
    if ws:
        await ws.send_message("graph_node_status", {"node": "OBSERVE", "status": "running"}, thread_id=thread_id)

    from observation import DesktopObserver
    observer = DesktopObserver()
    snapshot = await observer.snapshot()

    recalled_memories = []
    preferences = []
    memory_manager = config["configurable"].get("memory_manager")
    if memory_manager:
        try:
            raw = await memory_manager.recall(state.goal, top_k=8)
            recalled_memories = [
                {
                    "content": m.content,
                    "source": m.source,
                    "thread_id": m.thread_id,
                    "importance": m.importance,
                }
                for m in raw
            ]
            pref_results = await memory_manager.long.search("[PREFERENCE]", top_k=8)
            seen = {m.content for m in raw}
            for m in pref_results:
                if m.content not in seen:
                    preferences.append({
                        "content": m.content,
                        "source": m.source,
                        "thread_id": m.thread_id,
                        "importance": m.importance,
                    })
                    seen.add(m.content)
        except Exception as e:
            logger.warning("observe_node memory recall failed", error=str(e))

    if ws:
        await ws.send_message("graph_node_status", {"node": "OBSERVE", "status": "done"}, thread_id=thread_id)

    return {
        "desktop_snapshot": snapshot.dict() if hasattr(snapshot, "dict") else vars(snapshot),
        "recalled_memories": recalled_memories,
        "preferences": preferences,
    }


# ── plan_node ───────────────────────────────────────────────────────────────────
async def plan_node(state: OpenSarthiState, config: RunnableConfig) -> dict:
    """Call PydanticAI planner to generate the next action plan."""
    model = config["configurable"]["model"]
    deps = config["configurable"]["deps"]
    ws = config["configurable"].get("ws_handler")
    thread_id = config["configurable"].get("thread_id")

    if ws:
        await ws.send_message("graph_node_status", {"node": "PLAN", "status": "running"}, thread_id=thread_id)

    from planner.agent import agent, build_structured_context
    from observation import DesktopSnapshot

    # Reconstruct snapshot from serialised state
    snapshot_data = state.desktop_snapshot or {}
    try:
        snapshot = DesktopSnapshot(**snapshot_data)
    except Exception:
        snapshot = DesktopSnapshot()

    from memory.long_term import MemoryEntry
    reconstructed_recalled = [MemoryEntry(**m) for m in (state.recalled_memories or [])]
    reconstructed_prefs = [MemoryEntry(**m) for m in (state.preferences or [])]

    context = build_structured_context(
        goal=state.goal,
        snapshot=snapshot,
        history=[],
        current_step=len(state.completed_actions),
        total_steps=len(state.completed_actions) + 1,
        previous_actions=_clean_completed_actions(state.completed_actions),
        failed_actions=state.failed_actions,
        retry_count=state.retry_count,
        skills=getattr(deps, "skills", None),
        recalled_memories=reconstructed_recalled,
        summarized_context=state.summarized_context,
        auto_recalled_memories=reconstructed_prefs if reconstructed_prefs else None,
        allowed_tools=state.allowed_tools,
    )

    logger_instance = config["configurable"].get("dev_logger")
    if logger_instance:
        logger_instance.log_planning_context(state.retry_count, context)

    try:
        result = await agent.run(context, deps=deps, model=model, message_history=state.messages)
        if logger_instance:
            logger_instance.log_llm_response(state.retry_count, result.output)

        usage = getattr(result, "usage", None)
        # Defect 5: pass response text so Ollama (usage=None) gets estimated tokens
        response_text_for_tokens = result.output if isinstance(result.output, str) else ""
        token_delta = _extract_tokens(usage, response_text_for_tokens)

        ws = config["configurable"].get("ws_handler")
        thread_id = config["configurable"].get("thread_id")
        if ws:
            await ws.accumulate_and_update_tokens(usage or token_delta, thread_id=thread_id)

        from agent_runtime import AgentRuntime
        plan, text_response = AgentRuntime._parse_response(None, result.output)

        updates = {**_accumulate_tokens(state, token_delta)}

        if plan is not None:
            #Filter out steps already completed in previous attempts
            # This is the hard programmatic guard that works regardless of LLM compliance.
            # Even if the LLM re-generates a step that was already done, we strip it here.
            completed = state.completed_actions or []
            filtered_steps = []
            skipped_count = 0
            for s in plan.steps:
                step_desc = s.description or s.tool
                step_args = s.args or {}
                if _is_step_already_done(s.tool, step_args, step_desc, completed):
                    logger.info(
                        "plan_node: skipping duplicate step (already completed)",
                        tool=s.tool,
                        description=step_desc[:80],
                    )
                    skipped_count += 1
                else:
                    filtered_steps.append(s)

            if skipped_count:
                logger.info("plan_node: filtered out duplicate steps", count=skipped_count, remaining=len(filtered_steps))

            steps_data = []
            for idx, s in enumerate(filtered_steps):
                steps_data.append({
                    "index": idx,
                    "tool": s.tool,
                    "args": s.args or {},
                    "description": s.description or s.tool,
                    "status": "pending",
                    "verify_with": s.verify_with,
                    "wait_after": s.wait_after,
                    "depends_on": getattr(s, "depends_on", []) or [],
                })
            updates["plan_steps"] = steps_data

            # Preserve finished steps
            finished_prev_steps = [s for s in (state.cumulative_steps or []) if s.get("status") in ("success", "error", "terminated", "divider")]
            if finished_prev_steps:
                divider = {
                    "index": len(finished_prev_steps),
                    "tool": "divider",
                    "status": "divider",
                    "description": f"Replan / Attempt {state.retry_count + 1}",
                }
                offset = len(finished_prev_steps) + 1
                for i, s in enumerate(steps_data):
                    s["index"] = offset + i
                updates["cumulative_steps"] = finished_prev_steps + [divider] + steps_data
            else:
                updates["cumulative_steps"] = steps_data

            updates["current_step_index"] = 0
            if text_response and text_response.strip():
                updates["plan_reasoning"] = text_response.strip()

            if ws:
                import uuid
                await ws.send_message("plan_created", {
                    "id": str(uuid.uuid4()),
                    "goal": plan.goal or state.goal,
                    "steps": updates["cumulative_steps"],
                    "recovery_hint": plan.recovery_hint,
                }, thread_id=thread_id)

                # Emit the LLM's reasoning text (prose before the JSON block) so the frontend
                # can show it as a collapsible "AI Reasoning" block.
                if text_response and text_response.strip():
                    await ws.send_message("plan_reasoning", {
                        "text": text_response.strip(),
                        "attempt": state.retry_count,
                        "thread_id": thread_id,
                    }, thread_id=thread_id)

                # ── Smart overlay: only minimize when plan contains screen-interaction tools ──
                SCREEN_TOOLS = {
                    "click", "type_text", "press_key", "click_element", "focus_window",
                    "observe_desktop", "wait_for_window", "wait_for_text", "open_app",
                    "scroll", "drag", "right_click", "double_click", "screenshot",
                }
                plan_needs_screen = any(s["tool"] in SCREEN_TOOLS for s in steps_data)
                if plan_needs_screen:
                    await ws.send_message("window_control", {
                        "action": "minimize_hint",
                        "reason": "Plan contains screen-interaction steps",
                    }, thread_id=thread_id)
        else:
            updates["final_response"] = text_response or "I couldn't generate a response."
            updates["plan_steps"] = []

        if ws:
            await ws.send_message("graph_node_status", {"node": "PLAN", "status": "done"}, thread_id=thread_id)
        return updates

    except asyncio.CancelledError:
        if ws:
            await ws.send_message("graph_node_status", {"node": "PLAN", "status": "done"}, thread_id=thread_id)
        return {"is_cancelled": True, "final_response": "Execution cancelled by user."}
    except Exception as e:
        logger.error("plan_node failed", error=str(e))
        if ws:
            await ws.send_message("graph_node_status", {"node": "PLAN", "status": "done"}, thread_id=thread_id)
        return {"final_response": f"Planning failed: {e}", "plan_steps": []}


# ── execute_step_node ───────────────────────────────────────────────────────────
async def execute_step_node(state: OpenSarthiState, config: RunnableConfig) -> dict:
    """Execute the current pending step from the plan."""
    ws = config["configurable"].get("ws_handler")
    thread_id = config["configurable"].get("thread_id")
    if ws:
        await ws.send_message("graph_node_status", {"node": "EXECUTE", "status": "running"}, thread_id=thread_id)
    idx = state.current_step_index

    if idx >= len(state.plan_steps):
        if ws:
            await ws.send_message("graph_node_status", {"node": "EXECUTE", "status": "done"}, thread_id=thread_id)
        return {"final_response": "Task completed successfully.", "plan_steps": []}

    # Find the cumulative index for updates
    C = len(state.cumulative_steps or [])
    P = len(state.plan_steps or [])
    cumulative_idx = (C - P) + idx if C >= P else idx

    step_data = state.plan_steps[idx]
    from planner.schemas import PlanStep, ToolResult
    from tools.registry import get as get_tool

    step = PlanStep(**step_data)

    # Even if plan_node already filtered duplicates, this is the last-line-of-defence
    # guard inside the executor — ensures we never re-execute a completed step.
    if _is_step_already_done(step.tool, step.args or {}, step.description or step.tool, state.completed_actions or []):
        logger.info(
            "execute_step_node: step skipped — already completed",
            tool=step.tool,
            description=(step.description or step.tool)[:80],
            step_idx=idx,
        )
        if ws:
            await ws.send_message("tool_action", {
                "tool": step.tool,
                "description": f"[SKIPPED - already completed] {step.description or step.tool}",
                "status": "success",
                "result": "Step was already completed in a previous attempt — skipped.",
            }, thread_id=thread_id)
        return {
            "current_step_index": idx + 1,
            "completed_actions": state.completed_actions,  # No new addition — already there
        }

    tool = get_tool(step.tool)

    if tool is None:
        err = f"Unknown tool: {step.tool}"
        if ws:
            await ws.send_message("tool_error", {
                "index": cumulative_idx, "error": err, "tool": step.tool,
                "description": step.description, "args": step.args,
            }, thread_id=thread_id)
        updated_steps = list(state.cumulative_steps)
        if cumulative_idx < len(updated_steps):
            updated_steps[cumulative_idx] = {**updated_steps[cumulative_idx], "status": "error", "error": err}
        return {
            "last_tool_result": {"success": False, "error": err, "retryable": False},
            "failed_actions": state.failed_actions + [f"{step.description}: {err}"],
            "cumulative_steps": updated_steps,
        }

    # ── Supervisor tool authorization check ──
    # If allowed_tools is set (supervisor active), reject steps using disallowed tools
    if state.allowed_tools is not None and step.tool not in state.allowed_tools:
        err = f"Tool '{step.tool}' not authorized for this task's domain(s). Allowed: {state.allowed_tools}"
        logger.warning("execute_step_node: tool not in allowed_tools", tool=step.tool, allowed=state.allowed_tools)
        if ws:
            await ws.send_message("tool_error", {
                "index": cumulative_idx, "error": err, "tool": step.tool,
                "description": step.description, "args": step.args,
            }, thread_id=thread_id)
            await ws.send_message("tool_action", {
                "tool": step.tool,
                "description": f"[BLOCKED] {step.description or step.tool} — not in allowed tool scope",
                "status": "error",
                "result": err,
            }, thread_id=thread_id)
        updated_steps = list(state.cumulative_steps)
        if cumulative_idx < len(updated_steps):
            updated_steps[cumulative_idx] = {**updated_steps[cumulative_idx], "status": "error", "error": err}
        return {
            "last_tool_result": {"success": False, "error": err, "retryable": False},
            "failed_actions": state.failed_actions + [f"{step.description}: {err}"],
            "cumulative_steps": updated_steps,
        }

    # ── Smart minimize: signal frontend to minimize for screen-interaction tools ──
    SCREEN_TOOLS = {
        "click", "type_text", "press_key", "click_element", "focus_window",
        "observe_desktop", "wait_for_window", "wait_for_text", "open_app",
        "scroll", "drag", "right_click", "double_click", "screenshot",
    }
    NON_SCREEN_TOOLS = {
        "shell", "read_file", "write_file", "append_file", "delete_file",
        "list_dir", "web_search", "open_url", "python_eval",
    }

    if ws:
        if step.tool in SCREEN_TOOLS:
            # Per-step hint removed — overlay controlled at plan level in plan_node
            pass
        elif step.tool in NON_SCREEN_TOOLS:
            # No mid-task restore — window stays in overlay until task completes
            pass

    if ws:
        await ws.send_message("tool_started", {
            "index": cumulative_idx, "tool": step.tool,
            "description": step.description, "args": step.args,
        }, thread_id=thread_id)
        await ws.send_message("tool_action", {
            "tool": step.tool, "description": step.description,
            "status": "running", "result": None,
        }, thread_id=thread_id)

    # Update step status to running
    updated_steps = list(state.cumulative_steps)
    if cumulative_idx < len(updated_steps):
        updated_steps[cumulative_idx] = {**updated_steps[cumulative_idx], "status": "running"}

    # Check if thread is currently paused before running the tool
    if ws and hasattr(ws, "check_pause"):
        await ws.check_pause(state.thread_id)

    try:
        res = await tool.safe_execute(step.args, permission_manager=ws)
    except asyncio.CancelledError:
        res_dict = {"success": False, "error": "Cancelled by user", "retryable": False}
        logger_instance = config["configurable"].get("dev_logger")
        if logger_instance:
            logger_instance.log_tool_call(
                attempt=state.retry_count,
                step_index=cumulative_idx,
                tool_name=step.tool,
                args=step.args,
                result_status="cancelled",
                result_obs="Cancelled by user"
            )
        return {"is_cancelled": True, "last_tool_result": res_dict, "cumulative_steps": updated_steps}
    except Exception as e:
        res_dict = {"success": False, "error": str(e), "retryable": True}
        if ws:
            await ws.send_message("tool_error", {
                "index": cumulative_idx, "error": str(e), "tool": step.tool,
                "description": step.description, "args": step.args,
            }, thread_id=thread_id)
        if cumulative_idx < len(updated_steps):
            updated_steps[cumulative_idx] = {**updated_steps[cumulative_idx], "status": "error", "error": str(e)}
        logger_instance = config["configurable"].get("dev_logger")
        if logger_instance:
            logger_instance.log_tool_call(
                attempt=state.retry_count,
                step_index=cumulative_idx,
                tool_name=step.tool,
                args=step.args,
                result_status="error",
                result_obs=str(e)
            )
        return {
            "last_tool_result": res_dict,
            "failed_actions": state.failed_actions + [f"{step.description}: {e}"],
            "cumulative_steps": updated_steps,
        }

    res_dict = res.dict() if hasattr(res, "dict") else {"success": res.success}
    status_str = "success" if res.success else "error"

    if ws:
        await ws.send_message("tool_action", {
            "tool": step.tool, "description": step.description,
            "status": status_str,
            "result": res.observation if res.success else res.error,
        }, thread_id=thread_id)
        if res.success:
            await ws.send_message("tool_completed", {
                "index": cumulative_idx, "result": res.observation,
                "tool": step.tool, "description": step.description, "args": step.args,
            }, thread_id=thread_id)
        else:
            await ws.send_message("tool_error", {
                "index": cumulative_idx, "error": res.error or "Unknown error",
                "tool": step.tool, "description": step.description, "args": step.args,
            }, thread_id=thread_id)

    # Update cumulative step status
    if cumulative_idx < len(updated_steps):
        step_update = {**updated_steps[cumulative_idx], "status": status_str}
        if res.success:
            step_update["result"] = res.observation
        else:
            step_update["error"] = res.error or "Unknown error"
        updated_steps[cumulative_idx] = step_update

    new_completed = list(state.completed_actions)
    new_failed = list(state.failed_actions)

    if res.success:
        sig = _normalise_step_sig(step.tool, step.args or {}, step.description or step.tool)
        new_completed.append(f"{sig}:::{step.description or step.tool}")
        # Handle wait_after
        if step.wait_after:
            await asyncio.sleep(step.wait_after)
    else:
        new_failed.append(f"{step.description or step.tool} (Reason: {res.error or 'Unknown error'})")

    logger_instance = config["configurable"].get("dev_logger")
    if logger_instance:
        logger_instance.log_tool_call(
            attempt=state.retry_count,
            step_index=cumulative_idx,
            tool_name=step.tool,
            args=step.args,
            result_status=status_str,
            result_obs=res.observation if res.success else (res.error or "Unknown error")
        )

    if ws:
        await ws.send_message("graph_node_status", {"node": "EXECUTE", "status": "done"}, thread_id=thread_id)

    return {
        "last_tool_result": res_dict,
        "current_step_index": idx + 1,
        "completed_actions": new_completed,
        "failed_actions": new_failed,
        "cumulative_steps": updated_steps,
    }


# ── heal_node ───────────────────────────────────────────────────────────────────
async def heal_node(state: OpenSarthiState, config: RunnableConfig) -> dict:
    """Try to self-heal a failed step using HealerAgent."""
    model = config["configurable"]["model"]
    deps = config["configurable"]["deps"]
    ws = config["configurable"].get("ws_handler")
    thread_id = config["configurable"].get("thread_id")

    if ws:
        await ws.send_message("graph_node_status", {"node": "HEAL", "status": "running"}, thread_id=thread_id)

    idx = state.current_step_index - 1
    if idx < 0 or idx >= len(state.plan_steps):
        if ws:
            await ws.send_message("graph_node_status", {"node": "HEAL", "status": "done"}, thread_id=thread_id)
        return {}

    # Track and limit self-heal attempts per step index to avoid infinite loops
    attempts = state.heal_attempts.get(idx, 0) + 1
    if attempts > 2:
        logger.warning("Step index has exceeded maximum self-heal attempts. Aborting heal and forcing replan.", step_index=idx)
        if ws:
            await ws.send_message("tool_action", {
                "tool": "self_heal",
                "description": f"Self-healing limit exceeded for: {state.plan_steps[idx].get('tool')}",
                "status": "error", "result": "Exceeded maximum self-healing attempts (2). Retrying with a new plan...",
            }, thread_id=thread_id)
            await ws.send_message("graph_node_status", {"node": "HEAL", "status": "done"}, thread_id=thread_id)
        # Return state update with incremented attempts, but no patched steps, which triggers a replan edge
        return {"heal_attempts": {**state.heal_attempts, idx: attempts}}

    step_data = state.plan_steps[idx]
    last_result = state.last_tool_result or {}
    err_msg = (last_result.get("error") or "")[:200]

    if ws:
        await ws.send_message("tool_action", {
            "tool": "self_heal",
            "description": f"Self-healing: {step_data.get('description', step_data.get('tool'))}",
            "status": "running", "result": None,
        }, thread_id=thread_id)

    try:
        from observation import DesktopObserver
        observer = DesktopObserver()
        snap = await observer.snapshot()
        screen_text = getattr(snap, "screen_text_summary", "") or ""

        from agents.healer import HealerAgent
        healer = HealerAgent(model, deps)
        healed = await healer.diagnose_and_fix(
            failed_tool=step_data["tool"],
            failed_args=step_data.get("args", {}),
            description=step_data.get("description", step_data["tool"]),
            error=err_msg,
            screen_summary=screen_text,
            allowed_tools=state.allowed_tools,
        )

        usage = getattr(healer, "last_usage", None)
        token_delta = _extract_tokens(usage)
        thread_id = config["configurable"].get("thread_id")
        if ws and usage:
            await ws.accumulate_and_update_tokens(usage, thread_id=thread_id)

        accumulated = _accumulate_tokens(state, token_delta)

        # Validate healed tool is in allowed_tools scope (if supervisor active)
        if healed and state.allowed_tools is not None and healed["tool"] not in state.allowed_tools:
            logger.warning(
                "heal_node: healed tool outside allowed scope — rejecting",
                healed_tool=healed["tool"],
                allowed=state.allowed_tools,
            )
            healed = None

        if healed:
            # Patch the plan_steps with healed tool/args so execute_step_node retries it
            updated_steps = list(state.plan_steps)
            healed_desc = f"[HEALED] {step_data.get('description')} → {healed.get('description', '')}"
            updated_steps[idx] = {
                **step_data,
                "tool": healed["tool"],
                "args": healed.get("args", {}),
                "description": healed_desc,
            }

            # also patch cumulative_steps so the UI reflects the healed state
            # and ReviewerAgent can learn the correct step for future plans.
            C = len(state.cumulative_steps or [])
            P = len(state.plan_steps or [])
            cumulative_idx = (C - P) + idx if C >= P else idx
            updated_cumulative = list(state.cumulative_steps or [])
            if 0 <= cumulative_idx < len(updated_cumulative):
                updated_cumulative[cumulative_idx] = {
                    **updated_cumulative[cumulative_idx],
                    "tool": healed["tool"],
                    "args": healed.get("args", {}),
                    "description": healed_desc,
                    "status": "pending",  # Reset to pending — will be retried
                }

            if ws:
                await ws.send_message("tool_action", {
                    "tool": "self_heal",
                    "description": f"Self-healing: {step_data.get('description')}",
                    "status": "success",
                    "result": f"Applying correction: {healed.get('description', healed['tool'])}",
                }, thread_id=thread_id)
                await ws.send_message("graph_node_status", {"node": "HEAL", "status": "done"}, thread_id=thread_id)
            return {
                "plan_steps": updated_steps,
                "cumulative_steps": updated_cumulative,
                "current_step_index": idx,  # Retry same step
                "heal_attempts": {**state.heal_attempts, idx: attempts},
                **accumulated,
            }
        else:
            if ws:
                await ws.send_message("tool_action", {
                    "tool": "self_heal",
                    "description": f"Self-healing: {step_data.get('description')}",
                    "status": "error",
                    "result": "No healing path found.",
                }, thread_id=thread_id)
                await ws.send_message("graph_node_status", {"node": "HEAL", "status": "done"}, thread_id=thread_id)
            return {
                "heal_attempts": {**state.heal_attempts, idx: attempts},
                **accumulated,
            }
    except Exception as e:
        logger.debug("heal_node exception", error=str(e))
        if ws:
            try:
                await ws.send_message("graph_node_status", {"node": "HEAL", "status": "done"}, thread_id=thread_id)
            except Exception:
                pass
        return {
            "heal_attempts": {**state.heal_attempts, idx: attempts},
            **_accumulate_tokens(state, _extract_tokens(getattr(healer, "last_usage", None) if 'healer' in locals() else None)),
        }


# ── review_node ─────────────────────────────────────────────────────────────────
async def review_node(state: OpenSarthiState, config: RunnableConfig) -> dict:
    """ReviewerAgent learns from execution and formats final response."""
    model = config["configurable"]["model"]
    deps = config["configurable"]["deps"]
    memory_manager = config["configurable"].get("memory_manager")

    completed = state.completed_actions or []
    cleaned_completed = _clean_completed_actions(completed)
    failed = state.failed_actions or []
    max_retries_reached = state.retry_count >= state.max_retries
    has_successes = bool(completed)

    ws = config["configurable"].get("ws_handler")
    thread_id = config["configurable"].get("thread_id")
    logger_instance = config["configurable"].get("dev_logger")

    if ws:
        await ws.send_message("graph_node_status", {"node": "REVIEW", "status": "running"}, thread_id=thread_id)

    if memory_manager and (completed or failed):
        outcome = "SUCCESS" if (completed and not max_retries_reached) else f"FAILED: {state.final_response[:100] if state.final_response else 'Max retries reached'}"
        from agents.reviewer import ReviewerAgent
        reviewer = ReviewerAgent(model, deps)
        
        async def run_review_bg():
            try:
                await reviewer.review_and_learn(
                    goal=state.goal,
                    execution_log=state.cumulative_steps,
                    outcome=outcome,
                    memory_manager=memory_manager,
                    ws_handler=ws,
                    thread_id=thread_id,
                    dev_logger=logger_instance,
                )
            finally:
                if ws:
                    await ws.send_message("graph_node_status", {"node": "REVIEW", "status": "done"}, thread_id=thread_id)

        asyncio.create_task(run_review_bg())
        
        if completed and not max_retries_reached:
            # Store successful execution summary in memory
            asyncio.create_task(memory_manager.store(
                content=f"Goal: {state.goal}\nOutcome: Completed successfully.\nActions: {cleaned_completed}",
                source="agent",
                importance=0.9,
            ))
        else:
            # Store failed execution summary in memory
            asyncio.create_task(memory_manager.store(
                content=f"Goal: {state.goal}\nOutcome (Failed): {outcome}\nCompleted: {cleaned_completed}\nFailed: {failed}",
                source="agent",
                importance=0.7,
            ))
    else:
        # No review needed, immediately mark done
        if ws:
            try:
                await ws.send_message("graph_node_status", {"node": "REVIEW", "status": "done"}, thread_id=thread_id)
            except Exception:
                pass

    ws = config["configurable"].get("ws_handler")
    final = state.final_response

    token_delta = {"req": 0, "res": 0, "tot": 0}
    # If final response is not set or is generic default, format based on actual execution outcome
    if not final or final in ("Task completed successfully.", "Task completed."):
        goal = state.goal or ""
        steps = state.cumulative_steps or []
        action_count = len(cleaned_completed)
        plural = "step" if action_count == 1 else "steps"

        # Determine if execution ended in failure
        if max_retries_reached or (failed and not has_successes):
            failed_summary = ""
            if failed:
                # Show unique failure reasons
                unique_failures = list(dict.fromkeys(failed))[-3:]
                failed_summary = "\n".join(f"- ❌ {f}" for f in unique_failures)
            else:
                failed_summary = "- Could not generate a working plan for this task."

            final = (
                f"⚠️ I couldn't complete the task: **{goal}**\n\n"
                f"**Errors encountered:**\n{failed_summary}\n\n"
                f"*Please check if the required application or tool is available and try again.*"
            )
        else:
            # Let the LLM format the final response based on observations
            from pydantic_ai import Agent as PydanticAgent
            formatter = PydanticAgent(
                model=model,
                system_prompt=(
                    "You are OpenSarthi review agent. Your task is to generate a helpful, user-friendly, and well-formatted final response "
                    "to the user based on the execution log. The user asked for a goal, and we executed several tools (e.g. terminal shell commands, web searches, etc.).\n"
                    "RULES:\n"
                    "1. DO NOT include generic meta-text like 'Task completed!', '✅ Done!', or 'I have finished this in 1 step'. The user already knows the task is done.\n"
                    "2. Directly present the structured/formatted results (e.g. terminal command stdout, system specs, web search answers) clearly in Markdown.\n"
                    "3. Keep the tone professional, concise, and helpful."
                )
            )

            steps_log = []
            for i, s in enumerate(steps):
                status = s.get("status", "unknown")
                tool = s.get("tool", "unknown")
                desc = s.get("description", "")
                result = s.get("result") or s.get("observation") or ""
                error = s.get("error") or ""

                step_str = f"Step {i+1} (Tool: {tool}, Description: {desc}):\nStatus: {status.upper()}"
                if error:
                    step_str += f"\nError: {error}"
                if result:
                    step_str += f"\nResult/Output:\n{result}"
                steps_log.append(step_str)

            prompt = (
                f"Original User Goal: {goal}\n\n"
                f"Execution Steps Log:\n"
                f"{chr(10).join(steps_log)}\n"
            )

            token_delta = {"req": 0, "res": 0, "tot": 0}
            try:
                if logger_instance:
                    logger_instance.log("ReviewerAgent formatting final response...")
                    try:
                        import os
                        filepath_prompt = os.path.join(logger_instance.run_dir, "reviewer_prompt.txt")
                        with open(filepath_prompt, "w", encoding="utf-8") as f:
                            f.write(prompt)
                    except Exception as e:
                        logger_instance.log(f"Failed to log review formatter prompt: {e}")

                res = await formatter.run(prompt, deps=deps)
                final = res.output.strip()

                if logger_instance:
                    try:
                        import os
                        filepath_res = os.path.join(logger_instance.run_dir, "reviewer_response.txt")
                        with open(filepath_res, "w", encoding="utf-8") as f:
                            f.write(final)
                        logger_instance.log("Logged ReviewerAgent final response.")
                    except Exception as e:
                        logger_instance.log(f"Failed to log review formatter response: {e}")

                usage = getattr(res, "usage", None)
                token_delta = _extract_tokens(usage, final)
                thread_id = config["configurable"].get("thread_id")
                if ws:
                    await ws.accumulate_and_update_tokens(usage or token_delta, thread_id=thread_id)
            except Exception as e:
                logger.error("LLM final response generation failed, falling back to manual format", error=str(e))
                # Fallback manual template if LLM call fails
                key_results = []
                for s in steps:
                    if s.get("status") == "success":
                        obs = s.get("result") or s.get("observation")
                        desc = s.get("description") or s.get("tool", "")
                        tool_name = s.get("tool", "")
                        if obs and isinstance(obs, str) and obs.strip() and len(obs.strip()) > 10:
                            obs_clean = obs.strip()
                            if tool_name == "search_web" or "search_web" in desc.lower():
                                blocks = obs_clean.split("\n\n---\n\n")
                                formatted_blocks = []
                                for block in blocks:
                                    lines = block.split("\n")
                                    if len(lines) >= 3:
                                        title = lines[0].replace("**", "").strip()
                                        snippet = lines[1].strip()
                                        url_val = lines[2].strip()
                                        formatted_blocks.append(f"##### 🔗 [{title}]({url_val})\n>{snippet}")
                                    else:
                                        formatted_blocks.append(block)
                                key_results.append("### 🔍 Web Search Results:\n" + "\n\n".join(formatted_blocks))
                            else:
                                key_results.append(f"- **{desc}**: {obs_clean[:1000]}")
                if key_results:
                    final = "\n\n".join(key_results[:5])
                elif completed:
                    final = "\n".join(f"- {a}" for a in completed[:8])
                else:
                    final = f"Goal complete: **{goal}**."

    # Restore window overlay after task completes
    if ws:
        try:
            await ws.send_message("window_control", {"action": "restore_hint"}, thread_id=thread_id)
        except Exception:
            pass

    return {
        "final_response": final,
        **_accumulate_tokens(state, token_delta),
    }


# ── chat_node ───────────────────────────────────────────────────────────────────
async def chat_node(state: OpenSarthiState, config: RunnableConfig) -> dict:
    """Handle CHAT classification: direct conversational LLM response."""
    model = config["configurable"]["model"]
    deps = config["configurable"]["deps"]
    ws = config["configurable"].get("ws_handler")
    thread_id = config["configurable"].get("thread_id")

    if ws:
        await ws.send_message("graph_node_status", {"node": "CHAT", "status": "running"}, thread_id=thread_id)

    from planner.agent import build_system_prompt
    from pydantic_ai import Agent as PydanticAgent

    # Retrieve memories for chat context
    memory_manager = config["configurable"].get("memory_manager")
    memories_list = []
    if memory_manager:
        try:
            auto_recalled = await memory_manager.recall(state.goal, top_k=5)
            pref_results = await memory_manager.long.search("[PREFERENCE]", top_k=8)
            seen = {m.content for m in auto_recalled}
            for m in pref_results:
                if m.content not in seen:
                    auto_recalled.append(m)
                    seen.add(m.content)
            memories_list = [m.content for m in auto_recalled]
        except Exception:
            pass

    sys_prompt = build_system_prompt(
        skills=getattr(deps, "skills", []),
        user_name=getattr(deps, "user_name", ""),
        custom_prompt=getattr(deps, "custom_prompt", ""),
        chat_only=True,
        memories=memories_list,
    )

    chat_agent = PydanticAgent(model=model, system_prompt=sys_prompt)

    try:
        result = await chat_agent.run(state.goal, message_history=state.messages)
        final_text = result.output
        usage = getattr(result, "usage", None)
        #pass response text so Ollama (usage=None) gets estimated tokens
        token_delta = _extract_tokens(usage, final_text)

        # Stream word-by-word if ws_handler supports it
        if ws and hasattr(ws, "stream_text"):
            await ws.stream_text(final_text, thread_id=state.thread_id)

        if ws:
            await ws.send_message("graph_node_status", {"node": "CHAT", "status": "done"}, thread_id=thread_id)
        return {
            "final_response": final_text,
            **_accumulate_tokens(state, token_delta),
        }
    except asyncio.CancelledError:
        if ws:
            await ws.send_message("graph_node_status", {"node": "CHAT", "status": "done"}, thread_id=thread_id)
        return {"is_cancelled": True, "final_response": "Cancelled."}
    except Exception as e:
        if ws:
            await ws.send_message("graph_node_status", {"node": "CHAT", "status": "done"}, thread_id=thread_id)
        return {"final_response": f"Chat failed: {e}"}


# ── Helpers ─────────────────────────────────────────────────────────────────────
def _extract_tokens(usage: Any, response_text: str = "") -> dict:
    """Extract token counts from a PydanticAI usage object.

    Defect 5 Fix: Ollama and some local providers return usage=None.
    When usage is None, fall back to a word-count heuristic so the Token
    Tracking HUD always shows *something* rather than a permanent 0.
    The estimated values are marked with a negative sign convention internally;
    the UI should display them with a '~' prefix to indicate approximation.
    """
    if usage:
        req = getattr(usage, "request_tokens", getattr(usage, "input_tokens", 0)) or 0
        res = getattr(usage, "response_tokens", getattr(usage, "output_tokens", 0)) or 0
        tot = getattr(usage, "total_tokens", 0) or 0
        if tot == 0 and (req or res):
            tot = req + res
        return {"req": req, "res": res, "tot": tot}

    # Heuristic fallback for providers that return usage=None (e.g. Ollama)
    if response_text:
        # Rough estimate: ~1.3 tokens per word
        estimated_res = int(len(response_text.split()) * 1.3)
        # Mark as estimated with negative values — callers can detect this
        return {"req": 0, "res": estimated_res, "tot": estimated_res, "estimated": True}

    return {"req": 0, "res": 0, "tot": 0}


def _accumulate_tokens(state: OpenSarthiState, delta: dict) -> dict:
    return {
        "total_request_tokens": state.total_request_tokens + delta.get("req", 0),
        "total_response_tokens": state.total_response_tokens + delta.get("res", 0),
        "total_tokens": state.total_tokens + delta.get("tot", 0),
    }
