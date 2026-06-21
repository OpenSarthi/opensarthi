import asyncio
import uuid
import structlog
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from typing import Any

from planner.agent import agent, AgentDependencies
import os
if os.environ.get("OPENSARTHI_PLATFORM") == "android":
    from voice.android_bridge import AndroidVoicePipeline as VoicePipeline
else:
    from voice.pipeline import VoicePipeline

logger = structlog.get_logger()
router = APIRouter()

class Session:
    def __init__(self, websocket: WebSocket):
        self.ws = websocket
        self.session_id = str(uuid.uuid4())
        self.voice_pipeline = VoicePipeline()
        loop = asyncio.get_event_loop()
        self.voice_pipeline.on_voice_state = lambda state: asyncio.run_coroutine_threadsafe(
            self.send_message("voice_state", {"state": state}),
            loop
        )
        async def log_action_cb(tool: str, description: str, status: str, result: Any = None):
            await self.send_message("tool_action", {
                "tool": tool,
                "description": description,
                "status": status,
                "result": result
            })

        self.deps = AgentDependencies(
            log_action=log_action_cb,
            skills=list(getattr(__import__('config').settings, 'user_skills', ['general', 'desktop_automation'])),
            user_name=getattr(__import__('config').settings, 'user_name', ''),
            custom_prompt=getattr(__import__('config').settings, 'custom_prompt', ''),
        )
        import db
        self.thread_id = db.create_thread()
        self._active_runtimes = {}
        self._message_tasks = {}
        self._orchestrators = {}
        # Separate futures for permission vs text input to avoid collision
        self._pending_permissions: dict = {}  # thread_id -> asyncio.Future
        self._pending_inputs: dict = {}       # thread_id -> asyncio.Future
        self._manual_tts = False  # True when user manually triggered TTS via listen button
        self._session_active = False  # True after onboarding complete + API key confirmed
        self._permanent_grants: set[str] = set()

    async def send_message(self, msg_type: str, payload: dict, thread_id: str = None):
        if payload is None:
            payload = {}
        tid = thread_id or payload.get("thread_id")
        if not tid and hasattr(self, 'thread_id'):
            tid = self.thread_id
        if tid:
            payload["thread_id"] = tid

        msg = {
            "id": str(uuid.uuid4()),
            "type": msg_type,
            "payload": payload,
            "timestamp": int(asyncio.get_event_loop().time() * 1000)
        }
        try:
            await self.ws.send_json(msg)
        except Exception as e:
            logger.warning("Failed to send websocket message (client probably disconnected)", error=str(e), msg_type=msg_type)

    async def accumulate_and_update_tokens(self, usage, thread_id: str = None):
        if not usage:
            return
        tid = thread_id or getattr(self, 'thread_id', None)
        if not tid:
            return
        try:
            request_tokens = getattr(usage, "request_tokens", 0) or 0
            response_tokens = getattr(usage, "response_tokens", 0) or 0
            total_tokens = getattr(usage, "total_tokens", 0) or (request_tokens + response_tokens)
        except Exception:
            request_tokens = 0
            response_tokens = 0
            total_tokens = 0

        if total_tokens > 0:
            import db
            db.accumulate_thread_tokens(tid, request_tokens, response_tokens, total_tokens)
            totals = db.get_thread_tokens(tid)
            await self.send_message("token_update", {
                "request_tokens": totals.get("request_tokens", 0),
                "response_tokens": totals.get("response_tokens", 0),
                "total_tokens": totals.get("total_tokens", 0),
                "delta_total_tokens": total_tokens
            }, thread_id=tid)

    async def request_permission(self, tool_name: str, args: dict, thread_id: str = None) -> bool:
        """Ask user for permission to execute a dangerous tool, yielding control back on response."""
        from state_machine import AgentState
        import json

        # Check permanent grants cache using sorted JSON string
        grant_key = f"{tool_name}:{json.dumps(args or {}, sort_keys=True)}"
        if grant_key in self._permanent_grants:
            logger.info("Permission automatically granted via permanent grant cache", tool=tool_name)
            return True

        tid = thread_id or self.thread_id
        self._pending_permissions[tid] = asyncio.Future()
        try:
            req_id = str(uuid.uuid4())
            await self.send_message("permission_request", {
                "request_id": req_id,
                "tool": tool_name,
                "args": args,
                "risk_level": "dangerous",
                "description": f"Execute dangerous action: {tool_name} with arguments {args}?",
                "timeout_seconds": 30
            }, thread_id=tid)
            if hasattr(self, '_current_runtime') and self._current_runtime:
                await self._current_runtime._transition(AgentState.ASKING_PERMISSION)

            response = await self._pending_permissions[tid]
            allowed = response.get("allow", response.get("approved", False))
            
            # Save to permanent grants if user specified remember/allow always
            if allowed and response.get("remember", False):
                self._permanent_grants.add(grant_key)
                logger.info("Saved permanent grant for tool execution", tool=tool_name)
            
            return allowed
        finally:
            self._pending_permissions.pop(tid, None)

    async def request_user_input(self, prompt: str, input_type: str = "text", thread_id: str = None) -> str:
        """Ask user for arbitrary text input (e.g. password for sudo), yielding control back on response."""
        from state_machine import AgentState
        tid = thread_id or self.thread_id
        self._pending_inputs[tid] = asyncio.Future()
        try:
            await self.send_message("input_request", {
                "prompt": prompt,
                "input_type": input_type
            }, thread_id=tid)
            if hasattr(self, '_current_runtime') and self._current_runtime:
                await self._current_runtime._transition(AgentState.ASKING_PERMISSION)

            response = await self._pending_inputs[tid]
            return response.get("value", "")
        finally:
            self._pending_inputs.pop(tid, None)

    async def emit_state(self, state_ctx, thread_id: str = None):
        """Broadcast current agent state to the frontend UI."""
        await self.send_message("agent_state", state_ctx.to_dict(), thread_id=thread_id)

    async def stream_text(self, text: str, thread_id: str = None, chunk_size: int = 3):
        """
        Stream a text response word-by-word to the frontend.
        Sends 'stream_chunk' events followed by 'stream_end'.
        Used by chat_node and the LangGraph path to power the typing animation.
        """
        tid = thread_id or self.thread_id
        words = text.split(" ")
        total_words = len(words)
        if total_words == 0:
            await self.send_message("stream_end", {}, thread_id=tid)
            return

        # Target: Complete execution within at most 5 seconds (~100 ticks max)
        max_chunks = 100
        remaining_words = total_words
        tick = 0
        i = 0
        
        while i < total_words:
            remaining_ticks = max(1, max_chunks - tick)
            target_chunk = (remaining_words + remaining_ticks - 1) // remaining_ticks
            
            # Start small (word-by-word / 2-3 words) to immediately show typing, then accelerate
            if tick < 10:
                chunk_len = min(2 + tick, target_chunk)
            else:
                chunk_len = target_chunk
                
            chunk_len = max(1, chunk_len)
            chunk_words = words[i:i+chunk_len]
            i += chunk_len
            remaining_words -= chunk_len
            
            await self.send_message("stream_chunk", {
                "chunk": " ".join(chunk_words) + (" " if i < total_words else ""),
            }, thread_id=tid)
            
            tick += 1
            sleep_time = 0.03 if tick < 15 else 0.015
            await asyncio.sleep(sleep_time)
            
        await self.send_message("stream_end", {}, thread_id=tid)


    async def speak(self, text: str, manual: bool = False):
        """Play speech and broadcast speech status events to the client."""
        try:
            self._manual_tts = manual
            await self.send_message("speech_started", {})
            await self.voice_pipeline.speak(text)
        finally:
            await self.send_message("speech_completed", {"was_manual": manual})
            # Auto-listen resumes only if this was an agent-triggered TTS, not manual
            if manual:
                self._manual_tts = False
            else:
                from config import settings
                if getattr(settings, "continuous_listening", False):
                    self.start_listen_loop()

    async def handle_json_plan(self, steps: list, goal: str):
        """Execute a pre-built JSON plan directly (JSON import feature)."""
        try:
            import db, time, uuid
            msg_id = str(uuid.uuid4())
            timestamp = int(time.time() * 1000)
            db.save_message(self.thread_id, msg_id, "user", f"[JSON Plan] {goal}", timestamp)

            # Send initial assistant response bubble immediately so the user has immediate feedback in the chat
            ast_init_id = str(uuid.uuid4())
            ast_init_ts = int(time.time() * 1000)
            init_message = f"I am running the custom task plan for: **{goal}**.\nYou can see the live execution steps in the activity panel on the right."
            db.save_message(self.thread_id, ast_init_id, "assistant", init_message, ast_init_ts)
            await self.send_message("assistant_response", {
                "id": ast_init_id,
                "role": "assistant",
                "content": init_message,
                "timestamp": ast_init_ts,
                "is_voice": False,
                "usage": {"request_tokens": 0, "response_tokens": 0, "total_tokens": 0}
            })

            from agent_runtime import AgentRuntime
            from observation import DesktopObserver
            from planner.agent import agent
            from memory import MemoryManager

            memory_manager = MemoryManager(self.thread_id)
            runtime = AgentRuntime(
                ws_handler=self,
                agent=agent,
                observer=DesktopObserver(),
                deps=self.deps,
                memory_manager=memory_manager
            )
            self._current_runtime = runtime

            try:
                final_output = await runtime.run_plan_directly(steps, goal)
            except asyncio.CancelledError:
                final_output = "Execution cancelled by user."
                logger.info("JSON plan execution task was cancelled by user.")

            ast_id = str(uuid.uuid4())
            ast_ts = int(time.time() * 1000)
            db.save_message(self.thread_id, ast_id, "assistant", final_output, ast_ts)
            db.accumulate_thread_tokens(self.thread_id, 0, 0, 0)

            await self.send_message("assistant_response", {
                "id": ast_id,
                "role": "assistant",
                "content": final_output,
                "timestamp": ast_ts,
                "is_voice": False,
                "usage": {"request_tokens": 0, "response_tokens": 0, "total_tokens": 0}
            })
        except Exception as e:
            logger.error("JSON plan execution failed", error=str(e))
            await self.send_message("error", {"error": str(e)})


    async def handle_user_message(self, text: str, source: str = "text", thread_id: str = None):
        tid = thread_id or self.thread_id
        logger.info("Processing user message", text=text, source=source, thread_id=tid)
        try:
            self.stop_listen_loop()
            import db, time, os
            msg_id = str(uuid.uuid4())
            timestamp = int(time.time() * 1000)
            db.save_message(tid, msg_id, "user", text, timestamp)

            from config import settings, get_active_api_key
            # Refresh deps with current settings at run-time
            self.deps.skills = list(getattr(settings, 'user_skills', ['general', 'desktop_automation']))
            self.deps.user_name = getattr(settings, 'user_name', '')
            self.deps.custom_prompt = getattr(settings, 'custom_prompt', '')
            provider = settings.ai_provider.lower()
            model_name = settings.local_model if provider == "ollama" else settings.cloud_model
            api_key = get_active_api_key()

            # Guard: require API key before processing any message
            if not api_key and provider != "ollama":
                error_msg = "⚠️ No API key configured. Please add an API key in Settings before using the assistant."
                err_id = str(uuid.uuid4())
                err_ts = int(time.time() * 1000)
                db.save_message(tid, err_id, "assistant", error_msg, err_ts)
                await self.send_message("assistant_response", {
                    "id": err_id, "role": "assistant", "content": error_msg,
                    "timestamp": err_ts, "is_voice": False,
                    "usage": {"request_tokens": 0, "response_tokens": 0, "total_tokens": 0}
                }, thread_id=tid)
                return

            from llm import build_model
            active_model = build_model(provider, model_name, api_key)

            from pydantic_ai.messages import ModelRequest, ModelResponse, UserPromptPart, TextPart

            # Fetch message history for this thread
            history_messages = db.get_history(tid)

            # Trim to last 20 messages (skip the current prompt which is last)
            MAX_HISTORY = 20
            trimmed_history = history_messages[:-1]
            if len(trimmed_history) > MAX_HISTORY:
                trimmed_history = trimmed_history[-MAX_HISTORY:]

            message_history = []
            for msg in trimmed_history:
                if msg["role"] == "user":
                    message_history.append(ModelRequest(parts=[UserPromptPart(content=msg["content"])]))
                elif msg["role"] == "assistant":
                    message_history.append(ModelResponse(parts=[TextPart(content=msg["content"])]))

            # Route through orchestrator for classification + context summarization
            if tid not in self._orchestrators:
                from agents import OrchestratorAgent
                self._orchestrators[tid] = OrchestratorAgent(
                    ws_handler=self, model=active_model, deps=self.deps
                )
            orchestrator = self._orchestrators[tid]

            from observation import DesktopObserver
            observer = DesktopObserver()
            classification, summarized_context, class_usage, sum_usage = await orchestrator.route(
                goal=text,
                message_history=history_messages,
                observer=observer,
            )
            # Accumulate orchestrator token usages
            await self.accumulate_and_update_tokens(class_usage, thread_id=tid)
            await self.accumulate_and_update_tokens(sum_usage, thread_id=tid)

            # Notify the frontend of the classification
            await self.send_message("intent_classified", {"classification": classification}, thread_id=tid)

            prefix_warning = ""
            usage = None
            final_output = ""

            if classification in ("CHAT", "CLARIFY"):
                logger.info("Routing to direct CHAT/CLARIFY handler", thread_id=tid)
                if tid in self._active_runtimes:
                    self._active_runtimes.pop(tid, None)
                from pydantic_ai import Agent as PydanticAgent
                from planner.agent import build_system_prompt
                from dev_logger import DevLogger

                # Retrieve memories for chat context
                memories_list = []
                try:
                    from memory import MemoryManager
                    memory_manager = MemoryManager(tid)
                    auto_recalled = await memory_manager.recall(text, top_k=5)
                    pref_results = await memory_manager.long.search("[PREFERENCE]", top_k=8)
                    seen = {m.content for m in auto_recalled}
                    for m in pref_results:
                        if m.content not in seen:
                            auto_recalled.append(m)
                            seen.add(m.content)
                    memories_list = [m.content for m in auto_recalled]
                except Exception as e:
                    logger.warning("Failed to fetch memories for chat routing", error=str(e))

                # Build system prompt utilizing user's customizations (name, skills, custom instructions) and memories
                sys_prompt = build_system_prompt(
                    skills=self.deps.skills,
                    user_name=self.deps.user_name,
                    custom_prompt=self.deps.custom_prompt,
                    chat_only=True,
                    memories=memories_list
                )

                # Log conversational run context/prompt
                chat_logger = DevLogger(goal=text, model_name=model_name, provider=provider)
                chat_logger.log_system_prompt(sys_prompt)
                
                history_str = ""
                if message_history:
                    history_str = "━━━ CONVERSATION HISTORY CONTEXT ━━━\n"
                    for h_msg in message_history:
                        parts_str = " ".join([str(getattr(p, 'content', '')) for p in getattr(h_msg, 'parts', [])])
                        role = "user" if h_msg.__class__.__name__ == 'ModelRequest' else "assistant"
                        history_str += f"[{role.upper()}]: {parts_str}\n"
                    history_str += "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n"
                
                chat_logger.log_planning_context(0, f"{history_str}CHAT REQUEST:\n{text}")

                chat_agent = PydanticAgent(
                    model=active_model,
                    system_prompt=sys_prompt
                )
                try:
                    result = await chat_agent.run(text, message_history=message_history)
                    final_output = result.output
                    usage = result.usage
                    # Accumulate chat tokens
                    await self.accumulate_and_update_tokens(usage, thread_id=tid)
                    chat_logger.log_llm_response(0, final_output)
                    chat_logger.finalize(final_output)
                    # ── Word-by-word streaming to frontend (typing animation) ──
                    await self.stream_text(final_output, thread_id=tid)
                except Exception as e:
                    logger.error("Direct chat generation failed", error=str(e), thread_id=tid)
                    chat_logger.log(f"CHAT ERROR: {str(e)}")
                    chat_logger.finalize(f"ERROR: {str(e)}")
                    raise e
            else:
                logger.info("Routing to TASK planner", thread_id=tid)
                from memory import MemoryManager
                memory_manager = MemoryManager(tid)

                import os as _os
                use_langgraph = _os.environ.get("USE_LANGGRAPH", "true").lower() in ("1", "true", "yes")

                if use_langgraph:
                    # ── LangGraph path ──────────────────────────────────────────
                    logger.info("Using LangGraph orchestration", thread_id=tid)
                    from graph.graph import run_graph
                    manager.sync_notification_state()
                    try:
                        final_output = await run_graph(
                            goal=text,
                            model=active_model,
                            deps=self.deps,
                            ws_handler=self,
                            memory_manager=memory_manager,
                            thread_id=tid,
                            message_history=message_history,
                            summarized_context=summarized_context,
                        )
                        usage = None  # tokens accumulated via ws.accumulate_and_update_tokens inside nodes
                    except asyncio.CancelledError:
                        final_output = "Execution cancelled by user."
                        usage = None
                    except Exception as e:
                        logger.error("LangGraph execution failed", error=str(e), thread_id=tid)
                        raise e
                else:
                    # ── Legacy AgentRuntime path ────────────────────────────────
                    from agent_runtime import AgentRuntime
                    runtime = AgentRuntime(
                        ws_handler=self,
                        agent=agent,
                        observer=observer,
                        deps=self.deps,
                        memory_manager=memory_manager,
                        thread_id=tid
                    )
                    self._active_runtimes[tid] = runtime
                    manager.sync_notification_state()
                    try:
                        final_output = await runtime.run(
                            goal=text,
                            model=active_model,
                            message_history=message_history,
                            summarized_context=summarized_context,
                        )
                        usage = runtime.last_usage
                    except asyncio.CancelledError:
                        final_output = "Execution cancelled by user."
                        usage = None
                        logger.info("Agent execution task was cancelled by user.", thread_id=tid)
                    except Exception as e:
                        logger.error("Agent execution failed", error=str(e), thread_id=tid)
                        raise e
                    finally:
                        self._active_runtimes.pop(tid, None)
                        manager.sync_notification_state()

            ast_msg_id = str(uuid.uuid4())
            ast_timestamp = int(time.time() * 1000)
            req_t = usage.request_tokens if usage else 0
            res_t = usage.response_tokens if usage else 0
            tot_t = usage.total_tokens if usage else 0
            db.save_message(tid, ast_msg_id, "assistant", final_output, ast_timestamp,
                            request_tokens=req_t, response_tokens=res_t, total_tokens=tot_t)

            # Send the assistant's response back to the UI
            await self.send_message("assistant_response", {
                "id": ast_msg_id,
                "role": "assistant",
                "content": final_output,
                "timestamp": ast_timestamp,
                "is_voice": source == "voice",
                "usage": {
                    "request_tokens": req_t,
                    "response_tokens": res_t,
                    "total_tokens": tot_t,
                }
            }, thread_id=tid)

            # Fire-and-forget fact extraction
            try:
                from memory.passive import extract_and_store_facts
                asyncio.ensure_future(
                    extract_and_store_facts(
                        user_input=text,
                        assistant_response=final_output,
                        model=active_model,
                        thread_id=tid,
                    )
                )
            except Exception:
                pass

        except Exception as e:
            logger.error("Agent execution failed", error=str(e), thread_id=tid)
            await self.send_message("error", {"error": str(e)}, thread_id=tid)
        finally:
            if getattr(self, "_session_active", False):
                import os
                if os.environ.get("OPENSARTHI_PLATFORM") != "android":
                    self.start_listen_loop()


    async def process_incoming(self, data: dict):
        msg_type = data.get("type")
        payload = data.get("payload", {})

        if msg_type == "client_state":
            page = payload.get("page")
            logger.info("Received client page state update", page=page)
            if page == "onboarding":
                self._session_active = False
                self.stop_listen_loop()
            elif page == "assistant":
                self._session_active = True
                import os
                if os.environ.get("OPENSARTHI_PLATFORM") != "android":
                    self.start_listen_loop()
        elif msg_type == "run_json_plan":
            steps = payload.get("steps", [])
            goal = payload.get("goal", "Custom JSON Task")
            self._message_task = asyncio.create_task(self.handle_json_plan(steps, goal))
        elif msg_type == "user_message":
            thread_id = payload.get("thread_id") or self.thread_id
            task = asyncio.create_task(
                self.handle_user_message(payload.get("text", ""), source=payload.get("source", "text"), thread_id=thread_id)
            )
            self._message_tasks[thread_id] = task
        elif msg_type == "session_state":
            pass # Keep mic listening for continuous wake word
        elif msg_type == "voice_state":
            state = payload.get("state")
            if state == "listening":
                logger.info("[WebSocket] Manual voice listening triggered by user. Bypassing wake word.")
                if hasattr(self.voice_pipeline, 'is_recording_command'):
                    # Desktop pipeline — arm the speech buffer
                    import time
                    self.voice_pipeline.is_recording_command = True
                    self.voice_pipeline._speech_buffer = []
                    self.voice_pipeline.last_speech_time = time.time()
                    self.voice_pipeline.start_recording_time = time.time()
                else:
                    self.start_listen_loop()
                # On Android, SpeechRecognizer already runs continuously via Kotlin
                # Frontend handles mic-button state; just echo back to confirm
                await self.send_message("voice_state", {"state": "listening"})
            elif state == "idle":
                logger.info("[WebSocket] Manual voice listening stopped by user.")
                if hasattr(self.voice_pipeline, 'is_recording_command'):
                    self.voice_pipeline.is_recording_command = False
                else:
                    self.stop_listen_loop()
                await self.send_message("voice_state", {"state": "idle"})
        elif msg_type == "new_chat":
            import db
            old_tid = payload.get("old_thread_id") or self.thread_id
            new_tid = db.create_thread()
            self.thread_id = new_tid
            self._orchestrators.pop(old_tid, None)
            logger.info("Created new chat thread", thread_id=new_tid)
        elif msg_type == "cancel_execution":
            thread_id = payload.get("thread_id") or self.thread_id
            if thread_id in self._active_runtimes:
                self._active_runtimes[thread_id].request_cancel()
            if thread_id in self._message_tasks and not self._message_tasks[thread_id].done():
                self._message_tasks[thread_id].cancel()
            await self.send_message("agent_state", {
                "state": "idle",
                "goal": None,
                "step": 0,
                "step_description": None,
                "total_steps": 0,
                "retry_count": 0,
                "error": None
            }, thread_id=thread_id)
            manager.sync_notification_state()
        elif msg_type == "pause_execution":
            thread_id = payload.get("thread_id") or self.thread_id
            if thread_id in self._active_runtimes:
                self._active_runtimes[thread_id].pause()
                await self.send_message("task_paused", {}, thread_id=thread_id)
                logger.info("Task execution paused", thread_id=thread_id)
                manager.sync_notification_state()
        elif msg_type == "resume_execution":
            thread_id = payload.get("thread_id") or self.thread_id
            if thread_id in self._active_runtimes:
                self._active_runtimes[thread_id].resume()
                await self.send_message("task_resumed", {}, thread_id=thread_id)
                logger.info("Task execution resumed", thread_id=thread_id)
                manager.sync_notification_state()
        elif msg_type == "permission_response":
            tid = payload.get("thread_id") or self.thread_id
            if tid in self._pending_permissions and not self._pending_permissions[tid].done():
                self._pending_permissions[tid].set_result(payload)
        elif msg_type == "input_response":
            tid = payload.get("thread_id") or self.thread_id
            if tid in self._pending_inputs and not self._pending_inputs[tid].done():
                self._pending_inputs[tid].set_result(payload)
        elif msg_type == "get_history":
            import db
            threads = db.get_all_threads()
            await self.send_message("history_response", {"threads": threads})
        elif msg_type == "delete_thread":
            import db
            tid = payload.get("thread_id")
            if tid:
                db.delete_thread(tid)
                logger.info("Deleted thread", thread_id=tid)
                # Clean up all per-thread state to prevent memory leaks
                self._orchestrators.pop(tid, None)
                self._active_runtimes.pop(tid, None)
                self._message_tasks.pop(tid, None)
                self._pending_inputs.pop(tid, None)
                if self.thread_id == tid:
                    self.thread_id = db.create_thread()
                threads = db.get_all_threads()
                await self.send_message("history_response", {"threads": threads})
        elif msg_type == "delete_all_threads":
            import db
            db.delete_all_threads()
            logger.info("Deleted all threads")
            self.thread_id = db.create_thread()
            threads = db.get_all_threads()
            await self.send_message("history_response", {"threads": threads})
        elif msg_type == "speak_text":
            text = payload.get("text", "")
            is_manual = bool(payload.get("manual", True))
            if text:
                import re
                # Strip <think>...</think> blocks from the text before speaking
                clean_text = re.sub(r'<think>[\s\S]*?</think>', '', text)
                # Strip markdown elements so the voice engine reads cleanly
                clean_text = re.sub(r'```[\s\S]*?```', '', clean_text)
                clean_text = re.sub(r'`([^`]+)`', r'\1', clean_text)
                clean_text = re.sub(r'[*#_\-]', '', clean_text)
                # Strip raw JSON plan blocks
                clean_text = re.sub(r'\[\s*\{[\s\S]*?\}\s*\]', '', clean_text)
                clean_text = clean_text.strip()
                if clean_text:
                    logger.info(f"{'Manual' if is_manual else 'Automatic'} TTS triggered", text=clean_text[:80])
                    # Mark as manual/automatic — so voice pipeline behaves accordingly
                    asyncio.create_task(self.speak(clean_text, manual=is_manual))
        elif msg_type == "stop_speech":
            logger.info("Received request to stop speech synthesis")
            if hasattr(self, 'voice_pipeline') and self.voice_pipeline:
                self.voice_pipeline.stop_speaking()
            await self.send_message("speech_completed", {"was_manual": self._manual_tts})
            self._manual_tts = False
        elif msg_type == "load_thread":
            import db
            thread_id = payload.get("thread_id")
            self.thread_id = thread_id
            messages = db.get_history(thread_id)
            tokens = db.get_thread_tokens(thread_id)
            await self.send_message("thread_loaded", {
                "thread_id": thread_id,
                "messages": messages,
                "token_totals": tokens,
            })
        elif msg_type == "update_settings":
            from config import settings, save_settings_to_env
            import os
            settings.local_model = payload.get("local_model", settings.local_model)
            settings.cloud_model = payload.get("cloud_model", settings.cloud_model)
            settings.ai_provider = payload.get("ai_provider", settings.ai_provider)
            
            # Per-provider API key retention: only update if a non-empty value is provided
            def _update_key(field: str, env_var: str):
                new_val = payload.get(field)
                if new_val and new_val.strip():
                    setattr(settings, field, new_val.strip())
                    os.environ[env_var] = new_val.strip()
            
            _update_key("gemini_api_key", "GEMINI_API_KEY")
            _update_key("openai_api_key", "OPENAI_API_KEY")
            _update_key("anthropic_api_key", "ANTHROPIC_API_KEY")
            _update_key("groq_api_key", "GROQ_API_KEY")
            _update_key("openrouter_api_key", "OPENROUTER_API_KEY")
                
            settings.voice_accent = payload.get("voice_accent", settings.voice_accent)
            settings.voice_speed = float(payload.get("voice_speed", settings.voice_speed))
            settings.continuous_listening = bool(payload.get("continuous_listening", settings.continuous_listening))
            settings.active_theme = payload.get("active_theme", settings.active_theme)
            
            # Wake word settings
            raw_wake = payload.get("wake_words")
            if raw_wake is not None:
                if isinstance(raw_wake, str):
                    settings.wake_words = [w.strip() for w in raw_wake.split(",") if w.strip()]
                elif isinstance(raw_wake, list):
                    settings.wake_words = [str(w).strip() for w in raw_wake if str(w).strip()]
            
            settings.wake_word_enabled = bool(payload.get("wake_word_enabled", settings.wake_word_enabled))
            settings.wake_word_threshold = float(payload.get("wake_word_threshold", settings.wake_word_threshold))

            # Update personalization fields
            settings.user_name = payload.get("user_name", settings.user_name)
            raw_skills = payload.get("user_skills")
            if raw_skills is not None:
                if isinstance(raw_skills, list):
                    settings.user_skills = raw_skills
                elif isinstance(raw_skills, str):
                    import json as _json
                    try:
                        settings.user_skills = _json.loads(raw_skills)
                    except Exception:
                        settings.user_skills = [s.strip() for s in raw_skills.split(",") if s.strip()]
            settings.custom_prompt = payload.get("custom_prompt", settings.custom_prompt)

            save_settings_to_env(
                settings.local_model,
                settings.cloud_model,
                settings.ai_provider,
                settings.gemini_api_key,
                settings.openai_api_key,
                settings.anthropic_api_key,
                settings.groq_api_key,
                settings.openrouter_api_key,
                settings.voice_accent,
                settings.voice_speed,
                settings.continuous_listening,
                settings.active_theme,
                settings.wake_words,
                settings.wake_word_enabled,
                settings.wake_word_threshold,
                settings.user_name,
                settings.user_skills,
                settings.custom_prompt,
            )

            # Propagate to running voice pipeline
            if hasattr(self, 'voice_pipeline') and self.voice_pipeline:
                try:
                    if hasattr(self.voice_pipeline, 'wake_detector') and self.voice_pipeline.wake_detector:
                        self.voice_pipeline.wake_detector.update_phrases(settings.wake_words)
                        self.voice_pipeline.wake_detector.threshold = settings.wake_word_threshold
                except Exception as ve:
                    logger.warning("Failed to propagate wake word updates to pipeline", error=str(ve))

            logger.info("Settings updated", provider=settings.ai_provider, model=settings.cloud_model)
            if getattr(self, "_session_active", False):
                import os
                if os.environ.get("OPENSARTHI_PLATFORM") != "android":
                    self.start_listen_loop()

    def start_listen_loop(self):
        if getattr(self, "_listen_task", None) is None or self._listen_task.done():
            self._listen_task = asyncio.create_task(self._listen_loop())
            logger.info("Started voice listen loop task")

    def stop_listen_loop(self):
        if getattr(self, "_listen_task", None) is not None:
            self._listen_task.cancel()
            self._listen_task = None
        self.voice_pipeline.stop_listening()

    async def _listen_loop(self):
        """Simulate sending transcript updates."""
        try:
            async for transcript in self.voice_pipeline.start_listening():
                await self.send_message("transcript_update", {
                    "text": transcript,
                    "engine": "local",
                    "is_final": True
                })
        except asyncio.CancelledError:
            logger.info("Voice listen loop cancelled")
        except Exception as e:
            logger.error("Error in voice listen loop", error=str(e))

class ConnectionManager:
    def __init__(self):
        self.sessions: dict[WebSocket, Session] = {}

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        session = Session(websocket)
        self.sessions[websocket] = session
        logger.info("Client connected", session_id=session.session_id)
        
        # Eagerly pre-load voice models in the background to prevent lazy-loading lag spikes and websocket connection timeout
        async def init_task():
            try:
                await session.voice_pipeline.initialize()
            except Exception as e:
                logger.error("Failed to initialize voice pipeline models", error=str(e))
        asyncio.create_task(init_task())
        
        # Send current settings on startup
        from config import settings
        await session.send_message("settings_sync", {
            "local_model": settings.local_model,
            "cloud_model": settings.cloud_model,
            "ai_provider": settings.ai_provider,
            "gemini_api_key": settings.gemini_api_key or "",
            "openai_api_key": settings.openai_api_key or "",
            "anthropic_api_key": settings.anthropic_api_key or "",
            "groq_api_key": settings.groq_api_key or "",
            "openrouter_api_key": settings.openrouter_api_key or "",
            "voice_accent": settings.voice_accent,
            "voice_speed": settings.voice_speed,
            "continuous_listening": settings.continuous_listening,
            "active_theme": getattr(settings, "active_theme", "theme-red-black"),
            "wake_words": getattr(settings, "wake_words", ["hey sarthi", "hello sarthi"]),
            "wake_word_enabled": getattr(settings, "wake_word_enabled", True),
            "wake_word_threshold": getattr(settings, "wake_word_threshold", 0.5),
            "user_name": getattr(settings, "user_name", ""),
            "user_skills": getattr(settings, "user_skills", ["general", "desktop_automation", "developer", "home_user"]),
            "custom_prompt": getattr(settings, "custom_prompt", ""),
        })
        
        # Voice listening will be started via 'client_state' message from frontend
        logger.info("Session created. Waiting for client_state event to start voice listen loop.")
        return session

    def disconnect(self, websocket: WebSocket):
        if websocket in self.sessions:
            session = self.sessions.pop(websocket)
            session.stop_listen_loop()
            logger.info("Client disconnected", session_id=session.session_id)
            self.sync_notification_state()

    def sync_notification_state(self):
        import os
        if os.environ.get("OPENSARTHI_PLATFORM") != "android":
            return
        try:
            is_task_active = False
            is_paused = False
            for session in list(self.sessions.values()):
                if session._active_runtimes:
                    is_task_active = True
                    if any(getattr(r, "_paused", False) for r in session._active_runtimes.values()):
                        is_paused = True
                    break

            try:
                import opensarthi_android_callbacks as _cb
                if hasattr(_cb, 'update_task_state'):
                    _cb.update_task_state(is_task_active, is_paused)
            except ImportError:
                pass  # Running outside Chaquopy (dev mode) — no-op
        except Exception as e:
            logger.warning("Failed to sync notification state to Android", error=str(e))

    def pause_all_tasks(self):
        loop = asyncio.get_event_loop()
        for session in list(self.sessions.values()):
            for tid, runtime in list(session._active_runtimes.items()):
                runtime.pause()
                asyncio.run_coroutine_threadsafe(
                    session.send_message("task_paused", {}, thread_id=tid),
                    loop
                )
        self.sync_notification_state()
        logger.info("Paused all active tasks via system command")

    def resume_all_tasks(self):
        loop = asyncio.get_event_loop()
        for session in list(self.sessions.values()):
            for tid, runtime in list(session._active_runtimes.items()):
                runtime.resume()
                asyncio.run_coroutine_threadsafe(
                    session.send_message("task_resumed", {}, thread_id=tid),
                    loop
                )
        self.sync_notification_state()
        logger.info("Resumed all active tasks via system command")

    def stop_all_tasks(self):
        loop = asyncio.get_event_loop()
        for session in list(self.sessions.values()):
            for tid, runtime in list(session._active_runtimes.items()):
                runtime.request_cancel()
                asyncio.run_coroutine_threadsafe(
                    session.send_message("agent_state", {
                        "state": "idle",
                        "goal": None,
                        "step": 0,
                        "step_description": None,
                        "total_steps": 0,
                        "retry_count": 0,
                        "error": None
                    }, thread_id=tid),
                    loop
                )
            for tid, task in list(session._message_tasks.items()):
                if not task.done():
                    loop.call_soon_threadsafe(task.cancel)
        self.sync_notification_state()
        logger.info("Stopped all active tasks via system command")

manager = ConnectionManager()

@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    session = await manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_json()
            await session.process_incoming(data)
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception as e:
        logger.error("WebSocket error", error=str(e))
        manager.disconnect(websocket)
