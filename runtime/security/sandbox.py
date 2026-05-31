import asyncio
import shutil
from pathlib import Path
from typing import Optional

# Check if bubblewrap is installed on the system
BWRAP_AVAILABLE = shutil.which("bwrap") is not None

async def sandboxed_execute(
    command: str,
    timeout: float = 30.0,
    allow_network: bool = True,
    allow_home: bool = True,
) -> tuple[str, str, int]:
    """
    Execute a command in a bubblewrap sandbox.
    Returns (stdout, stderr, returncode).
    """
    if not BWRAP_AVAILABLE:
        # Graceful fallback: direct shell execution
        return await _direct_execute(command, timeout)

    # Build bubblewrap command
    bwrap_cmd = [
        "bwrap",
        "--ro-bind", "/usr", "/usr",
        "--ro-bind", "/bin", "/bin",
        "--ro-bind", "/lib", "/lib",
        "--ro-bind", "/lib64", "/lib64",
        "--proc", "/proc",
        "--dev", "/dev",
        "--tmpfs", "/tmp",
        "--unshare-pid",
        "--die-with-parent",
    ]

    if allow_network:
        bwrap_cmd += ["--share-net"]

    if allow_home:
        home_path = str(Path.home())
        bwrap_cmd += ["--bind", home_path, home_path]

    bwrap_cmd += ["--", "bash", "-c", command]

    try:
        proc = await asyncio.create_subprocess_exec(
            *bwrap_cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        return stdout.decode(errors="replace"), stderr.decode(errors="replace"), proc.returncode
    except asyncio.TimeoutError:
        try:
            proc.kill()
        except ProcessLookupError:
            pass
        return "", f"Command timed out after {timeout} seconds", 1
    except Exception as e:
        return "", f"Sandbox execution failed to start: {str(e)}", 1

async def _direct_execute(command: str, timeout: float) -> tuple[str, str, int]:
    """Fallback execute command directly in shell."""
    try:
        proc = await asyncio.create_subprocess_shell(
            command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        return stdout.decode(errors="replace"), stderr.decode(errors="replace"), proc.returncode
    except asyncio.TimeoutError:
        try:
            proc.kill()
        except ProcessLookupError:
            pass
        return "", f"Command timed out after {timeout} seconds", 1
    except Exception as e:
        return "", f"Direct execution failed: {str(e)}", 1
