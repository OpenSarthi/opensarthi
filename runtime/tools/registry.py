from typing import Optional
from tools.base import BaseTool
from tools.desktop import ClickTool, TypeTextTool, PressKeyTool, OpenAppTool, ClickElementTool, FocusWindowTool, ObserveDesktopTool
from tools.system import ShellTool
from tools.wait_tools import WaitForWindowTool, WaitForTextTool
from tools.media import MediaControlTool
from tools.memory import RememberTool, RecallTool
from tools.notes import SaveNoteTool, GetNotesTool
from tools.self_fix import SelfFixTool

_registry: dict[str, BaseTool] = {}

def _register(*tools):
    for tool in tools:
        _registry[tool.name] = tool

# Register all tools
_register(
    ClickTool(),
    TypeTextTool(),
    PressKeyTool(),
    OpenAppTool(),
    FocusWindowTool(),
    ClickElementTool(),
    ObserveDesktopTool(),
    ShellTool(),
    WaitForWindowTool(),
    WaitForTextTool(),
    MediaControlTool(),
    RememberTool(),
    RecallTool(),
    SaveNoteTool(),
    GetNotesTool(),
    SelfFixTool(),
)

def get(name: str) -> Optional[BaseTool]:
    return _registry.get(name)

def all_tools() -> list[BaseTool]:
    return list(_registry.values())

def get_schemas() -> list[dict]:
    """Return JSON schema list for tool registration."""
    return [
        {
            "name": t.name,
            "description": t.description,
        }
        for t in _registry.values()
    ]
