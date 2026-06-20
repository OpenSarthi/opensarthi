"""
graph/state.py — Typed state definition for the OpenSarthi LangGraph.

All graph nodes read from and write to OpenSarthiState. LangGraph merges
partial dicts returned from each node into the running state.
"""
from __future__ import annotations
from typing import Annotated, Any, Optional
from pydantic import BaseModel, Field
from langgraph.graph.message import add_messages


class OpenSarthiState(BaseModel):
    """Full typed state carried through the OpenSarthi execution graph."""

    # ── Core task fields ────────────────────────────────────────────────
    goal: str = ""
    thread_id: Optional[str] = None
    classification: Optional[str] = None   # CHAT | TASK | CLARIFY

    # ── Message history (LangGraph-managed accumulator) ─────────────────
    messages: Annotated[list, add_messages] = Field(default_factory=list)

    # ── Execution plan ──────────────────────────────────────────────────
    plan_steps: list = Field(default_factory=list)          # List[PlanStep dicts]
    current_step_index: int = 0
    completed_actions: list[str] = Field(default_factory=list)
    failed_actions: list[str] = Field(default_factory=list)
    cumulative_steps: list = Field(default_factory=list)    # For UI broadcast

    # ── Replanning control ──────────────────────────────────────────────
    retry_count: int = 0
    max_retries: int = 5

    # ── Desktop observation ─────────────────────────────────────────────
    desktop_snapshot: Optional[dict] = None   # Serialised DesktopSnapshot

    # ── Memory & preferences ────────────────────────────────────────────
    recalled_memories: list = Field(default_factory=list)
    preferences: list = Field(default_factory=list)
    summarized_context: Optional[str] = None

    # ── Current step execution result ───────────────────────────────────
    last_tool_result: Optional[dict] = None   # ToolResult.dict()

    # ── Control flags ───────────────────────────────────────────────────
    is_cancelled: bool = False
    is_paused: bool = False
    interrupt_before_tool: bool = False   # LangGraph interrupt() gate

    # ── Final output ────────────────────────────────────────────────────
    final_response: Optional[str] = None

    # ── Token tracking ──────────────────────────────────────────────────
    total_request_tokens: int = 0
    total_response_tokens: int = 0
    total_tokens: int = 0

    model_config = {"arbitrary_types_allowed": True}
