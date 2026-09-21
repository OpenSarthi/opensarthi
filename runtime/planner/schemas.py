from pydantic import BaseModel
from typing import Optional, Any, List
from enum import Enum

class ToolResultConfidence(str, Enum):
    HIGH   = "high"    # Action definitely worked
    MEDIUM = "medium"  # Action likely worked, unverified
    LOW    = "low"     # Action may have worked

class ToolResult(BaseModel):
    """
    Standard return type for ALL tools.
    Rich enough for the agent to decide: continue / retry / replan.
    """
    success: bool
    observation: Optional[str] = None          # Human-readable description
    ui_changed: Optional[bool] = None          # Did the screen change?
    active_window: Optional[str] = None        # Window title after action
    error: Optional[str] = None                # Error message if failed
    retryable: bool = True                     # Can the step be retried?
    confidence: ToolResultConfidence = ToolResultConfidence.MEDIUM
    suggested_next: Optional[str] = None       # e.g. "Now wait for Firefox to load"
    raw_output: Optional[Any] = None

    @classmethod
    def ok(cls, observation: str = "Success", **kwargs) -> "ToolResult":
        return cls(success=True, observation=observation, **kwargs)

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
