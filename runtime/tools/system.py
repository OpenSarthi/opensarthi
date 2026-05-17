import asyncio
import re
import structlog

logger = structlog.get_logger()

class SystemTools:
    def __init__(self):
        self.use_bwrap = self._check_bwrap()
        # Basic regex to catch obvious destructive commands if bwrap fails
        self.dangerous_pattern = re.compile(r"rm\s+-rf\s+/|mkfs|dd\s+if=")

    def _check_bwrap(self) -> bool:
        # In a real setup, verify `bwrap` exists in PATH
        return True

    async def run_command(self, command: str) -> str:
        if self.dangerous_pattern.search(command):
            return "Error: Command rejected by security filter."

        if self.use_bwrap:
            # Construct a sandboxed command using bubblewrap
            # Read-only root, read-write home, no network (unless explicitly requested)
            safe_command = [
                "bwrap",
                "--ro-bind", "/", "/",
                "--dev", "/dev",
                "--proc", "/proc",
                "--bind", "/home", "/home",
                "--unshare-net",
                "bash", "-c", command
            ]
        else:
            safe_command = ["bash", "-c", command]

        logger.info("Executing shell command", command=command, sandboxed=self.use_bwrap)
        
        try:
            proc = await asyncio.create_subprocess_exec(
                *safe_command,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            stdout, stderr = await proc.communicate()
            
            result = stdout.decode()
            if proc.returncode != 0:
                result += f"\nError: {stderr.decode()}"
            return result
        except Exception as e:
            logger.error("Command execution failed", error=str(e))
            return f"Error executing command: {str(e)}"
