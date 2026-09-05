"""
AT-SPI 2.0 Accessibility Provider for OpenSarthi.

Uses GObject Introspection to access the AT-SPI D-Bus tree.
This gives us: element roles, text, states, bounding boxes.

Requires: python-gi (PyGObject) + at-spi2-core
"""

import asyncio
import subprocess
from typing import Optional, List
from dataclasses import dataclass

@dataclass
class UIElement:
    """A single accessible UI element."""
    role: str                          # "button", "text", "entry", "menu-item", ...
    name: str                          # Display name/label
    description: str = ""
    x: int = 0
    y: int = 0
    width: int = 0
    height: int = 0
    is_focused: bool = False
    is_enabled: bool = True
    is_visible: bool = True
    children: List["UIElement"] = None

    @property
    def center(self) -> tuple[int, int]:
        return (self.x + self.width // 2, self.y + self.height // 2)

    def __repr__(self):
        return f"UIElement(role={self.role!r}, name={self.name!r}, at=({self.x},{self.y}))"


class AccessibilityProvider:
    """
    Walks the AT-SPI accessibility tree to find UI elements.
    """

    def __init__(self):
        self._available = False
        self._desktop = None
        self._load()

    def _load(self):
        try:
            import gi
            gi.require_version("Atspi", "2.0")
            from gi.repository import Atspi
            self._Atspi = Atspi
            self._desktop = Atspi.get_desktop(0)
            self._available = True
            print("[AT-SPI] Accessibility provider loaded")
        except Exception as e:
            print(f"[AT-SPI] Not available: {e}")
            self._available = False

    @property
    def available(self) -> bool:
        return self._available

    def get_focused_element(self) -> Optional[UIElement]:
        """Return the currently focused UI element."""
        if not self._available:
            return None
        try:
            Atspi = self._Atspi
            focused = None

            def walk(obj, depth=0):
                nonlocal focused
                if depth > 20:
                    return
                try:
                    state_set = obj.get_state_set()
                    if state_set.contains(Atspi.StateType.FOCUSED):
                        focused = self._to_element(obj)
                        return
                    n = obj.get_child_count()
                    for i in range(min(n, 50)):  # Cap tree walk
                        child = obj.get_child_at_index(i)
                        if child:
                            walk(child, depth + 1)
                except Exception:
                    pass

            for i in range(self._desktop.get_child_count()):
                app = self._desktop.get_child_at_index(i)
                if app:
                    walk(app)
                if focused:
                    break

            return focused
        except Exception:
            return None

    def find_elements(
        self,
        role: Optional[str] = None,
        name: Optional[str] = None,
        name_contains: Optional[str] = None,
        max_results: int = 20
    ) -> List[UIElement]:
        """
        Search the accessibility tree for elements matching criteria.
        """
        if not self._available:
            return []

        results = []

        def walk(obj, depth=0):
            if len(results) >= max_results or depth > 15:
                return
            try:
                el = self._to_element(obj)
                matches = True
                if role and el.role != role:
                    matches = False
                if name and el.name != name:
                    matches = False
                if name_contains and name_contains.lower() not in el.name.lower():
                    matches = False

                if matches and el.name:
                    results.append(el)

                for i in range(min(obj.get_child_count(), 100)):
                    child = obj.get_child_at_index(i)
                    if child:
                        walk(child, depth + 1)
            except Exception:
                pass

        try:
            for i in range(self._desktop.get_child_count()):
                app = self._desktop.get_child_at_index(i)
                if app:
                    walk(app)
        except Exception:
            pass

        return results

    def get_active_window(self) -> Optional[UIElement]:
        """Return the currently active application window."""
        if not self._available:
            return None

        try:
            Atspi = self._Atspi
            for i in range(self._desktop.get_child_count()):
                app = self._desktop.get_child_at_index(i)
                if not app:
                    continue
                for j in range(app.get_child_count()):
                    win = app.get_child_at_index(j)
                    if not win:
                        continue
                    try:
                        states = win.get_state_set()
                        if states.contains(Atspi.StateType.ACTIVE):
                            return self._to_element(win)
                    except Exception:
                        pass
        except Exception:
            pass
        return None

    def click_element(self, element: UIElement) -> bool:
        """Click the center of an element using its bounding box."""
        cx, cy = element.center
        result = subprocess.run(
            ["xdotool", "mousemove", str(cx), str(cy), "click", "1"],
            capture_output=True
        )
        return result.returncode == 0

    def get_tree_summary(self, max_elements: int = 50) -> str:
        """Return a text summary of visible UI elements for the LLM prompt."""
        elements = self.find_elements(max_results=max_elements)
        if not elements:
            return "No accessible UI elements found."

        lines = [f"Accessible UI Elements ({len(elements)}):"]
        for el in elements:
            state = "FOCUSED" if el.is_focused else ""
            lines.append(f"  [{el.role}] '{el.name}' at ({el.x},{el.y}) {state}".rstrip())
        return "\n".join(lines)

    def get_window_tree_summary(self, max_depth: int = 8, max_elements: int = 300):
        """
        Build an indented, hierarchical accessibility tree scoped to the ACTIVE
        window — a DOM-like structure the LLM can act on. Skips invisible nodes.

        Returns (text, total_elements, truncated):
            text:       multi-line indented tree
            total:      number of elements walked before truncation
            truncated:  True if the walk was cut short at `max_elements`
        """
        if not self._available:
            return "No accessible UI elements found.", 0, False

        Atspi = self._Atspi
        active_win = None

        # Locate the raw AT-SPI object for the currently active window.
        try:
            for i in range(self._desktop.get_child_count()):
                app = self._desktop.get_child_at_index(i)
                if not app:
                    continue
                for j in range(app.get_child_count()):
                    win = app.get_child_at_index(j)
                    if not win:
                        continue
                    states = win.get_state_set()
                    if states.contains(Atspi.StateType.ACTIVE):
                        active_win = win
                        break
                if active_win:
                    break
        except Exception:
            pass

        lines = []
        total = 0
        truncated = False

        def _label(obj) -> str:
            try:
                role = obj.get_role_name() or "unknown"
                name = (obj.get_name() or "").strip()
                states = obj.get_state_set()
                bbox_str = ""
                try:
                    bbox = obj.get_extents(Atspi.CoordType.SCREEN)
                    bbox_str = f" ({bbox.x},{bbox.y},{bbox.width}x{bbox.height})"
                except Exception:
                    pass
                label = f"[{role}]{bbox_str}"
                if name:
                    label = f"{label} '{name[:80]}'"
                if states.contains(Atspi.StateType.FOCUSED):
                    label = f"{label} [FOCUSED]"
                return label
            except Exception:
                return "[unknown]"

        def _walk(obj, depth):
            nonlocal total, truncated
            if total >= max_elements:
                truncated = True
                return
            if depth > max_depth:
                return
            try:
                states = obj.get_state_set()
                if not states.contains(Atspi.StateType.VISIBLE):
                    return  # skip invisible / minimized subtree
            except Exception:
                pass
            total += 1
            lines.append("  " * depth + _label(obj))
            try:
                n = obj.get_child_count()
            except Exception:
                n = 0
            for i in range(min(n, 100)):
                child = obj.get_child_at_index(i)
                if child is not None:
                    _walk(child, depth + 1)

        try:
            if active_win is not None:
                _walk(active_win, 1)
        except Exception:
            pass

        if not lines:
            # No scoped tree — fall back to the flat full-desktop summary.
            return self.get_tree_summary(max_elements=max_elements), 0, False

        header = f"Accessible UI Tree (active window, {total} elements, depth≤{max_depth}):"
        text = "\n".join([header] + lines)
        if truncated:
            text += f"\n[... tree truncated at {max_elements} elements — call observe_desktop to refresh ...]"
        return text, total, truncated

    def _to_element(self, obj) -> UIElement:
        """Convert an Atspi.Accessible object to UIElement."""
        Atspi = self._Atspi
        try:
            role = obj.get_role_name() or "unknown"
            name = obj.get_name() or ""
            description = obj.get_description() or ""

            # Get bounding box
            try:
                bbox = obj.get_extents(Atspi.CoordType.SCREEN)
                x, y, w, h = bbox.x, bbox.y, bbox.width, bbox.height
            except Exception:
                x = y = w = h = 0

            # Check states
            try:
                states = obj.get_state_set()
                is_focused = states.contains(Atspi.StateType.FOCUSED)
                is_enabled = states.contains(Atspi.StateType.ENABLED)
                is_visible = states.contains(Atspi.StateType.VISIBLE)
            except Exception:
                is_focused = is_enabled = is_visible = True

            return UIElement(
                role=role, name=name, description=description,
                x=x, y=y, width=w, height=h,
                is_focused=is_focused, is_enabled=is_enabled, is_visible=is_visible
            )
        except Exception:
            return UIElement(role="unknown", name="")
