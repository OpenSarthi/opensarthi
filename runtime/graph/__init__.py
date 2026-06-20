"""
runtime/graph — LangGraph-based orchestration layer for OpenSarthi.

This package provides a stateful, checkpointed execution graph that wraps
the existing PydanticAI agents and tools. Set USE_LANGGRAPH=true in the
environment to activate this layer instead of the legacy AgentRuntime loop.
"""
from .graph import build_graph, get_compiled_graph

__all__ = ["build_graph", "get_compiled_graph"]
