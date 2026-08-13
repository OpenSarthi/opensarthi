"""
macOS Accessibility Provider for OpenSarthi.

Uses the macOS Accessibility framework (AXUIElement API) via pyobjc to
walk the accessibility tree — the macOS equivalent of AT-SPI on Linux.

Requires: pyobjc-framework-ApplicationServices
Install: pip install pyobjc-framework-ApplicationServices pyobjc-framework-Cocoa

If pyobjc is not available, the provider gracefully degrades (available=False)
and all tools fall back to coordinate-based interaction.

macOS Accessibility Permission:
    The app must be granted Accessibility access in:
    System Settings → Privacy & Security → Accessibility
    The user will be prompted automatically on first use.
"""

import subprocess
from typing import Optional, List
from dataclasses import dataclass, field


@dataclass
class UIElement:
    """A single accessible UI element (mirrors Linux AT-SPI UIElement)."""
    role: str                         # e.g. "AXButton", "AXTextField", "AXMenuItem"
    name: str                         # Display name / label
    description: str = ""
    x: int = 0
    y: int = 0
    width: int = 0
    height: int = 0
    is_focused: bool = False
    is_enabled: bool = True
    is_visible: bool = True
    children: List["UIElement"] = field(default_factory=list)

    @property
    def center(self) -> tuple:
        return (self.x + self.width // 2, self.y + self.height // 2)

    def __repr__(self):
        return f"UIElement(role={self.role!r}, name={self.name!r}, at=({self.x},{self.y}))"


class AccessibilityProvider:
    """
    Walks the macOS AXUIElement accessibility tree to find UI elements.

    Uses pyobjc-framework-ApplicationServices (Accessibility.framework).
    Gracefully unavailable if pyobjc is not installed or permission is denied.
    """

    def __init__(self):
        self._available = False
        self._AXUIElement = None
        self._load()

    def _load(self):
        try:
            # Check if Accessibility permission is granted
            import ApplicationServices
            trusted = ApplicationServices.AXIsProcessTrusted()
            if not trusted:
                # Prompt the user to grant access — this opens the System Settings dialog
                opts = {ApplicationServices.kAXTrustedCheckOptionPrompt: True}
                ApplicationServices.AXIsProcessTrustedWithOptions(opts)
                print("[Accessibility] macOS accessibility permission requested — "
                      "please grant access in System Settings → Privacy & Security → Accessibility")
                self._available = False
                return

            self._ApplicationServices = ApplicationServices
            self._available = True
            print("[Accessibility] macOS AXUIElement provider loaded")
        except ImportError:
            print("[Accessibility] pyobjc-framework-ApplicationServices not installed. "
                  "Install with: pip install pyobjc-framework-ApplicationServices")
            self._available = False
        except Exception as e:
            print(f"[Accessibility] macOS provider unavailable: {e}")
            self._available = False

    @property
    def available(self) -> bool:
        return self._available

    def get_focused_element(self) -> Optional[UIElement]:
        """Return the currently focused UI element."""
        if not self._available:
            return None
        try:
            AS = self._ApplicationServices
            # Get system-wide accessibility object
            system_wide = AS.AXUIElementCreateSystemWide()
            # Query focused element
            err, focused = AS.AXUIElementCopyAttributeValue(
                system_wide, AS.kAXFocusedUIElementAttribute, None
            )
            if err != AS.kAXErrorSuccess or focused is None:
                return None
            return self._ax_to_element(focused)
        except Exception:
            return None

    def find_elements(
        self,
        role: Optional[str] = None,
        name: Optional[str] = None,
        name_contains: Optional[str] = None,
        max_results: int = 20,
    ) -> List[UIElement]:
        """Search the AX tree for elements matching criteria."""
        if not self._available:
            return []

        results = []
        AS = self._ApplicationServices

        try:
            # Start from the focused application
            system_wide = AS.AXUIElementCreateSystemWide()
            err, focused_app = AS.AXUIElementCopyAttributeValue(
                system_wide, AS.kAXFocusedApplicationAttribute, None
            )
            if err != AS.kAXErrorSuccess or focused_app is None:
                return []

            def walk(element, depth=0):
                if len(results) >= max_results or depth > 15:
                    return
                try:
                    el = self._ax_to_element(element)
                    matches = True
                    if role:
                        # AX roles are like "AXButton" — match flexibly
                        el_role_clean = el.role.lstrip("AX").lower()
                        search_role = role.lstrip("AX").lower()
                        if el_role_clean != search_role:
                            matches = False
                    if name and el.name != name:
                        matches = False
                    if name_contains and name_contains.lower() not in el.name.lower():
                        matches = False

                    if matches and el.name:
                        results.append(el)

                    # Walk children
                    err2, children = AS.AXUIElementCopyAttributeValue(
                        element, AS.kAXChildrenAttribute, None
                    )
                    if err2 == AS.kAXErrorSuccess and children:
                        for child in (children[:50] if children else []):
                            walk(child, depth + 1)
                except Exception:
                    pass

            walk(focused_app)
        except Exception:
            pass

        return results

    def get_active_window(self) -> Optional[UIElement]:
        """Return the currently active application window."""
        if not self._available:
            return None
        try:
            AS = self._ApplicationServices
            system_wide = AS.AXUIElementCreateSystemWide()
            err, focused_app = AS.AXUIElementCopyAttributeValue(
                system_wide, AS.kAXFocusedApplicationAttribute, None
            )
            if err != AS.kAXErrorSuccess or focused_app is None:
                return None
            err2, window = AS.AXUIElementCopyAttributeValue(
                focused_app, AS.kAXFocusedWindowAttribute, None
            )
            if err2 != AS.kAXErrorSuccess or window is None:
                return None
            return self._ax_to_element(window)
        except Exception:
            return None

    def click_element(self, element: UIElement) -> bool:
        """Click the center of an element using pyautogui (cross-platform)."""
        cx, cy = element.center
        try:
            import pyautogui
            pyautogui.click(cx, cy)
            return True
        except Exception:
            # Fallback: osascript click at coordinates
            try:
                script = f'tell application "System Events" to click at {{{cx}, {cy}}}'
                result = subprocess.run(
                    ["osascript", "-e", script],
                    capture_output=True
                )
                return result.returncode == 0
            except Exception:
                return False

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

    def _ax_to_element(self, ax_el) -> UIElement:
        """Convert an AXUIElement to UIElement."""
        AS = self._ApplicationServices

        def _attr(key, default=None):
            try:
                err, val = AS.AXUIElementCopyAttributeValue(ax_el, key, None)
                if err == AS.kAXErrorSuccess:
                    return val
            except Exception:
                pass
            return default

        try:
            role = str(_attr(AS.kAXRoleAttribute) or "unknown")
            name = str(_attr(AS.kAXTitleAttribute) or _attr(AS.kAXDescriptionAttribute) or "")
            description = str(_attr(AS.kAXDescriptionAttribute) or "")

            # Bounding box — AXFrame returns an NSRect-like object
            frame = _attr(AS.kAXFrameAttribute)
            if frame is not None:
                try:
                    import Cocoa
                    x = int(frame.origin.x)
                    y = int(frame.origin.y)
                    w = int(frame.size.width)
                    h = int(frame.size.height)
                except Exception:
                    x = y = w = h = 0
            else:
                x = y = w = h = 0

            is_focused = bool(_attr(AS.kAXFocusedAttribute) or False)
            is_enabled = bool(_attr(AS.kAXEnabledAttribute) if _attr(AS.kAXEnabledAttribute) is not None else True)

            return UIElement(
                role=role, name=name, description=description,
                x=x, y=y, width=w, height=h,
                is_focused=is_focused, is_enabled=is_enabled,
            )
        except Exception:
            return UIElement(role="unknown", name="")
