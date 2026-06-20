"""
graph/edges.py — Routing/conditional edge functions for the OpenSarthi graph.

Each function receives the current state and returns the name of the next node.
"""
from __future__ import annotations
from graph.state import OpenSarthiState


def route_by_classification(state: OpenSarthiState) -> str:
    """Route to CHAT, TASK pipeline, or END based on intent classification."""
    if state.is_cancelled:
        return "__end__"
    c = (state.classification or "TASK").upper()
    if c == "CHAT":
        return "chat"
    elif c == "CLARIFY":
        # For now, route CLARIFY to chat (responds with clarifying question)
        return "chat"
    else:
        return "observe"


def route_after_plan(state: OpenSarthiState) -> str:
    """After planning: execute steps if there are any, else finish."""
    if state.is_cancelled:
        return "__end__"
    if state.plan_steps:
        return "execute"
    # Plan returned a text-only response
    return "review"


def route_after_execute(state: OpenSarthiState) -> str:
    """After a step executes: check result and decide what to do next."""
    if state.is_cancelled:
        return "__end__"

    last = state.last_tool_result or {}
    success = last.get("success", False)

    if success:
        # More steps remaining?
        if state.current_step_index < len(state.plan_steps):
            return "execute"
        # All steps done → review + finish
        return "review"
    else:
        retryable = last.get("retryable", True)
        if not retryable:
            # Unrecoverable error → replan
            if state.retry_count < state.max_retries:
                return "replan"
            return "__end__"
        # Try self-healing first
        return "heal"


def route_after_heal(state: OpenSarthiState) -> str:
    """After healing attempt: retry execute or trigger replan."""
    if state.is_cancelled:
        return "__end__"
    # If heal_node patched the step, current_step_index points back to it
    # Otherwise we replan (if retries remain)
    if state.retry_count < state.max_retries:
        return "execute"
    return "__end__"


def route_replan(state: OpenSarthiState) -> str:
    """Decide whether to attempt replanning or give up."""
    if state.is_cancelled:
        return "__end__"
    if state.retry_count < state.max_retries:
        return "observe"  # Observe fresh state, then re-plan
    return "__end__"
