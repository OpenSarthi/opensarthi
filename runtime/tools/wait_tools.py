from tools.base import BaseTool, RiskLevel
from planner.schemas import ToolResult, ToolResultConfidence
from sync_primitives import wait_for_window, wait_for_text_visible, TimeoutError

class WaitForWindowTool(BaseTool):
    name = "wait_for_window"
    description = "Wait until a window with the given title appears, then automatically pin it as the target for future type/click actions. Args: title (string), timeout (number, default 10.0)"
    risk_level = RiskLevel.SAFE

    async def execute(self, args: dict) -> ToolResult:
        title = args.get("title")
        timeout = float(args.get("timeout", 10.0))

        if not title:
            return ToolResult.fail("Missing title parameter", retryable=False)

        try:
            await wait_for_window(title, timeout=timeout)

            # Auto-pin the window ID so subsequent type/click tools target this window
            window_id = None
            try:
                import asyncio, shutil
                if shutil.which("xdotool"):
                    proc = await asyncio.create_subprocess_exec(
                        "xdotool", "search", "--onlyvisible", "--name", title,
                        stdout=asyncio.subprocess.PIPE,
                        stderr=asyncio.subprocess.PIPE
                    )
                    stdout, _ = await proc.communicate()
                    ids = stdout.decode().strip().split()
                    if ids:
                        window_id = ids[0]
                        from window_session import get_session
                        get_session().pin(window_id, title)
            except Exception:
                pass

            return ToolResult(
                success=True,
                observation=f"Window '{title}' appeared and pinned as task target" + (f" (ID: {window_id})" if window_id else ""),
                confidence=ToolResultConfidence.HIGH
            )
        except TimeoutError as e:
            return ToolResult.fail(str(e), retryable=False)
        except Exception as e:
            return ToolResult.fail(str(e), retryable=True)



class WaitForTextTool(BaseTool):
    name = "wait_for_text"
    description = "Wait until specific text is visible on screen. Args: text (string), timeout (number, default 10.0)"
    risk_level = RiskLevel.SAFE

    async def execute(self, args: dict) -> ToolResult:
        text = args.get("text")
        timeout = float(args.get("timeout", 10.0))

        if not text:
            return ToolResult.fail("Missing text parameter", retryable=False)

        try:
            await wait_for_text_visible(text, timeout=timeout)
            return ToolResult(
                success=True,
                observation=f"Text '{text}' visible on screen",
                confidence=ToolResultConfidence.HIGH
            )
        except TimeoutError as e:
            return ToolResult.fail(str(e), retryable=True)
        except Exception as e:
            return ToolResult.fail(str(e), retryable=True)
