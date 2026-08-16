import asyncio
import shutil
from tools.base import BaseTool, RiskLevel, ToolDomain
from planner.schemas import ToolResult, ToolResultConfidence

class MediaControlTool(BaseTool):
    name = "media_control"
    description = "Control active media players via playerctl (Spotify, VLC, YouTube in browser, etc.)."
    risk_level = RiskLevel.SAFE
    domain = ToolDomain.MUSIC
    schema = {
        "type": "object",
        "properties": {
            "action": {
                "type": "string",
                "enum": ["play-pause", "next", "previous", "stop", "volume-up", "volume-down"],
                "description": "Media control action. Default is 'play-pause' if unspecified."
            },
        },
        "required": [],
    }

    async def execute(self, args: dict) -> ToolResult:
        action = (args.get("action") or "").lower().strip()
        if not action:
            action = "play-pause"

        if not shutil.which("playerctl"):
            from tools.desktop import _provider, XdotoolProvider, YdotoolProvider, PyAutoGUIProvider

            # 1. Volume tool fallbacks
            if action in ["volume-up", "volume-down"]:
                if shutil.which("pactl"):
                    val = "+5%" if action == "volume-up" else "-5%"
                    proc = await asyncio.create_subprocess_exec(
                        "pactl", "set-sink-volume", "@DEFAULT_SINK@", val
                    )
                    await proc.communicate()
                    return ToolResult.ok("Volume adjusted using pactl fallback")
                elif shutil.which("amixer"):
                    val = "5%+" if action == "volume-up" else "5%-"
                    proc = await asyncio.create_subprocess_exec(
                        "amixer", "set", "Master", val
                    )
                    await proc.communicate()
                    return ToolResult.ok("Volume adjusted using amixer fallback")

            # 2. Keyboard simulation mappings
            X11_KEYS = {
                "play-pause": "XF86AudioPlay",
                "next": "XF86AudioNext",
                "previous": "XF86AudioPrev",
                "stop": "XF86AudioStop",
                "volume-up": "XF86AudioRaiseVolume",
                "volume-down": "XF86AudioLowerVolume",
            }
            WAYLAND_KEYS = {
                "play-pause": "172",
                "next": "163",
                "previous": "165",
                "stop": "166",
                "volume-up": "115",
                "volume-down": "114",
            }
            WINDOWS_KEYS = {
                "play-pause": "playpause",
                "next": "nexttrack",
                "previous": "prevtrack",
                "stop": "stop",
                "volume-up": "volumeup",
                "volume-down": "volumedown",
            }

            key = None
            if isinstance(_provider, XdotoolProvider):
                key = X11_KEYS.get(action)
            elif isinstance(_provider, YdotoolProvider):
                key = WAYLAND_KEYS.get(action)
            elif isinstance(_provider, PyAutoGUIProvider):
                key = WINDOWS_KEYS.get(action)

            if key:
                success = await _provider.press_key(key)
                if success:
                    return ToolResult.ok(f"Media command '{action}' simulated via keyboard key '{key}'")
                else:
                    return ToolResult.fail(f"Failed to simulate keyboard key '{key}' for action '{action}'")

            return ToolResult.fail("playerctl is not installed, and no keyboard fallback is available.", retryable=False)

        try:
            if action == "volume-up":
                # Increase volume by 5%
                proc = await asyncio.create_subprocess_exec(
                    "playerctl", "volume", "0.05+", stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
                )
                stdout, stderr = await proc.communicate()
                obs = "Volume increased by 5%"
            elif action == "volume-down":
                # Decrease volume by 5%
                proc = await asyncio.create_subprocess_exec(
                    "playerctl", "volume", "0.05-", stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
                )
                stdout, stderr = await proc.communicate()
                obs = "Volume decreased by 5%"
            elif action in ["play-pause", "next", "previous", "stop"]:
                proc = await asyncio.create_subprocess_exec(
                    "playerctl", action, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
                )
                stdout, stderr = await proc.communicate()
                obs = f"Media command '{action}' sent successfully"
            else:
                return ToolResult.fail(f"Invalid media action: {action}", retryable=False)

            if proc.returncode != 0:
                err = stderr.decode().strip() or f"playerctl exited with code {proc.returncode}"
                # If no player is running, return a clean message
                if "No players found" in err:
                    return ToolResult.ok("No active media players running currently")
                return ToolResult.fail(err, retryable=True)

        except FileNotFoundError:
            # playerctl binary not executable or missing, fall back to keyboard simulation
            from tools.desktop import _provider, XdotoolProvider, YdotoolProvider, PyAutoGUIProvider
            X11_KEYS = {
                "play-pause": "XF86AudioPlay",
                "next": "XF86AudioNext",
                "previous": "XF86AudioPrev",
                "stop": "XF86AudioStop",
                "volume-up": "XF86AudioRaiseVolume",
                "volume-down": "XF86AudioLowerVolume",
            }
            key = X11_KEYS.get(action)
            if key and _provider:
                try:
                    await _provider.press_key(key)
                    return ToolResult.ok(f"Media command '{action}' simulated via keyboard key '{key}'")
                except Exception as kb_err:
                    return ToolResult.fail(f"Media command fallback failed: {kb_err}", retryable=False)
            return ToolResult.fail("playerctl missing and no keyboard fallback available.", retryable=False)
        except Exception as e:
            return ToolResult.fail(str(e))
