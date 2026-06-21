import asyncio
import re
import platform
from typing import Optional, Callable, Awaitable
from tools.base import BaseTool, RiskLevel
from planner.schemas import ToolResult, ToolResultConfidence
from security import is_blocked, sandboxed_execute

class ShellTool(BaseTool):
    name = "shell"
    description = "Execute a shell command. For read-only operations and system tasks. Sandboxed — destructive commands are blocked."
    risk_level = RiskLevel.DANGEROUS
    schema = {
        "type": "object",
        "properties": {
            "command": {"type": "string", "description": "Shell command to execute"},
            "timeout": {"type": "number", "description": "Timeout in seconds (default: 30)"},
            "cwd": {"type": "string", "description": "Optional directory to run the command in. Defaults to the user's home directory."},
        },
        "required": ["command"],
    }

    async def execute(self, args: dict, permission_manager=None) -> ToolResult:
        from pathlib import Path
        import os

        command = args.get("command", "")
        timeout = float(args.get("timeout", 30))
        
        default_cwd = str(Path.home())
        cwd = args.get("cwd", default_cwd) or default_cwd
        if not os.path.exists(cwd):
            cwd = default_cwd

        if not command:
            return ToolResult.fail("No command provided", retryable=False)

        # Safety check first
        blocked, reason = is_blocked(command)
        if blocked:
            return ToolResult.fail(
                f"Blocked dangerous command: {reason}",
                retryable=False
            )

        # If command contains sudo, ask user for password
        if "sudo" in command and permission_manager:
            password = await permission_manager.request_user_input(
                prompt=f"The command requires sudo privileges: `{command}`. Please enter your sudo password:",
                input_type="password"
            )
            if password:
                # Rewrite sudo to use sudo -S with piped password
                command = re.sub(r'\bsudo\b', f'echo "{password}" | sudo -S', command)

        # Retrieve the log_action callback for streaming shell output lines
        log_action: Optional[Callable] = None
        if permission_manager and hasattr(permission_manager, 'log_action'):
            log_action = permission_manager.log_action
        # Also check via ws_handler directly
        if log_action is None and permission_manager and hasattr(permission_manager, 'send_message'):
            async def _emit_line(line: str):
                await permission_manager.send_message("shell_output", {
                    "line": line,
                    "command": command,
                })
            log_action_fn = _emit_line
        else:
            log_action_fn = None

        try:
            # Stream stdout line-by-line for real-time UI output
            output_lines = []
            stderr_lines = []

            proc = await asyncio.create_subprocess_shell(
                command,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=cwd,
            )

            async def _stream_stdout():
                async for raw_line in proc.stdout:
                    line = raw_line.decode(errors="replace").rstrip()
                    output_lines.append(line)
                    if log_action_fn:
                        try:
                            await log_action_fn(line)
                        except Exception:
                            pass

            async def _stream_stderr():
                async for raw_line in proc.stderr:
                    line = raw_line.decode(errors="replace").rstrip()
                    stderr_lines.append(line)

            try:
                await asyncio.wait_for(
                    asyncio.gather(_stream_stdout(), _stream_stderr()),
                    timeout=timeout
                )
            except asyncio.TimeoutError:
                proc.kill()
                return ToolResult.fail(
                    f"Command timed out after {timeout}s",
                    retryable=False,
                    raw_output={"returncode": -1, "stdout": "\n".join(output_lines[:50])}
                )

            returncode = await proc.wait()

            if returncode != 0:
                err_text = "\n".join(stderr_lines)[:500] or f"Process exited with code {returncode}"
                return ToolResult.fail(
                    err_text,
                    retryable=False,
                    raw_output={"returncode": returncode, "stderr": err_text}
                )

            output = "\n".join(output_lines)[:2000]  # Truncate very large outputs
            return ToolResult.ok(
                observation=output if output else "(command completed with no output)",
                confidence=ToolResultConfidence.HIGH,
                raw_output={"returncode": 0, "stdout": output}
            )

        except asyncio.CancelledError:
            try:
                proc.kill()
            except Exception:
                pass
            raise
        except Exception as e:
            return ToolResult.fail(str(e))
