from typing import Optional
from tools.base import BaseTool
from tools.desktop import ClickTool, TypeTextTool, PressKeyTool, OpenAppTool, ClickElementTool, FocusWindowTool, ObserveDesktopTool
from tools.system import ShellTool
from tools.wait_tools import WaitForWindowTool, WaitForTextTool
from tools.media import MediaControlTool
from tools.memory import RememberTool, RecallTool, ForgetMemoryTool
from tools.notes import SaveNoteTool, GetNotesTool
from tools.self_fix import SelfFixTool
from tools.productivity import (
    WebSearchTool,
    WeatherTool,
    SetTimerTool,
    ListTimersTool,
    CancelTimerTool,
    ListFilesTool,
    OpenPathTool,
    ReadFileTool,
    VolumeControlTool,
    BatteryTool,
    NetworkControlTool,
)

_registry: dict[str, BaseTool] = {}

def _register(*tools):
    for tool in tools:
        _registry[tool.name] = tool

# Register all tools
_register(
    # Desktop automation
    ClickTool(),
    TypeTextTool(),
    PressKeyTool(),
    OpenAppTool(),
    FocusWindowTool(),
    ClickElementTool(),
    ObserveDesktopTool(),
    # System
    ShellTool(),
    # Wait utilities
    WaitForWindowTool(),
    WaitForTextTool(),
    # Media
    MediaControlTool(),
    # Memory
    RememberTool(),
    RecallTool(),
    ForgetMemoryTool(),
    # Notes
    SaveNoteTool(),
    GetNotesTool(),
    # Self-improvement
    SelfFixTool(),
    # Productivity (Phase 3)
    WebSearchTool(),
    WeatherTool(),
    SetTimerTool(),
    ListTimersTool(),
    CancelTimerTool(),
    ListFilesTool(),
    OpenPathTool(),
    ReadFileTool(),
    VolumeControlTool(),
    BatteryTool(),
    NetworkControlTool(),
)


def get(name: str) -> Optional[BaseTool]:
    return _registry.get(name)

def all_tools() -> list[BaseTool]:
    return list(_registry.values())

def get_schemas() -> list[dict]:
    """Return JSON schema list for each tool — used for MCP and prompt injection."""
    return [
        {
            "name": t.name,
            "description": t.description,
            "schema": t.schema,
        }
        for t in _registry.values()
    ]

def validate_registry():
    """Boot-time sanity check — every tool must have a non-empty schema."""
    import structlog
    log = structlog.get_logger()
    warnings = []
    for name, tool in _registry.items():
        if not tool.schema:
            warnings.append(name)
    if warnings:
        log.warning("Tools missing schema (LLM may hallucinate args)", tools=warnings)
    else:
        log.info("Tool registry OK", count=len(_registry))

# Run validation at import time
validate_registry()
