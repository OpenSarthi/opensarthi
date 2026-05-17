import os
import asyncio
from typing import Protocol

class DesktopProvider(Protocol):
    async def capture_screen(self) -> str: ...
    async def type_text(self, text: str) -> bool: ...
    async def click(self, x: int, y: int, button: str = "left") -> bool: ...

class XdotoolProvider:
    async def capture_screen(self) -> str:
        # Placeholder for actual implementation using mss or similar
        return "/tmp/opensarthi_screen.png"

    async def type_text(self, text: str) -> bool:
        proc = await asyncio.create_subprocess_exec(
            "xdotool", "type", "--delay", "50", text,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        await proc.communicate()
        return proc.returncode == 0

    async def click(self, x: int, y: int, button: str = "left") -> bool:
        btn_map = {"left": "1", "middle": "2", "right": "3"}
        proc = await asyncio.create_subprocess_exec(
            "xdotool", "mousemove", str(x), str(y), "click", btn_map.get(button, "1"),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        await proc.communicate()
        return proc.returncode == 0

class YdotoolProvider:
    async def capture_screen(self) -> str:
        return "/tmp/opensarthi_screen.png"

    async def type_text(self, text: str) -> bool:
        proc = await asyncio.create_subprocess_exec(
            "ydotool", "type", text,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        await proc.communicate()
        return proc.returncode == 0

    async def click(self, x: int, y: int, button: str = "left") -> bool:
        # ydotool click logic
        return True

class DesktopTools:
    def __init__(self):
        # Auto-detect Wayland vs X11
        wayland_display = os.environ.get("WAYLAND_DISPLAY")
        if wayland_display:
            self.provider: DesktopProvider = YdotoolProvider()
        else:
            self.provider: DesktopProvider = XdotoolProvider()

    async def capture_screen(self) -> str:
        return await self.provider.capture_screen()

    async def type_text(self, text: str) -> bool:
        return await self.provider.type_text(text)

    async def click(self, x: int, y: int, button: str = "left") -> bool:
        return await self.provider.click(x, y, button)
