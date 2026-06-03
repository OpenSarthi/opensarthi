import asyncio
import shutil
from tools.base import BaseTool, RiskLevel
from planner.schemas import ToolResult, ToolResultConfidence

class MediaControlTool(BaseTool):
    name = "media_control"
    description = "Control active media players via playerctl (Spotify, VLC, YouTube in browser, etc.)."
    risk_level = RiskLevel.SAFE
    schema = {
        "type": "object",
        "properties": {
            "action": {"type": "string", "enum": ["play-pause", "next", "previous", "stop", "volume-up", "volume-down"], "description": "Media control action"},
        },
        "required": ["action"],
    }

    async def execute(self, args: dict) -> ToolResult:
        action = args.get("action", "").lower()
        if not action:
            return ToolResult.fail("Missing action parameter", retryable=False)

        if not shutil.which("playerctl"):
            # Fallback: support pulse-audio pactl for volume
            if action in ["volume-up", "volume-down"] and shutil.which("pactl"):
                val = "+5%" if action == "volume-up" else "-5%"
                proc = await asyncio.create_subprocess_exec(
                    "pactl", "set-sink-volume", "@DEFAULT_SINK@", val
                )
                await proc.communicate()
                return ToolResult.ok(f"Volume adjusted using pactl fallback")
            return ToolResult.fail("playerctl is not installed on this system.", retryable=False)

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

            return ToolResult.ok(obs)
        except Exception as e:
            return ToolResult.fail(str(e))
