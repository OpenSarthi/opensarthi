import asyncio
import re
import platform
from tools.base import BaseTool, RiskLevel
from planner.schemas import ToolResult, ToolResultConfidence
from security import is_blocked, sandboxed_execute

class ShellTool(BaseTool):
    name = "shell"
    description = "Execute a shell command. Use for read-only operations. Args: command (string)"
    risk_level = RiskLevel.DANGEROUS

    async def execute(self, args: dict, permission_manager = None) -> ToolResult:
        command = args.get("command", "")
        timeout = float(args.get("timeout", 30))

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

        try:
            # Execute sandboxed or fallback direct depending on bwrap availability
            stdout, stderr, returncode = await sandboxed_execute(command, timeout=timeout)

            if returncode != 0:
                err_text = stderr[:500] or f"Process exited with code {returncode}"
                return ToolResult.fail(
                    err_text,
                    retryable=False,
                    raw_output={"returncode": returncode, "stderr": stderr}
                )

            output = stdout[:2000]  # Truncate large outputs
            return ToolResult.ok(
                observation=output if output else "(command completed with no output)",
                confidence=ToolResultConfidence.HIGH,
                raw_output={"returncode": 0, "stdout": output}
            )

        except Exception as e:
            return ToolResult.fail(str(e))
