import re
from typing import Optional

# Danger patterns that are always blocked
BLOCKED_PATTERNS = [
    r"rm\s+-rf\s+/",
    r"mkfs\.",
    r"dd\s+if=.+of=/dev/",
    r":\(\)\{.*\}",          # Fork bomb
    r"chmod\s+-R\s+777\s+/",
    r">\s*/dev/sd",
    r"format\s+[Cc]:",       # Windows
    r"del\s+/s\s+/q",        # Windows
]

def is_blocked(command: str) -> tuple[bool, Optional[str]]:
    """
    Check if a shell command contains blocked patterns.
    Returns (is_blocked, reason).
    """
    for pattern in BLOCKED_PATTERNS:
        if re.search(pattern, command, re.IGNORECASE):
            return True, f"Blocked pattern matched: {pattern}"
    return False, None

def requires_confirmation(command: str) -> bool:
    """
    Check if a shell command is dangerous enough to require user confirmation.
    """
    dangerous_prefixes = ["sudo", "rm ", "mv /", "chmod", "chown", "kill"]
    cmd_strip = command.strip().lower()
    return any(cmd_strip.startswith(p) for p in dangerous_prefixes)
