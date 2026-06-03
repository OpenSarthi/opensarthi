"""
Window Session Context — shared state across tool invocations within a single agent run.
Tracks the pinned window ID so type/click tools always target the correct window.
"""

from dataclasses import dataclass, field
from typing import Optional

@dataclass
class WindowSession:
    """
    Holds the currently pinned target window ID.
    After wait_for_window succeeds, the window ID is stored here.
    TypeTextTool, ClickTool, and PressKeyTool re-focus this window before every action.
    This solves the "agent types in wrong window when user clicks away" problem.
    """
    pinned_window_id: Optional[str] = None
    pinned_window_title: Optional[str] = None

    def pin(self, window_id: str, title: str = ""):
        self.pinned_window_id = window_id
        self.pinned_window_title = title

    def clear(self):
        self.pinned_window_id = None
        self.pinned_window_title = None

    @property
    def is_pinned(self) -> bool:
        return self.pinned_window_id is not None

# Module-level singleton — shared across all tool instances during a single agent run
_session = WindowSession()

def get_session() -> WindowSession:
    return _session

def reset_session():
    _session.clear()
