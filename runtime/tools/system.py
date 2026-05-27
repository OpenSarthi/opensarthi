import asyncio
import re
import platform
from tools.base import BaseTool, RiskLevel
from planner.schemas import ToolResult, ToolResultConfidence

class ShellTool(BaseTool):
    name = "shell"
    description = "Execute a shell command. Use for read-only operations. Args: command (string)"
    risk_level = RiskLevel.DANGEROUS

    # Blocked patterns — never execute these
    BLOCKED = [
        r"rm\s+-rf\s+/",
        r"mkfs\.",
        r"dd\s+if=.+of=/dev/",
        r":\(\)\{.*\}",  # fork bomb
        r"chmod\s+-R\s+777\s+/",
        r">\s*/dev/sd",
        r"format\s+[a-zA-Z]:",  # Windows format drive
        r"del\s+/[sS]\s+/[qQ]",  # Windows recursive delete
    ]

    async def execute(self, args: dict, permission_manager = None) -> ToolResult:
        command = args.get("command", "")
        timeout = float(args.get("timeout", 30))

        if not command:
            return ToolResult.fail("No command provided", retryable=False)

        # If command contains sudo, ask user for password
        if "sudo" in command and permission_manager:
            password = await permission_manager.request_user_input(
                prompt=f"The command requires sudo privileges: `{command}`. Please enter your sudo password:",
                input_type="password"
            )
            if password:
                # Rewrite sudo to use sudo -S with piped password
                command = re.sub(r'\bsudo\b', f'echo "{password}" | sudo -S', command)

        # Safety check
        for pattern in self.BLOCKED:
            if re.search(pattern, command):
                return ToolResult.fail(
                    f"Blocked dangerous pattern in command: '{command}'",
                    retryable=False
                )

        try:
            # Use platform-appropriate shell
            if platform.system() == "Windows":
                shell_cmd = ["cmd.exe", "/c", command]
            else:
                shell_cmd = ["bash", "-c", command]

            proc = await asyncio.create_subprocess_exec(
                *shell_cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            try:
                stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
            except asyncio.TimeoutError:
                proc.kill()
                return ToolResult.fail(f"Command timed out after {timeout}s", retryable=False)

            if proc.returncode != 0:
                err_text = stderr.decode()[:500] or f"Process exited with code {proc.returncode}"
                return ToolResult.fail(
                    err_text,
                    retryable=False,
                    raw_output={"returncode": proc.returncode, "stderr": stderr.decode()}
                )

            output = stdout.decode()[:2000]  # Truncate large outputs
            return ToolResult.ok(
                observation=output if output else "(command completed with no output)",
                confidence=ToolResultConfidence.HIGH,
                raw_output={"returncode": 0, "stdout": output}
            )

        except Exception as e:
            return ToolResult.fail(str(e))
