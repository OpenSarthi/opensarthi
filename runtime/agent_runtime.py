import asyncio
import time
import json
from typing import Optional, Any
from pydantic_ai import Agent
from state_machine import AgentState, AgentStateContext
from planner.schemas import Plan, PlanStep, ToolResult
from observation import DesktopObserver, DesktopSnapshot
from dev_logger import DevLogger
from agents.healer import HealerAgent
from agents.reviewer import ReviewerAgent
from agents.behavioral_observer import BehavioralObserver

class TaskUsage:
    def __init__(self, request_tokens=0, response_tokens=0, total_tokens=0):
        self.request_tokens = request_tokens
        self.response_tokens = response_tokens
        self.total_tokens = total_tokens

class WSWrapper:
    def __init__(self, ws_handler, thread_id):
        self._ws = ws_handler
        self._thread_id = thread_id

    async def send_message(self, msg_type: str, payload: dict, thread_id: str = None):
        tid = thread_id or self._thread_id
        await self._ws.send_message(msg_type, payload, thread_id=tid)

    async def request_permission(self, tool_name: str, args: dict) -> bool:
        return await self._ws.request_permission(tool_name, args, thread_id=self._thread_id)

    async def request_user_input(self, prompt: str, input_type: str = "text") -> str:
        return await self._ws.request_user_input(prompt, input_type, thread_id=self._thread_id)

    def __getattr__(self, name):
        return getattr(self._ws, name)

class AgentRuntime:
    """
    The stateful execution engine for OpenSarthi.
    Supports immediate cancellation of both LLM inference and tool execution.
    Includes: self-healing (HealerAgent), self-improvement (ReviewerAgent),
    behavioral preference learning (BehavioralObserver), and parallel step execution.
    """

    def __init__(self, ws_handler, agent: Agent, observer: DesktopObserver, deps=None, memory_manager=None, thread_id: str = None):
        self.ws = WSWrapper(ws_handler, thread_id) if thread_id else ws_handler
        self.agent = agent
        self.observer = observer
        self.deps = deps
        self.memory = memory_manager
        self.thread_id = thread_id
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
        # Self-healing / self-improving sub-agents (lazy-init on first task)
        self._healer: Optional[HealerAgent] = None
        self._reviewer: Optional[ReviewerAgent] = None
        self._observer_agent: Optional[BehavioralObserver] = None
        self._gui_lock = asyncio.Lock()

    def _get_healer(self, model) -> HealerAgent:
        if self._healer is None:
            self._healer = HealerAgent(model, self.deps)
        return self._healer

    def _get_reviewer(self, model) -> ReviewerAgent:
        if self._reviewer is None:
            self._reviewer = ReviewerAgent(model, self.deps)
        return self._reviewer

    def _get_observer_agent(self, model) -> BehavioralObserver:
        if self._observer_agent is None:
            self._observer_agent = BehavioralObserver(model, self.deps)
        return self._observer_agent

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
        """Sleep that aborts early if cancel is requested."""
        try:
            await asyncio.sleep(seconds)
        except asyncio.CancelledError:
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
        self.run_request_tokens = 0
        self.run_response_tokens = 0
        self.run_total_tokens = 0
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
                auto_recalled = []
                if self.memory:
                    recalled = await self.memory.recall(goal, top_k=3)
                    # Auto-inject: broader semantic recall (goal + recent context)
                    try:
                        auto_recalled = await self.memory.recall(goal, top_k=5)
                        # Also always fetch high-priority behavioral preferences
                        pref_results = await self.memory.long.search("[PREFERENCE]", top_k=8)
                        # Merge, deduplicate by content
                        seen = {m.content for m in auto_recalled}
                        for m in pref_results:
                            if m.content not in seen:
                                auto_recalled.append(m)
                                seen.add(m.content)
                    except Exception:
                        pass

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
                    auto_recalled_memories=auto_recalled if auto_recalled else None,
                )

                if getattr(self, "logger", None):
                    self.logger.log_planning_context(replanning_attempts, context)

                try:
                    result = await self._agent_run(context, deps=self.deps, model=model, message_history=message_history)
                    if getattr(self, "logger", None):
                        self.logger.log_llm_response(replanning_attempts, result.output)
                    if result and getattr(result, "usage", None):
                        usage = result.usage
                        self.run_request_tokens += (getattr(usage, "request_tokens", 0) or 0)
                        self.run_response_tokens += (getattr(usage, "response_tokens", 0) or 0)
                        self.run_total_tokens += (getattr(usage, "total_tokens", 0) or 0)
                        await self.ws.accumulate_and_update_tokens(result.usage, thread_id=self.thread_id)
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
                        # Fire behavioral observer after every successful response
                        if message_history:
                            asyncio.create_task(
                                self._get_observer_agent(model).observe_and_store(
                                    recent_messages=message_history,
                                    memory_manager=self.memory,
                                )
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
                        "wait_after": s.wait_after,
                        "depends_on": getattr(s, "depends_on", []) or []
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

                from planner.decomposer import get_parallel_groups
                groups = get_parallel_groups(plan.steps)

                plan_failed = False
                last_step_idx = start_idx

                async def execute_single_step(local_idx: int) -> bool:
                    nonlocal plan_failed, last_step_idx
                    i = start_idx + local_idx
                    last_step_idx = max(last_step_idx, i)
                    step_data = self.cumulative_steps[i]
                    tool_name = step_data.get("tool", "")
                    
                    is_gui = tool_name in {
                        "click", "type_text", "press_key", "click_element",
                        "focus_window", "observe_desktop", "wait_for_window",
                        "wait_for_text", "open_app"
                    }

                    async def run_step_logic():
                        nonlocal plan_failed
                        from planner.schemas import PlanStep as PS
                        step = PS(
                            tool=step_data["tool"],
                            args=step_data["args"],
                            description=step_data["description"],
                            verify_with=step_data["verify_with"],
                            wait_after=step_data["wait_after"],
                            depends_on=step_data.get("depends_on", [])
                        )

                        await self._transition(
                            AgentState.EXECUTING,
                            current_step_index=i,
                            current_step_description=step.description,
                            retry_count=0
                        )

                        step_success = False
                        retry_count = 0
                        max_retries = self.state.max_retries
                        
                        while retry_count <= max_retries:
                            await self._check_pause()
                            if self._cancel_requested or plan_failed:
                                break

                            result = await self._execute_step(step, i)

                            if self._cancel_requested or plan_failed:
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
                                tool_key = step.tool
                                err_msg = (result.error or "").strip()[:200]
                                if self._last_tool_error.get(tool_key) == err_msg:
                                    self._same_tool_fail_count[tool_key] = self._same_tool_fail_count.get(tool_key, 1) + 1
                                else:
                                    self._same_tool_fail_count[tool_key] = 1
                                    self._last_tool_error[tool_key] = err_msg

                                if self._same_tool_fail_count.get(tool_key, 0) >= 2:
                                    import structlog
                                    structlog.get_logger().warning(
                                        "Fail-fast triggered: same tool failed with same error twice",
                                        tool=tool_key, error=err_msg
                                    )
                                    break

                                # ── Self-Heal: try fixing the step before retrying ──
                                if retry_count == 0 and err_msg:
                                    try:
                                        await self.ws.send_message("tool_action", {
                                            "tool": "self_heal",
                                            "description": f"Self-healing diagnosis: {step.description}",
                                            "status": "running",
                                            "result": None
                                        })
                                        snap = await self.observer.snapshot()
                                        screen_text = getattr(snap, "screen_text_summary", "") or ""
                                        healer = self._get_healer(model)
                                        healed = await healer.diagnose_and_fix(
                                            failed_tool=step.tool,
                                            failed_args=step.args or {},
                                            description=step.description or step.tool,
                                            error=err_msg,
                                            screen_summary=screen_text,
                                        )
                                        if healed:
                                            from planner.schemas import PlanStep as PS
                                            healed_step = PS(
                                                tool=healed["tool"],
                                                args=healed.get("args", {}),
                                                description=healed.get("description", f"[HEALED] {step.description}"),
                                            )
                                            result = await self._execute_step(healed_step, i)
                                            
                                            # Broadcast the outcome of the healer diagnosis
                                            await self.ws.send_message("tool_action", {
                                                "tool": "self_heal",
                                                "description": f"Self-healing diagnosis: {step.description}",
                                                "status": "success" if result.success else "error",
                                                "result": f"Executed correction: {healed_step.description}" if result.success else f"Correction failed: {result.error}"
                                            })

                                            # Record heal metadata on the existing step (no append = no index drift)
                                            if i < len(self.cumulative_steps):
                                                self.cumulative_steps[i]["heal_applied"] = {
                                                    "tool": healed_step.tool,
                                                    "description": healed_step.description,
                                                    "status": "success" if result.success else "error",
                                                }

                                            if result.success:
                                                step_success = True
                                                if i < len(self.cumulative_steps):
                                                    self.cumulative_steps[i]["description"] = f"[HEALED] {step.description} → {healed_step.description}"
                                                completed_actions.append(healed_step.description)
                                                break
                                        else:
                                            await self.ws.send_message("tool_action", {
                                                "tool": "self_heal",
                                                "description": f"Self-healing diagnosis: {step.description}",
                                                "status": "error",
                                                "result": "No self-healing path identified."
                                            })
                                    except Exception as heal_err:
                                        import structlog
                                        structlog.get_logger().debug("Healer exception", error=str(heal_err))
                                        await self.ws.send_message("tool_action", {
                                            "tool": "self_heal",
                                            "description": f"Self-healing diagnosis: {step.description}",
                                            "status": "error",
                                            "result": f"Diagnosis failed: {heal_err}"
                                        })

                                if result.retryable and retry_count < max_retries:
                                    retry_count += 1
                                    await self._transition(
                                        AgentState.RETRYING,
                                        current_step_description=f"Retrying: {step.description} ({retry_count}/{max_retries})"
                                    )
                                    await self._cancellable_sleep(1.5)
                                    if self._cancel_requested or plan_failed:
                                        break
                                else:
                                    break

                        if self._cancel_requested or plan_failed:
                            await self.ws.send_message("tool_terminated", {"index": i})
                            if i < len(self.cumulative_steps):
                                self.cumulative_steps[i]["status"] = "terminated"
                            return False

                        if step_success:
                            completed_actions.append(step.description or f"Executed tool: {step.tool}")
                            if step.wait_after:
                                await self._transition(AgentState.WAITING)
                                await asyncio.sleep(step.wait_after)
                            return True
                        else:
                            failed_actions.append(f"{step.description or step.tool} (Reason: {result.error})")
                            plan_failed = True
                            return False

                    if is_gui:
                        async with self._gui_lock:
                            return await run_step_logic()
                    else:
                        return await run_step_logic()

                for group in groups:
                    if plan_failed or self._cancel_requested:
                        break
                    
                    tasks = [execute_single_step(idx) for idx in group]
                    results = await asyncio.gather(*tasks)
                    if not all(results):
                        plan_failed = True
                        break

                # Terminate any remaining steps if failed
                if plan_failed or self._cancel_requested:
                    for remain_idx in range(start_idx, end_idx):
                        if remain_idx < len(self.cumulative_steps) and self.cumulative_steps[remain_idx]["status"] in ("pending", "running"):
                            self.cumulative_steps[remain_idx]["status"] = "terminated"
                            await self.ws.send_message("tool_terminated", {"index": remain_idx})

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
                # ── Fire-and-forget: learn from this successful execution ──
                if self.memory and completed_actions:
                    asyncio.create_task(
                        self._get_reviewer(model).review_and_learn(
                            goal=goal,
                            execution_log=self.cumulative_steps,
                            outcome="SUCCESS",
                            memory_manager=self.memory,
                        )
                    )
                    if message_history:
                        asyncio.create_task(
                            self._get_observer_agent(model).observe_and_store(
                                recent_messages=message_history,
                                memory_manager=self.memory,
                            )
                        )
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
                    usage = result.usage
                    self.run_request_tokens += (getattr(usage, "request_tokens", 0) or 0)
                    self.run_response_tokens += (getattr(usage, "response_tokens", 0) or 0)
                    self.run_total_tokens += (getattr(usage, "total_tokens", 0) or 0)
                    await self.ws.accumulate_and_update_tokens(result.usage, thread_id=self.thread_id)
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
                # Fire-and-forget: reviewer + behavioral observer on failure too
                asyncio.create_task(
                    self._get_reviewer(model).review_and_learn(
                        goal=goal,
                        execution_log=self.cumulative_steps,
                        outcome=f"FAILED: {response[:100]}",
                        memory_manager=self.memory,
                    )
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
            self.last_usage = TaskUsage(self.run_request_tokens, self.run_response_tokens, self.run_total_tokens)
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
        await self.ws.emit_state(self.state, thread_id=self.thread_id)

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
            await self.ws.send_message("tool_error", {
                "index": index,
                "error": err_res.error,
                "tool": step.tool,
                "description": step.description,
                "args": step.args
            })
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
        await self.ws.send_message("tool_started", {
            "index": index,
            "tool": step.tool,
            "description": step.description,
            "args": step.args
        })
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
            await self.ws.send_message("tool_completed", {
                "index": index,
                "result": res.observation,
                "tool": step.tool,
                "description": step.description,
                "args": step.args
            })
            if index < len(self.cumulative_steps):
                self.cumulative_steps[index]["status"] = "success"
                self.cumulative_steps[index]["result"] = res.observation
        else:
            await self.ws.send_message("tool_error", {
                "index": index,
                "error": res.error or "Unknown error",
                "tool": step.tool,
                "description": step.description,
                "args": step.args
            })
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
