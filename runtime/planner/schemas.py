from pydantic import BaseModel, ConfigDict, model_validator
from typing import Optional, Any, List
from enum import Enum
import json

class ToolResultConfidence(str, Enum):
    HIGH   = "high"    # Action definitely worked / verified
    MEDIUM = "medium"  # Action likely worked, unverified
    LOW    = "low"     # Action may have worked

class ToolResult(BaseModel):
    """
    Standard return type for ALL tools.
    Rich enough for the agent to decide: continue / retry / replan.
    """
    model_config = ConfigDict(extra="allow", arbitrary_types_allowed=True)

    success: bool
    observation: Optional[str] = None          # Human-readable description
    result: Optional[Any] = None               # Structured result for tools returning dict/data
    raw_output: Optional[Any] = None
    ui_changed: Optional[bool] = None          # Did the screen change?
    active_window: Optional[str] = None        # Window title after action
    error: Optional[str] = None                # Error message if failed
    retryable: bool = True                     # Can the step be retried?
    confidence: ToolResultConfidence = ToolResultConfidence.MEDIUM
    suggested_next: Optional[str] = None       # e.g. "Now wait for Firefox to load"

    @model_validator(mode="before")
    @classmethod
    def populate_observation_and_result(cls, data: Any) -> Any:
        if isinstance(data, dict):
            res = data.get("result")
            raw = data.get("raw_output")
            obs = data.get("observation")
            if not obs:
                val = res if res is not None else raw
                if val is not None:
                    if isinstance(val, (dict, list)):
                        try:
                            data["observation"] = json.dumps(val, indent=2)
                        except Exception:
                            data["observation"] = str(val)
                    else:
                        data["observation"] = str(val)
            if res is not None and raw is None:
                data["raw_output"] = res
            elif raw is not None and res is None:
                data["result"] = raw
        return data

    @classmethod
    def ok(cls, observation: Any = "Success", **kwargs) -> "ToolResult":
        if isinstance(observation, (dict, list)):
            return cls(success=True, result=observation, **kwargs)
        return cls(success=True, observation=str(observation), **kwargs)

    @classmethod
    def fail(cls, error: str, retryable: bool = True, **kwargs) -> "ToolResult":
        return cls(success=False, error=error, retryable=retryable, **kwargs)

class PlanStep(BaseModel):
    tool: str                            # Tool name from registry
    args: dict = {}                      # Tool arguments
    description: str = ""                # Human-readable description of this step
    verify_with: Optional[str] = None   # Post-condition: text/window to verify
    wait_after: Optional[float] = None  # Seconds to wait after execution
    retryable: bool = True
    depends_on: List[int] = []          # Step indices this depends on

class Plan(BaseModel):
    goal: str
    steps: List[PlanStep]
    final_response: Optional[str] = None   # Text response after all steps
    recovery_hint: Optional[str] = None    # What to do if plan fails

class AgentContext(BaseModel):
    """Full context passed to the agent on each invocation."""
    goal: str
    snapshot: Optional[dict] = None         # Serialized DesktopSnapshot
    current_step: int = 0
    total_steps: int = 0
    previous_actions: List[str] = []
    failed_actions: List[str] = []
    retry_count: int = 0
    conversation_history: List[dict] = []   # Last N messages
