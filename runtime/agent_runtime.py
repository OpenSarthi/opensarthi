import asyncio
import time
import json
from typing import Optional, Any
from pydantic_ai import Agent
from state_machine import AgentState, AgentStateContext
from planner.schemas import Plan, PlanStep, ToolResult
from observation import DesktopObserver, DesktopSnapshot
from dev_logger import DevLogger

class AgentRuntime:
    """
    The stateful execution engine for OpenSarthi.
    Supports immediate cancellation of both LLM inference and tool execution.
    """

    def __init__(self, ws_handler, agent: Agent, observer: DesktopObserver, deps=None, memory_manager=None):
        self.ws = ws_handler
        self.agent = agent
        self.observer = observer
        self.deps = deps
        self.memory = memory_manager
        self.state = AgentStateContext()
        self.cumulative_steps = []
        self._cancel_requested = False
        self._paused = False
        self._pause_event = asyncio.Event()
        self._pause_event.set()  # starts unpaused
        self.last_usage = None
        # Cancellable task handles
        self._agent_task: Optional[asyncio.Task] = None
        self._tool_task: Optional[asyncio.Task] = None
        # Fail-fast: track consecutive same-error failures per tool
        self._same_tool_fail_count: dict[str, int] = {}
        self._last_tool_error: dict[str, str] = {}

    def pause(self):
        self._paused = True
        self._pause_event.clear()

    def resume(self):
        self._paused = False
        self._pause_event.set()

    def request_cancel(self):
        """Immediately cancel any in-flight LLM inference or tool execution."""
        self._cancel_requested = True
        self._pause_event.set()  # unblock pause gate
        if self._agent_task and not self._agent_task.done():
            self._agent_task.cancel()
        if self._tool_task and not self._tool_task.done():
            self._tool_task.cancel()

    async def _check_pause(self):
        await self._pause_event.wait()

    async def _agent_run(self, *args, **kwargs) -> Any:
        """Wrap agent.run() in a cancellable asyncio Task."""
        self._agent_task = asyncio.ensure_future(self.agent.run(*args, **kwargs))
        try:
            return await self._agent_task
        except asyncio.CancelledError:
            raise
        finally:
            self._agent_task = None

    def _format_final_response(self, response: str, cumulative_steps: list) -> str:
        if not cumulative_steps:
            return response
        lines = [response, ""]
        for s in cumulative_steps:
            desc = s.get("description") or s.get("tool")
            status = s.get("status")
            if status == "success":
                lines.append(f"✓ {desc}")
            elif status == "error":
                err = s.get("error", "Error")
                lines.append(f"❌ {desc} (Reason: {err})")
            elif status == "terminated":
                lines.append(f"❌ {desc} (Reason: Terminated)")
        return "\n".join(lines)

    async def _cancellable_sleep(self, seconds: float):
        """Sleep that immediately aborts if cancel is requested."""
        try:
            await asyncio.wait_for(asyncio.shield(asyncio.sleep(seconds)), timeout=seconds + 0.5)
        except (asyncio.TimeoutError, asyncio.CancelledError):
            pass

    async def run(self, goal: str, model, message_history: list, summarized_context: str = None) -> str:
        # Initialize DevLogger
        model_name = getattr(model, "model_name", str(model))
        provider_name = "unknown"
        if hasattr(model, "client"):
            provider_name = model.__class__.__name__
        self.logger = DevLogger(goal=goal, model_name=model_name, provider=provider_name)
        
        # Log system prompt
        try:
            from planner.agent import build_system_prompt
            sys_prompt = build_system_prompt(
                skills=getattr(self.deps, "skills", ["general"]),
                user_name=getattr(self.deps, "user_name", ""),
                custom_prompt=getattr(self.deps, "custom_prompt", "")
            )
            self.logger.log_system_prompt(sys_prompt)
        except Exception as e:
            self.logger.log(f"Failed to compile and log system prompt: {e}")

        final_res = "Execution terminated unexpectedly."
        try:
            final_res = await self._run_logged(goal, model, message_history, summarized_context)
            return final_res
        except Exception as e:
            final_res = f"Fatal execution error: {e}"
            raise e
        finally:
            if getattr(self, "logger", None):
                self.logger.finalize(final_res)

    async def _run_logged(self, goal: str, model, message_history: list, summarized_context: str = None) -> str:
        self._cancel_requested = False
        self._paused = False
        self._pause_event.set()
        self.state = AgentStateContext(current_goal=goal)
        self.last_usage = None
        self._same_tool_fail_count.clear()
        self._last_tool_error.clear()

        # Reset window session for this fresh task run
        try:
            from window_session import reset_session
            reset_session()
        except Exception:
            pass

        completed_actions = []
        failed_actions = []
        self.cumulative_steps = []
        replanning_attempts = 0
        max_replanning_attempts = 5

        try:
            while replanning_attempts < max_replanning_attempts:
                if self._cancel_requested:
                    await self._transition(AgentState.IDLE)
                    return "Execution cancelled by user."

                await self._check_pause()
                if self._cancel_requested:
                    await self._transition(AgentState.IDLE)
                    return "Execution cancelled by user."

                await self._transition(AgentState.OBSERVING)
                snapshot = await self.observer.snapshot()

                await self._transition(AgentState.PLANNING)

                recalled = []
                if self.memory:
                    recalled = await self.memory.recall(goal, top_k=3)

                from planner.agent import build_structured_context
                context = build_structured_context(
                    goal=goal,
                    snapshot=snapshot,
                    history=message_history,
                    current_step=len(completed_actions),
                    total_steps=len(completed_actions) + 1,
                    previous_actions=completed_actions,
                    failed_actions=failed_actions,
                    retry_count=replanning_attempts,
                    skills=getattr(self.deps, 'skills', None),
                    recalled_memories=recalled,
                    summarized_context=summarized_context,
                )

                if getattr(self, "logger", None):
                    self.logger.log_planning_context(replanning_attempts, context)

                try:
                    result = await self._agent_run(context, deps=self.deps, model=model, message_history=message_history)
                    if getattr(self, "logger", None):
                        self.logger.log_llm_response(replanning_attempts, result.output)
                    if result and getattr(result, "usage", None):
                        await self.ws.accumulate_and_update_tokens(result.usage)
                except asyncio.CancelledError:
                    await self._transition(AgentState.IDLE)
                    return "Execution cancelled by user."

                self.last_usage = getattr(result, "usage", None)
                plan, text_response = self._parse_response(result.output)

                if plan is None:
                    response = text_response or "I couldn't generate a plan or a response."
                    if self.memory:
                        await self.memory.store(
                            content=f"Goal: {goal}\nOutcome: {response}",
                            source="agent",
                            importance=0.8
                        )
                    await self._transition(AgentState.COMPLETE)
                    return self._format_final_response(response, self.cumulative_steps)

                import uuid
                plan_id = str(uuid.uuid4())
                
                # Append the new steps to our global cumulative steps list
                start_idx = len(self.cumulative_steps)
                for idx, s in enumerate(plan.steps):
                    self.cumulative_steps.append({
                        "index": len(self.cumulative_steps),
                        "tool": s.tool,
                        "args": s.args or {},
                        "description": s.description or s.tool,
                        "status": "pending",
                        "verify_with": s.verify_with,
                        "wait_after": s.wait_after
                    })
                end_idx = len(self.cumulative_steps)

                await self.ws.send_message("plan_created", {
                    "id": plan_id,
                    "goal": plan.goal or goal or "Executing Task",
                    "steps": self.cumulative_steps,
                    "recovery_hint": plan.recovery_hint
                })

                self.state.total_steps = len(plan.steps)
                await self._transition(AgentState.PLANNING)

                plan_failed = False
                last_step_idx = start_idx
                for i in range(start_idx, end_idx):
                    last_step_idx = i
                    step_data = self.cumulative_steps[i]
                    from planner.schemas import PlanStep as PS
                    step = PS(
                        tool=step_data["tool"],
                        args=step_data["args"],
                        description=step_data["description"],
                        verify_with=step_data["verify_with"],
                        wait_after=step_data["wait_after"]
                    )
                    
                    if self._cancel_requested:
                        for remain_idx in range(i, end_idx):
                            await self.ws.send_message("tool_terminated", {"index": remain_idx})
                            if remain_idx < len(self.cumulative_steps):
                                self.cumulative_steps[remain_idx]["status"] = "terminated"
                        break

                    await self._transition(
                        AgentState.EXECUTING,
                        current_step_index=i,
                        current_step_description=step.description,
                        retry_count=0
                    )

                    step_success = False
                    self.state.retry_count = 0
                    while self.state.retry_count <= self.state.max_retries:
                        await self._check_pause()
                        if self._cancel_requested:
                            break

                        result = await self._execute_step(step, i)

                        if self._cancel_requested:
                            break

                        if result.success:
                            if step.verify_with:
                                await self._transition(AgentState.OBSERVING)
                                verified = await self._verify_postcondition(step.verify_with)
                                if not verified:
                                    result = ToolResult.fail(
                                        error=f"Post-condition failed: {step.verify_with}",
                                        retryable=True
                                    )
                                else:
                                    step_success = True
                                    break
                            else:
                                step_success = True
                                break

                        if not result.success:
                            # Fail-fast: if the same tool fails with the same error twice, stop immediately
                            tool_key = step.tool
                            err_msg = (result.error or "").strip()[:200]
                            if self._last_tool_error.get(tool_key) == err_msg:
                                self._same_tool_fail_count[tool_key] = self._same_tool_fail_count.get(tool_key, 1) + 1
                            else:
                                self._same_tool_fail_count[tool_key] = 1
                                self._last_tool_error[tool_key] = err_msg

                            if self._same_tool_fail_count.get(tool_key, 0) >= 2:
                                # Hard stop — agent is looping
                                import structlog
                                structlog.get_logger().warning(
                                    "Fail-fast triggered: same tool failed with same error twice",
                                    tool=tool_key, error=err_msg
                                )
                                break

                            if result.retryable and self.state.retry_count < self.state.max_retries:
                                self.state.retry_count += 1
                                await self._transition(
                                    AgentState.RETRYING,
                                    current_step_description=f"Retrying: {step.description} ({self.state.retry_count}/{self.state.max_retries})"
                                )
                                await self._cancellable_sleep(1.5)
                                if self._cancel_requested:
                                    break
                            else:
                                break

                    if self._cancel_requested:
                        for remain_idx in range(i, end_idx):
                            await self.ws.send_message("tool_terminated", {"index": remain_idx})
                            if remain_idx < len(self.cumulative_steps):
                                self.cumulative_steps[remain_idx]["status"] = "terminated"
                        break

                    if step_success:
                        completed_actions.append(step.description or f"Executed tool: {step.tool}")
                        if step.wait_after:
                            await self._transition(AgentState.WAITING)
                            await asyncio.sleep(step.wait_after)
                    else:
                        for remain_idx in range(i + 1, end_idx):
                            await self.ws.send_message("tool_terminated", {"index": remain_idx})
                            if remain_idx < len(self.cumulative_steps):
                                self.cumulative_steps[remain_idx]["status"] = "terminated"
                        failed_actions.append(f"{step.description or step.tool} (Reason: {result.error})")
                        plan_failed = True
                        break

                if self._cancel_requested:
                    await self._transition(AgentState.IDLE)
                    response = "Execution cancelled by user."
                    for remain_idx in range(last_step_idx, len(self.cumulative_steps)):
                        if remain_idx < len(self.cumulative_steps):
                            self.cumulative_steps[remain_idx]["status"] = "terminated"
                            await self.ws.send_message("tool_terminated", {"index": remain_idx})
                    return self._format_final_response(response, self.cumulative_steps)

                if plan_failed:
                    replanning_attempts += 1
                    self.state.retry_count = replanning_attempts
                    await self._transition(AgentState.RETRYING, current_step_description="Replanning due to step failure...")
                    await self._cancellable_sleep(1.5)
                    if self._cancel_requested:
                        await self._transition(AgentState.IDLE)
                        return "Execution cancelled by user."
                    continue

                replanning_attempts += 1
                self.state.retry_count = replanning_attempts
                await self._transition(AgentState.RETRYING, current_step_description="Verifying task completion...")
                await asyncio.sleep(1.0)

            await self._transition(AgentState.ERROR, error_message="Task failed after maximum replanning attempts.")

            final_error_context = f"""OPENSARTHI TASK FAILURE SUMMARY
════════════════════════════════════════════════
Goal: {goal}
Completed: {completed_actions}
Failed: {failed_actions}
════════════════════════════════════════════════
Explain to the user why the task could not be completed. Do NOT output a JSON plan."""
            try:
                result = await self._agent_run(final_error_context, deps=self.deps, model=model, message_history=message_history)
                response = result.output
                if result and getattr(result, "usage", None):
                    await self.ws.accumulate_and_update_tokens(result.usage)
            except asyncio.CancelledError:
                response = "Execution cancelled by user."
            except Exception as e:
                response = f"❌ Failed to complete the task: {str(e)}"

            if self.memory:
                await self.memory.store(
                    content=f"Goal: {goal}\nOutcome (Failed): {response}\nCompleted: {completed_actions}\nFailed: {failed_actions}",
                    source="agent",
                    importance=0.7
                )
            return self._format_final_response(response, self.cumulative_steps)

        except asyncio.CancelledError:
            await self._transition(AgentState.IDLE)
            raise
        except Exception as e:
            import structlog
            structlog.get_logger().error("System error during execution", exc_info=True)
            err_type = type(e).__name__
            err_msg = str(e).strip()
            network_err_types = (
                "ConnectTimeout", "ReadTimeout", "WriteTimeout",
                "ConnectError", "RemoteProtocolError", "NetworkError",
                "UnexpectedStatus", "ModelHTTPError"
            )
            if not err_msg or err_type in network_err_types or "timeout" in err_msg.lower() or "connect" in err_msg.lower():
                await self._transition(AgentState.ERROR, error_message=f"{err_type}: API connection failed")
                raise
            await self._transition(AgentState.ERROR, error_message=err_msg or err_type)
            return f"❌ System error during execution: {err_msg or err_type}"
        finally:
            await asyncio.sleep(1.0)
            await self._transition(AgentState.IDLE)

    async def run_plan_directly(self, steps: list, goal: str) -> str:
        """Execute a pre-built JSON plan without LLM planning (for JSON import feature)."""
        self._cancel_requested = False
        self._paused = False
        self._pause_event.set()
        self.state = AgentStateContext(current_goal=goal)

        import uuid
        from planner.schemas import PlanStep as PS

        # Parse & validate steps
        try:
            plan_steps = []
            for s in steps:
                if "tool" not in s and "action" in s:
                    s["tool"] = s.pop("action")
                if "args" not in s:
                    s["args"] = {}
                if "description" not in s:
                    s["description"] = s.get("tool", "")
                plan_steps.append(PS(**s))
        except Exception as e:
            return f"❌ Invalid plan format: {e}"

        # Broadcast plan to UI
        steps_data = [{
            "index": i,
            "tool": s.tool,
            "args": s.args or {},
            "description": s.description or s.tool,
            "status": "pending",
            "verify_with": s.verify_with,
            "wait_after": s.wait_after
        } for i, s in enumerate(plan_steps)]
        self.cumulative_steps = steps_data

        await self.ws.send_message("plan_created", {
            "id": str(uuid.uuid4()),
            "goal": goal,
            "steps": self.cumulative_steps,
            "recovery_hint": None
        })

        await self._transition(AgentState.EXECUTING)

        for i, step in enumerate(plan_steps):
            if self._cancel_requested:
                for j in range(i, len(plan_steps)):
                    await self.ws.send_message("tool_terminated", {"index": j})
                    if j < len(self.cumulative_steps):
                        self.cumulative_steps[j]["status"] = "terminated"
                break

            await self._check_pause()
            if self._cancel_requested:
                for j in range(i, len(plan_steps)):
                    await self.ws.send_message("tool_terminated", {"index": j})
                    if j < len(self.cumulative_steps):
                        self.cumulative_steps[j]["status"] = "terminated"
                break

            await self._transition(
                AgentState.EXECUTING,
                current_step_index=i,
                current_step_description=step.description
            )

            result = await self._execute_step(step, i)

        await self._transition(AgentState.IDLE)
        return self._format_final_response(f"JSON task completed: {goal}", self.cumulative_steps)

    async def _transition(self, new_state: AgentState, **kwargs):
        self.state.transition(new_state, **kwargs)
        await self.ws.emit_state(self.state)

    def _parse_response(self, raw_output: Any) -> tuple[Optional[Plan], Optional[str]]:
        if isinstance(raw_output, Plan):
            return raw_output, None

        if isinstance(raw_output, str):
            text = raw_output.strip()
            import re

            think_blocks = re.findall(r'<think>([\s\S]*?)</think>', text)
            text_for_json = re.sub(r'<think>[\s\S]*?</think>', '', text).strip()

            json_text = None
            json_match = re.search(r'```json\s*([\s\S]*?)\s*```', text_for_json)
            if json_match:
                json_text = json_match.group(1).strip()
            else:
                json_match = re.search(r'```\s*(\[[\s\S]*?\]|\{[\s\S]*?\})\s*```', text_for_json)
                if json_match:
                    json_text = json_match.group(1).strip()
                else:
                    json_match = re.search(r'(\[[\s\S]*?\]|\{[\s\S]*?\})', text_for_json)
                    if json_match:
                        json_text = json_match.group(1).strip()

            if json_text:
                try:
                    data = json.loads(json_text)
                    TOOL_ARG_ORDER = {
                        "open_app": ["app"],
                        "click": ["x", "y", "button"],
                        "type_text": ["text"],
                        "press_key": ["key"],
                        "shell": ["command", "timeout"],
                        "wait_for_window": ["title", "timeout"],
                        "wait_for_text": ["text", "timeout"],
                        "click_element": ["role", "name"],
                        "focus_window": ["title"],
                    }

                    def _cleanup_step(s: dict) -> dict:
                        if "tool" not in s and "action" in s:
                            s["tool"] = s.pop("action")
                        if "description" not in s and "comment" in s:
                            s["description"] = s.pop("comment")
                        elif "description" not in s:
                            s["description"] = ""
                        if "args" not in s or s["args"] is None:
                            s["args"] = {}
                        elif isinstance(s["args"], list):
                            tool_name = s.get("tool", "")
                            arg_keys = TOOL_ARG_ORDER.get(tool_name, [])
                            s["args"] = {k: v for k, v in zip(arg_keys, s["args"])}
                        return s

                    if isinstance(data, list):
                        steps = [PlanStep(**_cleanup_step(s)) for s in data]
                        return Plan(goal="", steps=steps), None
                    elif isinstance(data, dict):
                        if "steps" in data:
                            data["steps"] = [_cleanup_step(s) for s in data["steps"]]
                            return Plan(**data), None
                        else:
                            step = PlanStep(**_cleanup_step(data))
                            return Plan(goal="", steps=[step]), None
                except Exception as e:
                    import structlog
                    structlog.get_logger().error("Plan JSON parsed but validation failed", error=str(e))
            return None, raw_output

        return None, str(raw_output)

    async def _execute_step(self, step: PlanStep, index: int) -> ToolResult:
        from tools.registry import get
        tool = get(step.tool)
        if tool is None:
            err_res = ToolResult(success=False, error=f"Unknown tool: {step.tool}", retryable=False)
            await self.ws.send_message("tool_error", {"index": index, "error": err_res.error})
            if index < len(self.cumulative_steps):
                self.cumulative_steps[index]["status"] = "error"
                self.cumulative_steps[index]["error"] = err_res.error
            return err_res

        await self.ws.send_message("tool_action", {
            "tool": step.tool,
            "description": step.description,
            "status": "running",
            "result": None
        })
        await self.ws.send_message("tool_started", {"index": index})
        if index < len(self.cumulative_steps):
            self.cumulative_steps[index]["status"] = "running"

        # Wrap tool execution in a cancellable Task
        self._tool_task = asyncio.ensure_future(
            tool.safe_execute(step.args, permission_manager=self.ws)
        )
        try:
            res = await self._tool_task
        except asyncio.CancelledError:
            res = ToolResult(success=False, error="Cancelled by user", retryable=False)
        finally:
            self._tool_task = None

        await self.ws.send_message("tool_action", {
            "tool": step.tool,
            "description": step.description,
            "status": "success" if res.success else "error",
            "result": res.observation if res.success else res.error
        })

        if res.success:
            await self.ws.send_message("tool_completed", {"index": index, "result": res.observation})
            if index < len(self.cumulative_steps):
                self.cumulative_steps[index]["status"] = "success"
                self.cumulative_steps[index]["result"] = res.observation
        else:
            await self.ws.send_message("tool_error", {"index": index, "error": res.error or "Unknown error"})
            if index < len(self.cumulative_steps):
                self.cumulative_steps[index]["status"] = "error"
                self.cumulative_steps[index]["error"] = res.error or "Unknown error"

        if getattr(self, "logger", None):
            self.logger.log_tool_call(
                attempt=getattr(self.state, "retry_count", 0),
                step_index=index,
                tool_name=step.tool,
                args=step.args,
                result_status="success" if res.success else "error",
                result_obs=res.observation if res.success else res.error
            )

        return res

    async def _verify_postcondition(self, verify_with: str) -> bool:
        from sync_primitives import wait_for_text_visible, wait_for_window, TimeoutError
        try:
            if "window" in verify_with.lower() or "app" in verify_with.lower():
                title = verify_with.split()[-1]
                await wait_for_window(title, timeout=5.0)
                return True
            else:
                await wait_for_text_visible(verify_with, timeout=5.0, observer=self.observer)
                return True
        except TimeoutError:
            return False
        except Exception:
            return False
