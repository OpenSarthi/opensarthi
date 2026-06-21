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


# ── classify_node ───────────────────────────────────────────────────────────────
async def classify_node(state: OpenSarthiState, config: RunnableConfig) -> dict:
    """Classify the user goal into CHAT | TASK | CLARIFY."""
    model = config["configurable"]["model"]
    from agents.classifier import classify_intent_with_usage
    try:
        classification, usage = await classify_intent_with_usage(model, state.goal)
        token_delta = _extract_tokens(usage)
        logger.info("classify_node", classification=classification, goal=state.goal[:60])
        return {
            "classification": classification,
            **_accumulate_tokens(state, token_delta),
        }
    except Exception as e:
        logger.warning("classify_node failed, defaulting to TASK", error=str(e))
        return {"classification": "TASK"}


# ── observe_node ────────────────────────────────────────────────────────────────
async def observe_node(state: OpenSarthiState, config: RunnableConfig) -> dict:
    """Take a desktop snapshot and recall relevant memories."""
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
        previous_actions=state.completed_actions,
        failed_actions=state.failed_actions,
        retry_count=state.retry_count,
        skills=getattr(deps, "skills", None),
        recalled_memories=reconstructed_recalled,
        summarized_context=state.summarized_context,
        auto_recalled_memories=reconstructed_prefs if reconstructed_prefs else None,
    )

    logger_instance = config["configurable"].get("dev_logger")
    if logger_instance:
        logger_instance.log_planning_context(state.retry_count, context)

    try:
        result = await agent.run(context, deps=deps, model=model, message_history=state.messages)
        if logger_instance:
            logger_instance.log_llm_response(state.retry_count, result.output)
            
        usage = getattr(result, "usage", None)
        token_delta = _extract_tokens(usage)

        from agent_runtime import AgentRuntime
        plan, text_response = AgentRuntime._parse_response(None, result.output)

        updates = {**_accumulate_tokens(state, token_delta)}

        if plan is not None:
            steps_data = []
            for idx, s in enumerate(plan.steps):
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
            updates["cumulative_steps"] = steps_data
            updates["current_step_index"] = 0

            if ws:
                import uuid
                await ws.send_message("plan_created", {
                    "id": str(uuid.uuid4()),
                    "goal": plan.goal or state.goal,
                    "steps": steps_data,
                    "recovery_hint": plan.recovery_hint,
                })
        else:
            updates["final_response"] = text_response or "I couldn't generate a response."
            updates["plan_steps"] = []

        return updates

    except asyncio.CancelledError:
        return {"is_cancelled": True, "final_response": "Execution cancelled by user."}
    except Exception as e:
        logger.error("plan_node failed", error=str(e))
        return {"final_response": f"Planning failed: {e}", "plan_steps": []}


# ── execute_step_node ───────────────────────────────────────────────────────────
async def execute_step_node(state: OpenSarthiState, config: RunnableConfig) -> dict:
    """Execute the current pending step from the plan."""
    ws = config["configurable"].get("ws_handler")
    idx = state.current_step_index

    if idx >= len(state.plan_steps):
        return {"final_response": "Task completed successfully.", "plan_steps": []}

    step_data = state.plan_steps[idx]
    from planner.schemas import PlanStep, ToolResult
    from tools.registry import get as get_tool

    step = PlanStep(**step_data)
    tool = get_tool(step.tool)

    if tool is None:
        err = f"Unknown tool: {step.tool}"
        if ws:
            await ws.send_message("tool_error", {
                "index": idx, "error": err, "tool": step.tool,
                "description": step.description, "args": step.args,
            })
        updated_steps = list(state.cumulative_steps)
        if idx < len(updated_steps):
            updated_steps[idx] = {**updated_steps[idx], "status": "error", "error": err}
        return {
            "last_tool_result": {"success": False, "error": err, "retryable": False},
            "failed_actions": state.failed_actions + [f"{step.description}: {err}"],
            "cumulative_steps": updated_steps,
        }

    if ws:
        await ws.send_message("tool_started", {
            "index": idx, "tool": step.tool,
            "description": step.description, "args": step.args,
        })
        await ws.send_message("tool_action", {
            "tool": step.tool, "description": step.description,
            "status": "running", "result": None,
        })

    # Update step status to running
    updated_steps = list(state.cumulative_steps)
    if idx < len(updated_steps):
        updated_steps[idx] = {**updated_steps[idx], "status": "running"}

    try:
        res = await tool.safe_execute(step.args, permission_manager=ws)
    except asyncio.CancelledError:
        res_dict = {"success": False, "error": "Cancelled by user", "retryable": False}
        logger_instance = config["configurable"].get("dev_logger")
        if logger_instance:
            logger_instance.log_tool_call(
                attempt=state.retry_count,
                step_index=idx,
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
                "index": idx, "error": str(e), "tool": step.tool,
                "description": step.description, "args": step.args,
            })
        if idx < len(updated_steps):
            updated_steps[idx] = {**updated_steps[idx], "status": "error", "error": str(e)}
        logger_instance = config["configurable"].get("dev_logger")
        if logger_instance:
            logger_instance.log_tool_call(
                attempt=state.retry_count,
                step_index=idx,
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
        })
        if res.success:
            await ws.send_message("tool_completed", {
                "index": idx, "result": res.observation,
                "tool": step.tool, "description": step.description, "args": step.args,
            })
        else:
            await ws.send_message("tool_error", {
                "index": idx, "error": res.error or "Unknown error",
                "tool": step.tool, "description": step.description, "args": step.args,
            })

    # Update cumulative step status
    if idx < len(updated_steps):
        step_update = {**updated_steps[idx], "status": status_str}
        if res.success:
            step_update["result"] = res.observation
        else:
            step_update["error"] = res.error or "Unknown error"
        updated_steps[idx] = step_update

    new_completed = list(state.completed_actions)
    new_failed = list(state.failed_actions)

    if res.success:
        new_completed.append(step.description or f"Executed: {step.tool}")
        # Handle wait_after
        if step.wait_after:
            await asyncio.sleep(step.wait_after)

    logger_instance = config["configurable"].get("dev_logger")
    if logger_instance:
        logger_instance.log_tool_call(
            attempt=state.retry_count,
            step_index=idx,
            tool_name=step.tool,
            args=step.args,
            result_status=status_str,
            result_obs=res.observation if res.success else (res.error or "Unknown error")
        )

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

    idx = state.current_step_index - 1
    if idx < 0 or idx >= len(state.plan_steps):
        return {}

    step_data = state.plan_steps[idx]
    last_result = state.last_tool_result or {}
    err_msg = (last_result.get("error") or "")[:200]

    if ws:
        await ws.send_message("tool_action", {
            "tool": "self_heal",
            "description": f"Self-healing: {step_data.get('description', step_data.get('tool'))}",
            "status": "running", "result": None,
        })

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
        )

        if healed:
            # Patch the step with healed tool/args so execute_step_node retries it
            updated_steps = list(state.plan_steps)
            updated_steps[idx] = {
                **step_data,
                "tool": healed["tool"],
                "args": healed.get("args", {}),
                "description": f"[HEALED] {step_data.get('description')} → {healed.get('description', '')}",
            }
            if ws:
                await ws.send_message("tool_action", {
                    "tool": "self_heal",
                    "description": f"Self-healing: {step_data.get('description')}",
                    "status": "success",
                    "result": f"Applying correction: {healed.get('description', healed['tool'])}",
                })
            return {
                "plan_steps": updated_steps,
                "current_step_index": idx,  # Retry same step
            }
        else:
            if ws:
                await ws.send_message("tool_action", {
                    "tool": "self_heal",
                    "description": f"Self-healing: {step_data.get('description')}",
                    "status": "error",
                    "result": "No healing path found.",
                })
            return {}  # No change — will trigger replan
    except Exception as e:
        logger.debug("heal_node exception", error=str(e))
        return {}


# ── review_node ─────────────────────────────────────────────────────────────────
async def review_node(state: OpenSarthiState, config: RunnableConfig) -> dict:
    """Fire-and-forget: ReviewerAgent learns from successful execution."""
    model = config["configurable"]["model"]
    deps = config["configurable"]["deps"]
    memory_manager = config["configurable"].get("memory_manager")

    if memory_manager and state.completed_actions:
        from agents.reviewer import ReviewerAgent
        reviewer = ReviewerAgent(model, deps)
        asyncio.create_task(reviewer.review_and_learn(
            goal=state.goal,
            execution_log=state.cumulative_steps,
            outcome="SUCCESS",
            memory_manager=memory_manager,
        ))
        # Store successful execution summary in memory
        asyncio.create_task(memory_manager.store(
            content=f"Goal: {state.goal}\nOutcome: Completed successfully.\nActions: {state.completed_actions}",
            source="agent",
            importance=0.9,
        ))

    return {"final_response": state.final_response or "Task completed successfully."}


# ── chat_node ───────────────────────────────────────────────────────────────────
async def chat_node(state: OpenSarthiState, config: RunnableConfig) -> dict:
    """Handle CHAT classification: direct conversational LLM response."""
    model = config["configurable"]["model"]
    deps = config["configurable"]["deps"]
    ws = config["configurable"].get("ws_handler")

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
        token_delta = _extract_tokens(usage)

        # Stream word-by-word if ws_handler supports it
        if ws and hasattr(ws, "stream_text"):
            await ws.stream_text(final_text, thread_id=state.thread_id)

        return {
            "final_response": final_text,
            **_accumulate_tokens(state, token_delta),
        }
    except asyncio.CancelledError:
        return {"is_cancelled": True, "final_response": "Cancelled."}
    except Exception as e:
        return {"final_response": f"Chat failed: {e}"}


# ── Helpers ─────────────────────────────────────────────────────────────────────
def _extract_tokens(usage: Any) -> dict:
    if not usage:
        return {"req": 0, "res": 0, "tot": 0}
    return {
        "req": getattr(usage, "request_tokens", 0) or 0,
        "res": getattr(usage, "response_tokens", 0) or 0,
        "tot": getattr(usage, "total_tokens", 0) or 0,
    }


def _accumulate_tokens(state: OpenSarthiState, delta: dict) -> dict:
    return {
        "total_request_tokens": state.total_request_tokens + delta.get("req", 0),
        "total_response_tokens": state.total_response_tokens + delta.get("res", 0),
        "total_tokens": state.total_tokens + delta.get("tot", 0),
    }
