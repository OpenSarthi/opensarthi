"""
graph/graph.py — Graph assembly and compilation for OpenSarthi.

Usage:
    graph = get_compiled_graph()
    config = {
        "configurable": {
            "thread_id": tid,
            "model": active_model,
            "deps": deps,
            "ws_handler": ws,
            "memory_manager": memory,
        }
    }
    result = await graph.ainvoke({"goal": text, "thread_id": tid}, config=config)

Set USE_LANGGRAPH=true in the environment to activate this instead of AgentRuntime.
"""
from __future__ import annotations
import os
from functools import lru_cache
from typing import Optional

import structlog
from langgraph.graph import StateGraph, END
from langgraph.checkpoint.memory import MemorySaver

from langchain_core.runnables import RunnableConfig

from graph.state import OpenSarthiState
from graph.nodes import (
    classify_node,
    observe_node,
    plan_node,
    execute_step_node,
    heal_node,
    review_node,
    chat_node,
)
from graph.edges import (
    route_by_classification,
    route_after_plan,
    route_after_execute,
    route_after_heal,
    route_replan,
)

logger = structlog.get_logger()

# ── Replan increment wrapper ────────────────────────────────────────────────────
async def replan_node(state: OpenSarthiState, config: RunnableConfig) -> dict:
    """Increment retry_count and clear current plan before replanning."""
    new_retry = state.retry_count + 1
    logger.info("replan_node", retry_count=new_retry, goal=state.goal[:60])
    ws = config["configurable"].get("ws_handler")
    if ws:
        from state_machine import AgentState
        try:
            from state_machine import AgentStateContext
            ctx = AgentStateContext(current_goal=state.goal)
            ctx.transition(AgentState.RETRYING, current_step_description=f"Replanning (attempt {new_retry})...")
            await ws.emit_state(ctx, thread_id=state.thread_id)
        except Exception:
            pass
    return {
        "retry_count": new_retry,
        "plan_steps": [],
        "current_step_index": 0,
        "last_tool_result": None,
    }


# ── Graph builder ───────────────────────────────────────────────────────────────
def build_graph(use_sqlite: bool = False) -> StateGraph:
    """
    Build the OpenSarthi execution graph.

    Args:
        use_sqlite: If True, use SqliteSaver for persistent checkpointing.
                    Falls back to in-memory MemorySaver if langgraph-checkpoint-sqlite
                    is not installed.
    """
    workflow = StateGraph(OpenSarthiState)

    # ── Register nodes ──────────────────────────────────────────────────
    workflow.add_node("classify", classify_node)
    workflow.add_node("observe", observe_node)
    workflow.add_node("plan", plan_node)
    workflow.add_node("execute", execute_step_node)
    workflow.add_node("heal", heal_node)
    workflow.add_node("replan", replan_node)
    workflow.add_node("review", review_node)
    workflow.add_node("chat", chat_node)

    # ── Entry point ─────────────────────────────────────────────────────
    workflow.set_entry_point("classify")

    # ── Edges ───────────────────────────────────────────────────────────
    workflow.add_conditional_edges(
        "classify",
        route_by_classification,
        {
            "chat": "chat",
            "observe": "observe",
            "__end__": END,
        },
    )

    workflow.add_edge("observe", "plan")

    workflow.add_conditional_edges(
        "plan",
        route_after_plan,
        {
            "execute": "execute",
            "review": "review",
            "__end__": END,
        },
    )

    workflow.add_conditional_edges(
        "execute",
        route_after_execute,
        {
            "execute": "execute",   # More steps in current plan
            "review": "review",     # All steps done
            "heal": "heal",         # Step failed, try to heal
            "replan": "replan",     # Unrecoverable, replan
            "__end__": END,
        },
    )

    workflow.add_conditional_edges(
        "heal",
        route_after_heal,
        {
            "execute": "execute",
            "__end__": END,
        },
    )

    workflow.add_conditional_edges(
        "replan",
        route_replan,
        {
            "observe": "observe",
            "__end__": END,
        },
    )

    workflow.add_edge("review", END)
    workflow.add_edge("chat", END)

    return workflow


# ── Compiled graph (singleton with MemorySaver by default) ──────────────────────
_compiled_graph = None


def get_compiled_graph(use_sqlite: bool = False):
    """
    Return the compiled LangGraph (singleton).

    Uses SqliteSaver if available and use_sqlite=True, otherwise MemorySaver.
    """
    global _compiled_graph
    if _compiled_graph is not None:
        return _compiled_graph

    workflow = build_graph(use_sqlite=use_sqlite)

    checkpointer = None
    if use_sqlite:
        try:
            from langgraph.checkpoint.sqlite import SqliteSaver
            import os
            db_path = os.path.expanduser("~/.config/opensarthi/checkpoints.db")
            os.makedirs(os.path.dirname(db_path), exist_ok=True)
            checkpointer = SqliteSaver.from_conn_string(db_path)
            logger.info("LangGraph: using SqliteSaver checkpointer", path=db_path)
        except ImportError:
            logger.warning("langgraph-checkpoint-sqlite not installed, using MemorySaver")

    if checkpointer is None:
        checkpointer = MemorySaver()

    _compiled_graph = workflow.compile(checkpointer=checkpointer)
    logger.info("LangGraph graph compiled", nodes=list(workflow.nodes.keys()))
    return _compiled_graph


async def run_graph(
    goal: str,
    model,
    deps,
    ws_handler,
    memory_manager=None,
    thread_id: Optional[str] = None,
    message_history: Optional[list] = None,
    summarized_context: Optional[str] = None,
) -> str:
    """
    High-level entry point: run the LangGraph for a user goal.

    Returns the final response string (same interface as AgentRuntime.run()).
    """
    graph = get_compiled_graph()

    config = {
        "configurable": {
            "thread_id": thread_id or "default",
            "model": model,
            "deps": deps,
            "ws_handler": ws_handler,
            "memory_manager": memory_manager,
        }
    }

    initial_state = {
        "goal": goal,
        "thread_id": thread_id,
        "messages": message_history or [],
        "summarized_context": summarized_context,
        # Reset execution state for the new user goal on this thread to avoid checkpointer leakage
        "classification": None,
        "plan_steps": [],
        "current_step_index": 0,
        "completed_actions": [],
        "failed_actions": [],
        "cumulative_steps": [],
        "retry_count": 0,
        "desktop_snapshot": None,
        "recalled_memories": [],
        "preferences": [],
        "last_tool_result": None,
        "is_cancelled": False,
        "is_paused": False,
        "interrupt_before_tool": False,
        "final_response": None,
    }

    try:
        result = await graph.ainvoke(initial_state, config=config)
        return result.get("final_response") or "Task completed."
    except Exception as e:
        logger.error("LangGraph run_graph failed", error=str(e))
        return f"❌ Execution failed: {e}"


async def stream_graph_events(
    goal: str,
    model,
    deps,
    ws_handler,
    memory_manager=None,
    thread_id: Optional[str] = None,
    message_history: Optional[list] = None,
    summarized_context: Optional[str] = None,
):
    """
    Streaming variant of run_graph: yields events from astream_events().
    Used to push incremental updates to the WebSocket.
    """
    graph = get_compiled_graph()

    config = {
        "configurable": {
            "thread_id": thread_id or "default",
            "model": model,
            "deps": deps,
            "ws_handler": ws_handler,
            "memory_manager": memory_manager,
        }
    }

    initial_state = {
        "goal": goal,
        "thread_id": thread_id,
        "messages": message_history or [],
        "summarized_context": summarized_context,
        # Reset execution state for the new user goal on this thread to avoid checkpointer leakage
        "classification": None,
        "plan_steps": [],
        "current_step_index": 0,
        "completed_actions": [],
        "failed_actions": [],
        "cumulative_steps": [],
        "retry_count": 0,
        "desktop_snapshot": None,
        "recalled_memories": [],
        "preferences": [],
        "last_tool_result": None,
        "is_cancelled": False,
        "is_paused": False,
        "interrupt_before_tool": False,
        "final_response": None,
    }

    async for event in graph.astream_events(initial_state, config=config, version="v2"):
        yield event
