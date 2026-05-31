from typing import Any

class PermissionManager:
    """
    Centralized permission checking. Delegates to the WS session
    for interactive approval dialogs. Can be extended with permanent grants.
    """

    def __init__(self, ws_session=None):
        self._session = ws_session
        self._permanent_grants: set[str] = set()  # format: "tool:hash(args)"

    async def check(self, tool_name: str, args: dict, risk_level: str) -> bool:
        """
        Check permission for a specific tool and arguments.
        Returns True if approved, False otherwise.
        """
        if risk_level == "safe":
            return True
        if risk_level == "forbidden":
            return False

        grant_key = f"{tool_name}:{hash(str(sorted(args.items())))}"
        if grant_key in self._permanent_grants:
            return True

        if self._session:
            return await self._session.request_permission(tool_name, args)
        
        return False  # Deny by default if no session is available

    def grant_permanent(self, tool_name: str, args: dict):
        key = f"{tool_name}:{hash(str(sorted(args.items())))}"
        self._permanent_grants.add(key)
