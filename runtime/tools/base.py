from abc import ABC, abstractmethod
from typing import Any, Optional, Dict
from planner.schemas import ToolResult
from enum import Enum

class RiskLevel(str, Enum):
    SAFE      = "safe"       # read-only, view-only actions
    MODERATE  = "moderate"   # typing, clicking, file reads
    DANGEROUS = "dangerous"  # shell commands, file writes, system changes
    FORBIDDEN = "forbidden"  # never auto-execute

class BaseTool(ABC):
    name: str
    description: str          # Shown to LLM for tool selection
    risk_level: RiskLevel = RiskLevel.MODERATE

    # JSON Schema for args — enforces required params and prevents hallucination.
    # Must be a dict with "type": "object", "properties": {...}, "required": [...]
    schema: Dict[str, Any] = {}

    def args_schema_summary(self) -> str:
        """Return a compact, LLM-readable summary of required and optional args."""
        props = self.schema.get("properties", {})
        required = set(self.schema.get("required", []))
        if not props:
            return "(no args)"
        parts = []
        for k, v in props.items():
            t = v.get("type", "any")
            desc = v.get("description", "")
            enum_vals = v.get("enum", [])
            enum_str = f" [{', '.join(map(str, enum_vals))}]" if enum_vals else ""
            req_mark = "" if k in required else "?"
            detail = f" — {desc}" if desc else ""
            parts.append(f"{k}{req_mark}: {t}{enum_str}{detail}")
        return ", ".join(parts)

    @abstractmethod
    async def execute(self, args: dict) -> ToolResult:
        """Execute the tool and return a structured ToolResult."""
        ...

    async def safe_execute(self, args: dict, permission_manager=None) -> ToolResult:
        """Permission-checked execution wrapper."""
        if self.risk_level == RiskLevel.FORBIDDEN:
            return ToolResult.fail("This action is forbidden.", retryable=False)

        if self.risk_level == RiskLevel.DANGEROUS and permission_manager:
            approved = await permission_manager.request_permission(self.name, args)
            if not approved:
                return ToolResult.fail("User denied permission.", retryable=False)

        try:
            import inspect
            sig = inspect.signature(self.execute)
            if 'permission_manager' in sig.parameters:
                return await self.execute(args, permission_manager=permission_manager)
            return await self.execute(args)
        except Exception as e:
            return ToolResult.fail(str(e), retryable=True)
