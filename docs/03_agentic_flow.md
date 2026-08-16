# OpenSarthi — Agentic Flow

This document describes the complete execution lifecycle of OpenSarthi from user input to final response.

> **Updated:** August 2026 — LangGraph dual-engine, SileroVAD ONNX, self-healing cap, smart overlay minimize, conversational settings tool, 32-tool registry, audio cues, multi-tab threads, full markdown response rendering, **Native Audio Pipeline (Gemini Live/OpenAI Realtime), Multi-Agent Supervisor, Browser Automation, Google OAuth (Calendar/Gmail), Two-Phase Morning Briefing, Content Panel, Session Memory (consumed after use), Parallel Search**.

---

## 1. Packaged App Bootstrap & Startup Flow

```mermaid
flowchart TD
    START([User runs AppImage / .exe]) --> TAURI[Tauri Shell Launches]
    TAURI --> SPAWN[Spawn sidecar bootstrap launcher]

    SPAWN --> PATH_CHECK{Check ~/.config/opensarthi/.venv}
    PATH_CHECK -->|Venv exists| IMPORT_CHECK{Validate package imports\nfastapi, pydantic_ai, langgraph, sentence_transformers...}
    PATH_CHECK -->|Venv missing| SETUP_VENV[Use bundled uv to download\nstandalone Python 3.12]

    IMPORT_CHECK -->|Imports succeed| BOOT_FASTAPI[Launch FastAPI via Uvicorn]
    IMPORT_CHECK -->|Imports fail| SETUP_VENV

    SETUP_VENV --> VENV_CREATE[Create virtual environment]
    VENV_CREATE --> PIP_INSTALL[Run uv pip install -r requirements.txt]
    PIP_INSTALL --> BOOT_FASTAPI

    BOOT_FASTAPI --> PORT_NEG[Bind to free OS port\nPrint PORT:xxxxx to stdout]
    PORT_NEG --> RUST_READ[Rust sidecar.rs reads port]
    RUST_READ --> WEBVIEW[Tauri WebView UI loads]
    WEBVIEW --> WS_CONNECT[Connect WebSocket to ws://127.0.0.1:xxxxx]
    WS_CONNECT --> SYNC_SETTINGS[Sync configuration via settings_sync\nRestore active thread and token count]
    SYNC_SETTINGS --> READY([OpenSarthi ready for input])
```

---

## 2. Top-Level Message Flow

```mermaid
flowchart TD
    A([User Input\nVoice or Text]) --> B[WebSocket → api/websocket.py]
    B --> C{Message Type?}

    C -->|user_message| D{Is it a task\nor chat?}
    C -->|run_json_plan| JP[run_plan_directly\nno LLM planning]
    C -->|cancel_execution| CANCEL[request_cancel\nkill agent + tool asyncio.Tasks]
    C -->|pause_execution| PAUSE[pause\nblock at asyncio.Event]
    C -->|resume_execution| RESUME[resume\nset asyncio.Event]
    C -->|update_settings| SETTINGS[save_settings_to_env\nrebuild AgentDeps\nemit settings_sync]

    D -->|Chat: question/explain/code| CHAT[chat_agent.run\nstream_text word-by-word\nassistant_response to WS]
    D -->|Task: desktop action| TASK{USE_LANGGRAPH?}

    TASK -->|true| LG[LangGraph graph.ainvoke\nStateful graph execution]
    TASK -->|false| AR[AgentRuntime.run\nLegacy agentic loop]

    CHAT --> DONE([assistant_response to frontend])
    LG --> DONE
    AR --> DONE
    JP --> DONE
```

---

## 3. Intent Classification (Chat vs. Task vs. Clarify)

The orchestrator calls a lightweight `PydanticAgent` to classify each input into exactly one of three intents.

```mermaid
flowchart LR
    INPUT[User message] --> ORCH[OrchestratorAgent.route]
    ORCH --> CLS[LLM Intent Classification\nPydanticAgent]

    CLS -->|CHAT / CLARIFY| CHAT_AGENT[Conversational PydanticAgent\nDirect markdown streaming response]
    CLS -->|TASK| RUNTIME[AgentRuntime or LangGraph\nDesktop Context + Tools]

    CHAT_AGENT --> WS_CHAT[assistant_response\nbypasses desktop planning]
    RUNTIME --> TASK_PLAN[Parse JSON plan\nPlan + PlanStep schemas]
    TASK_PLAN --> EXEC[Execute Tools and Desktop Actions]
```

> **Key benefit:** `CHAT` inputs bypass the expensive desktop observation and planning loop entirely, returning beautifully formatted Markdown instantly. Only `TASK` inputs trigger window snapshotting, memory recall, and the full tool execution loop.

---

## 4. LangGraph Execution Graph (USE_LANGGRAPH=true)

The LangGraph engine is a compiled `StateGraph` with 8 nodes and full conditional routing.

```mermaid
flowchart TD
    START([run_graph called]) --> CLASSIFY[classify_node\nLLM intent classification]
    CLASSIFY --> ROUTE{route_by_classification}

    ROUTE -->|CHAT/CLARIFY| CHAT_N[chat_node\nConversational response]
    ROUTE -->|TASK| OBSERVE[observe_node\nDesktop snapshot + memory recall]
    ROUTE -->|cancelled| END_A([END])

    OBSERVE --> PLAN[plan_node\nPydanticAI planner → JSON plan\nEmits plan_created + minimize_hint]
    PLAN --> ROUTE_PLAN{route_after_plan}

    ROUTE_PLAN -->|steps available| EXECUTE[execute_step_node\nRun current plan step]
    ROUTE_PLAN -->|no steps| REVIEW[review_node\nPost-task lesson extraction]
    ROUTE_PLAN -->|cancelled| END_B([END])

    EXECUTE --> ROUTE_EXEC{route_after_execute}
    ROUTE_EXEC -->|next step| EXECUTE
    ROUTE_EXEC -->|all done| REVIEW
    ROUTE_EXEC -->|step failed| HEAL[heal_node\nHeuristic or LLM diagnosis]
    ROUTE_EXEC -->|unrecoverable| REPLAN[replan_node\nIncrement retry_count]
    ROUTE_EXEC -->|cancelled| END_C([END])

    HEAL --> ROUTE_HEAL{route_after_heal}
    ROUTE_HEAL -->|retry step| EXECUTE
    ROUTE_HEAL -->|cap exceeded| REPLAN

    REPLAN --> ROUTE_REPLAN{route_replan}
    ROUTE_REPLAN -->|retries left| OBSERVE
    ROUTE_REPLAN -->|max retries| END_D([END])

    REVIEW --> END_E([END])
    CHAT_N --> END_F([END])
```

### OpenSarthiState — Full Typed State Schema

All graph nodes read from and write partial updates into `OpenSarthiState`:

| Field | Type | Purpose |
|-------|------|---------|
| `goal` | `str` | Current user goal |
| `thread_id` | `str` | Active conversation thread |
| `classification` | `str` | CHAT \| TASK \| CLARIFY |
| `messages` | `list` | PydanticAI message history (do NOT use LangChain message coercion) |
| `plan_steps` | `list` | Current plan step dicts |
| `current_step_index` | `int` | Which step to execute next |
| `completed_actions` | `list[str]` | Human-readable step log |
| `failed_actions` | `list[str]` | Error log for replanning context |
| `cumulative_steps` | `list` | Full task history (survives replanning) for UI |
| `heal_attempts` | `dict[int,int]` | Heal attempt count per step index (cap: 2) |
| `retry_count` | `int` | Full replan count (max: 5) |
| `desktop_snapshot` | `dict` | Serialized DesktopSnapshot |
| `recalled_memories` | `list` | Top-8 semantic memory hits |
| `preferences` | `list` | All stored [PREFERENCE] entries |
| `last_tool_result` | `dict` | Most recent ToolResult |
| `is_cancelled` | `bool` | Abort signal set by cancel_execution |
| `is_paused` | `bool` | Pause signal set by pause_execution |
| `final_response` | `str` | Final text to broadcast |
| `total_request_tokens` | `int` | Accumulated input tokens |
| `total_response_tokens` | `int` | Accumulated output tokens |

### Checkpointing

- **Default:** `MemorySaver` (in-memory, survives execution, lost on restart)
- **Persistent:** `SqliteSaver` at `~/.config/opensarthi/checkpoints.db` (requires `langgraph-checkpoint-sqlite`)

---

## 5. AgentRuntime Loop (Legacy / USE_LANGGRAPH=false)

```mermaid
flowchart TD
    START([AgentRuntime.run\ngoal, model, history]) --> SNAP[Take desktop snapshot\nobservation.py]
    SNAP --> RECALL[Auto-recall memories\ntop-8 semantic + all preferences]
    RECALL --> CTX[build_structured_context\ngoal + snapshot + memories\n+ completed/failed actions]
    CTX --> LLM_PLAN[_agent_run\nasyncio.Task wrapping agent.run]

    LLM_PLAN --> CANCELLED_LLM{CancelledError?}
    CANCELLED_LLM -->|Yes| ABORT([Return cancelled])
    CANCELLED_LLM -->|No| PARSE_PLAN[Parse JSON plan from LLM response]

    PARSE_PLAN --> HAS_PLAN{Has tool steps?}
    HAS_PLAN -->|No - chat response| STREAM[Stream text response\nassistant_response + stream_chunk]
    HAS_PLAN -->|Yes| DECOMPOSE[Topological sort → parallel step groups]

    DECOMPOSE --> PARALLEL_GROUP[Execute parallel group concurrently\nasyncio.gather]
    PARALLEL_GROUP --> CHECK_PAUSE[_check_pause\nawait asyncio.Event if paused]
    CHECK_PAUSE --> EMIT_START[Emit tool_started via WebSocket]
    EMIT_START --> TOOL_EXEC[_tool_execute\nasyncio.Task wrapping tool.safe_execute]

    TOOL_EXEC --> RESULT{Success?}
    RESULT -->|Yes| EMIT_DONE[Emit tool_completed]
    RESULT -->|CancelledError| EMIT_TERM[Emit tool_terminated → abort]
    RESULT -->|Exception| HEALER[HealerAgent.diagnose_and_fix]

    HEALER --> HEAL_RESULT{Healed?}
    HEAL_RESULT -->|Fixed| EMIT_DONE
    HEAL_RESULT -->|Failed| EMIT_ERR[Emit tool_error → continue]

    EMIT_DONE --> MORE_STEPS{More groups?}
    MORE_STEPS -->|Yes| PARALLEL_GROUP
    MORE_STEPS -->|No| TASK_END([Task Completes])
```

---

## 6. Self-Healing Sub-System

### HealerAgent Heuristics (No LLM Required)

| Failure Pattern | Auto-Fix Applied |
|---|---|
| `type_text` fails, "focus" in error | Inject `click_element` step before typing |
| `click` fails with coordinate issue | Suggest `click_element` with accessible name |
| `open_app` fails | Try alternate binary name |
| `wait_for_window` times out | Increase timeout by 3000ms |
| `shell` command not found | Add full path fallback |

### LLM-Based Healing

If heuristics cannot match the error pattern, HealerAgent calls the LLM with:
- The failed step definition
- The error message
- Current desktop screenshot
- A prompt asking for a corrected step

### Healing Retries Cap (Safety Limit)

To prevent infinite healing loops:
- **Per-step cap:** Maximum **2 heal attempts** per `step_index`, tracked in `OpenSarthiState.heal_attempts: dict[int, int]`
- **Fallback:** On the 3rd failure, healing is bypassed → `replan_node` rewrites the entire plan
- **Replan limit:** Maximum **5 full replans** (`max_retries=5`); after that the task is abandoned

### Self-Improving: ReviewerAgent (Post-Task)

After every completed task:
1. ReviewerAgent receives the full execution log
2. LLM extracts 1–3 concrete lessons from what worked / what failed
3. Lessons stored as `long_term_memories` with `source=self_review, importance=0.9`
4. On the next similar task, these lessons are auto-recalled into the planning context

### Dynamic Final Response Formatting
To prevent generic templated messages (like "Task completed!"), the final response output is dynamically generated by an LLM-based formatting agent (Reviewer Agent). It takes the original user goal and the full execution step results (including stdout and web search outputs), and synthesizes a direct, clean, and styled Markdown response tailored to the context.

### Preference Learning: BehavioralObserver (Post-Response)

After every response:
1. BehavioralObserver scans the last 3 conversation turns
2. LLM detects implicit user preferences (e.g., "prefers short answers", "uses dark themes")
3. Stored as `[PREFERENCE]` tagged memories
4. Always injected into every subsequent LLM context

---

## 7. Smart Overlay Window Management

OpenSarthi automatically manages its window size during task execution to avoid obstructing the desktop:

```mermaid
flowchart TD
    PLAN_CREATED[plan_node generates plan] --> SCREEN_CHECK{Plan contains\nscreen-interaction tools?}
    SCREEN_CHECK -->|Yes: click/type/open_app/etc| MIN_HINT[Emit window_control → minimize_hint]
    SCREEN_CHECK -->|No: shell/memory/search only| NO_HINT[Window stays full-size]

    MIN_HINT --> FRONTEND[Frontend useWindowOverlay hook]
    FRONTEND --> COLLAPSE[Collapse to 280x560 overlay strip\nRight edge of screen]
    COLLAPSE --> TASK_RUNS[Task executes with HUD visible above desktop]

    TASK_RUNS --> COMPLETE[Task completes]
    COMPLETE --> RESTORE_HINT[Emit window_control → restore]
    RESTORE_HINT --> EXPAND[Restore to original size + position]
```

**User override:** If user clicks "Expand" during task → `userExpandedDuringTask` flag set → auto-collapse suppressed for that task.

---

## 8. Voice Pipeline Flow

```mermaid
flowchart TD
    MIC[Microphone\nPyAudio 16kHz 512-sample chunks] --> VAD[SileroVAD ONNX\nSpeech Activity Detection]
    MIC --> WAKE[WakeWordDetector\nOpenWakeWord]

    WAKE -->|Phrase detected| VOICE_TRIGGER[Emit voice_trigger event]
    VAD -->|Speech detected| BUFFER[Accumulate speech buffer]
    VAD -->|Silence detected| PROCESS[Send buffer to FasterWhisperSTT]

    VOICE_TRIGGER --> BUFFER

    PROCESS --> TRANSCRIPT[Transcript text]
    TRANSCRIPT --> WS_MSG[WebSocket user_message]
    WS_MSG --> AGENT[Agent processes message]

    AGENT --> TTS[gTTS / Kokoro asyncio.subprocess]
    TTS --> PLAY[Audio playback]
    PLAY --> SUSPEND_STT[Suspend STT during playback\necho prevention]
    SUSPEND_STT --> RESUME_STT[Resume STT after playback + 300ms]
```

**VAD (SileroVAD via ONNX Runtime):**
- Model resolution order: `faster-whisper` assets → `openwakeword` resources → `~/.config/opensarthi/models/`
- Falls back to RMS energy threshold if ONNX session fails to load
- Maintains recurrent LSTM state (`h`, `c`, `context`) across 512-sample chunks — pure CPU

---

## 9. Native Audio Pipeline Flow (Mark-L Speed)

```mermaid
flowchart TD
    START([User enables Native Audio in Settings]) --> CHECK{Provider Available?}
    CHECK -->|Gemini API Key| GEMINI[Connect to Gemini Live API\nWebSocket: wss://generativelanguage.googleapis.com]
    CHECK -->|OpenAI API Key| OPENAI[Connect to OpenAI Realtime API\nWebRTC: wss://api.openai.com/v1/realtime]
    CHECK -->|Neither| FALLBACK[Use Offline Pipeline\nSTT→LLM→TTS]
    
    GEMINI --> SESSION[Create Session\nEnable Function Calling for ALL tools]
    OPENAI --> SESSION
    
    SESSION --> LOOP[Native Audio Loop]
    
    LOOP --> CAPTURE[Capture Audio Chunks\n16kHz mono from microphone]
    CAPTURE --> STREAM[Stream to Provider\nBidirectional audio frames]
    
    STREAM --> RECEIVE{Receive Type?}
    RECEIVE -->|Audio Chunks| PLAY[Play Immediately\nSub-100ms latency]
    RECEIVE -->|Function Call| EXEC_TOOL[Execute Tool\nAsync parallel if multiple]
    RECEIVE -->|Transcript| SHOW[Display on Frontend\ntranscript_update WS event]
    RECEIVE -->|Turn Complete| CONTINUE[Continue Loop]
    
    EXEC_TOOL --> RESULT[Stream Result Back\nFunction Response to Provider]
    RESULT --> CONTINUE
    
    PLAY --> CONTINUE
    SHOW --> CONTINUE
    CONTINUE --> LOOP
    
    LOOP --> USER_STOP[User disables or error] --> CLEANUP[Close WebSocket/WebRTC\nResume Offline Pipeline]
```

**Key Differences from Offline Pipeline:**

| Aspect | Offline (STT→LLM→TTS) | Native Audio (Gemini Live) |
|--------|----------------------|---------------------------|
| Latency | ~2-3 seconds | <500ms voice-to-voice |
| Architecture | Sequential pipeline | Single bidirectional stream |
| Turn-taking | VAD + silence detection | Model-native (no VAD needed) |
| Function Calling | Separate LLM call | Built into audio stream |
| Interruption | Stop TTS + wait | Native barge-in support |
| Offline | ✅ Yes | ❌ Cloud required |

---

## 9.1 Two-Phase Morning Briefing Flow (Mark-L Style)

```mermaid
flowchart TD
    TRIGGER[Trigger: "Good morning" or Scheduled time] --> PHASE1[Phase 1: Instant Greeting\n<1 second, NO tool calls]
    
    PHASE1 --> SPEAK1[Speak: "Good morning! I'm compiling your briefing..."]
    PHASE1 --> BG_FETCH[BACKGROUND: Start parallel fetch\n- Calendar events (calendar_read)\n- Unread emails (gmail_read)\n- Vector memories (recall)\n- News headlines (parallel_search: DDG + Gemini)]
    
    BG_FETCH --> WAIT{All fetches complete?}
    WAIT -->|No| WAIT
    WAIT -->|Yes| PHASE2[Phase 2: Full Briefing Ready]
    
    PHASE2 --> FORMAT[Format for TTS + Content Panel\nEar-optimized: no markdown, spoken URLs]
    FORMAT --> SPEAK2[Stream Full Briefing via TTS]
    FORMAT --> PANEL[Send to Content Panel\nbriefing_phase2 WS event\nCalendar cards + Weather + News + Memories]
    
    SPEAK2 --> DONE([Briefing Complete])
    PANEL --> DONE
```

**Phase 1 Characteristics:**
- **Instant**: No tool calls, pure LLM greeting
- **Sets expectation**: "I'm compiling your briefing..."
- **Parallel start**: All fetches begin immediately

**Phase 2 Characteristics:**
- **Complete data**: Calendar + Gmail + Memories + News
- **Ear-optimized**: Formatted for TTS (no markdown bullets/tables/URLs)
- **Visual**: Rich Content Panel with cards, charts, previews
- **Parallel search**: DDG + Gemini race (first-wins) for news

---

## 9.2 Session Memory Flow (Mark-L: Consumed After Use)

```mermaid
flowchart TD
    MSG[New message added to thread] --> COUNT[Increment turns_since_summary]
    COUNT --> CHECK{turns_since_summary >= session_memory_turns (40)?}
    
    CHECK -->|No| CONTINUE[Continue normal flow]
    CHECK -->|Yes| SUMMARIZE[Create Session Summary]
    
    SUMMARIZE --> FETCH[Fetch last 40 messages from DB]
    FETCH --> FLASH[Call fast model\ngemini-2.5-flash for 1-2 sentence summary]
    FLASH --> STORE[Store in session_memories table\nconsumed=FALSE]
    STORE --> MARK[Mark previous summary consumed=TRUE]
    MARK --> RESET[turns_since_summary = 0]
    RESET --> CONTINUE
    
    CONTINUE --> PLANNING[Next planning call]
    PLANNING --> INJECT[Inject latest unconsumed summary\nas "Previous session context"]
    INJECT --> MARK_USED[Mark injected summary consumed=TRUE]
    MARK_USED --> NEVER_REPEAT[Never re-summarized / never repeated]
```

**Properties (Mark-L Pattern):**
- **Consumed after use**: Once injected → `consumed=TRUE` → never used again
- **Never repeats**: Each summary covers only new turns since last summary
- **Fast model**: Uses `gemini-2.5-flash` for near-instant summarization
- **Replaces sliding window**: More efficient than 20-message window + context compaction

---

## 9.3 Parallel Search Flow (First-Wins Pattern)

```mermaid
flowchart TD
    QUERY[Search query from user/tool] --> PARALLEL[Launch parallel searches]
    
    PARALLEL --> DDG[DuckDuckGo HTML scrape]
    PARALLEL --> GEMINI[Gemini Web Search API]
    PARALLEL --> BRAVE[Brave Search API if key available]
    
    DDG --> RACE{Race Condition:\nFirst completed wins}
    GEMINI --> RACE
    BRAVE --> RACE
    
    RACE -->|DDG wins| USE_DDG[Use DDG results\nCancel others]
    RACE -->|Gemini wins| USE_GEMINI[Use Gemini results\nCancel others]
    RACE -->|Brave wins| USE_BRAVE[Use Brave results\nCancel others]
    
    USE_DDG --> RETURN[Return results to caller]
    USE_GEMINI --> RETURN
    USE_BRAVE --> RETURN
```

**Benefit**: Reduces search latency from slowest engine to fastest engine.

---

## 9.4 Instant Vision Acknowledgment Flow

```mermaid
flowchart TD
    USER_Q[User asks: "What's on my screen?"] --> INSTANT[Immediate TTS: "Looking at your screen..."]
    INSTANT --> VOICE_STATE[Emit voice_state: "looking"]
    VOICE_STATE --> BG_CAPTURE[Background: Capture screenshot\nobservation.py]
    BG_CAPTURE --> ANALYZE[Analyze with VLM / OCR]
    ANALYZE --> RESULT[Full description ready]
    RESULT --> FOLLOWUP[Speak: "I can see..." + show on Content Panel]
    RESULT --> PANEL[screen_analysis WS event\nScreenshot + AI description + UI highlights]
    
    INSTANT -.->|Perceived latency: <100ms| USER
    FOLLOWUP -.->|Full result: ~500ms-2s| USER
```

**Eliminates perceived latency** for vision queries by responding instantly while processing in background.

---

## 9.5 Multi-Agent Supervisor Flow (LangGraph)

```mermaid
flowchart TD
    START([LangGraph run_graph invoked]) --> OBSERVE[observe_node
Desktop snapshot + memory recall]
    OBSERVE --> SUPER[supervise_node
Multi-Agent Supervisor]
    
    SUPER --> CLASSIFY{use_supervisor setting?}
    CLASSIFY -->|False| PLAN[plan_node
All tools available]
    CLASSIFY -->|True| CLASSIFY_LLM[LLM Domain Classifier
PydanticAgent with multi-domain prompt]
    
    CLASSIFY_LLM --> PARSE[Parse JSON output
domains + confidence + reason]
    PARSE --> RESOLVE[resolve_allowed_tools
Union of domain tools + GENERAL]
    
    RESOLVE --> CONFIDENCE{confidence >= 0.4?}
    CONFIDENCE -->|Yes| RETURN[Return SupervisorResult
domains, confidence, reason, allowed_tools, dispatch_id]
    CONFIDENCE -->|No| FALLBACK[Fallback: GENERAL
All tools available]
    
    RETURN --> PLAN[plan_node
build_structured_context filters to allowed_tools]
    FALLBACK --> PLAN
    
    PLAN --> EXECUTE[execute_step_node
Authorization: tool must be in allowed_tools]
    EXECUTE --> HEAL[heal_node
HealerAgent.diagnose_and_fix filters to allowed_tools]
    
    EXECUTE -->|Success| MORE{More steps?}
    MORE -->|Yes| EXECUTE
    MORE -->|No| REVIEW[review_node
Post-task lesson extraction]
    HEAL -->|Healed| EXECUTE
    HEAL -->|Failed| REPLAN[replan_node]
```

### Implementation Details

**Supervisor runs ONCE** at the start of the graph (after `observe_node`, before `plan_node`). It does not use LangGraph `Send` API for sub-agent dispatch — instead it produces a `SupervisorResult` with an `allowed_tools` list that is threaded through three enforcement points:

| Enforcement Point | Location | How it works |
|---|---|---|
| **Planner visibility** | `plan_node` → `build_structured_context` | Filters the tool list shown to the LLM; only `allowed_tools` are visible |
| **Executor authorization** | `execute_step_node` | Rejects any step whose tool is not in `allowed_tools` (returns error) |
| **Healer visibility** | `heal_node` → `HealerAgent.diagnose_and_fix` | Only suggests replacement tools within `allowed_tools` scope |

**Domain Classification:**
- 10 domains: `WEB`, `CALENDAR`, `MAIL`, `BROWSER`, `MUSIC`, `SOCIAL`, `CODE`, `DESKTOP_UI`, `SHELL`, `GENERAL`
- Multi-domain supported (e.g., "check calendar and email summary" → `CALENDAR`, `MAIL`)
- Tool metadata lives on `BaseTool.domain` (not hardcoded mapping)
- `GENERAL` tools always included; if `GENERAL` in domains → all tools returned

**Fallback Behavior (never raises):**
1. Classifier exception → `GENERAL` with all tools
2. Confidence < 0.4 → `GENERAL` with all tools
3. Parse failure → `GENERAL` with all tools

**WebSocket Events:**
- `multi_agent_dispatch` — emitted on every supervisor decision (domains, confidence, allowed_tools, dispatch_id)
- `graph_node_status` — `SUPERVISE` node status (running/done)

**Metrics:**
- `SupervisorMetrics` tracks: total dispatches, domain distribution, avg confidence, avg tool scope size, fallback rate

**Backward Compatibility:**
- `AgentRuntime` (legacy, `USE_LANGGRAPH=false`) passes `allowed_tools=None` → unrestricted
- `use_supervisor` setting toggles the feature (default: `false`)

---

## 9. Settings Update Flow

Settings can be updated in three ways:

1. **Frontend SettingsView** → sends `update_settings` WS message
2. **Voice/text command** → agent calls `update_settings` tool
3. **Onboarding wizard** → sends `update_settings` on completion

```mermaid
flowchart TD
    FRONTEND_SAVE[User clicks Save AI Details or Save All] --> WS_UPDATE[update_settings WS message]
    VOICE_CMD[User says: change my theme to cyberpunk] --> AGENT_TOOL[Agent calls update_settings tool]
    WS_UPDATE --> WEBSOCKET_HANDLER[api/websocket.py update_settings handler]
    AGENT_TOOL --> WEBSOCKET_HANDLER

    WEBSOCKET_HANDLER --> VALIDATE[Validate and filter empty API keys]
    VALIDATE --> SAVE_ENV[save_settings_to_env writes ~/.config/opensarthi/.env]
    SAVE_ENV --> REBUILD_DEPS[Rebuild AgentDeps with new model/provider]
    REBUILD_DEPS --> EMIT_SYNC[Emit settings_sync to frontend]
    EMIT_SYNC --> FRONTEND_UPDATE[Frontend updates all store fields\nTheme, model dropdown, toggles all refresh]
```

**Save granularity:**
- **"Save AI Details"** — saves only provider, model, and API key fields
- **"Save All Settings"** — saves everything (AI + voice + UI + memory)

---

## 10. Memory System

```mermaid
flowchart TD
    USER_MSG[User sends message] --> RECALL[MemoryManager.recall\ntop-8 semantic hits]
    RECALL --> EMBED[SentenceTransformer embed query\nall-MiniLM-L6-v2 cached at module level]
    EMBED --> COSINE[Cosine similarity search\nagainst stored embeddings]
    COSINE --> INJECT[Inject as RELEVANT PAST EXPERIENCE\nin LLM context]

    PREFS[Load all PREFERENCE memories] --> INJECT_P[Inject as USER PREFERENCES\nin LLM context]

    TASK_COMPLETE[Task completes] --> REVIEWER_ASYNC[ReviewerAgent async fire-and-forget]
    REVIEWER_ASYNC --> LESSON[Extract 1-3 lessons from execution log]
    LESSON --> STORE[store to long_term_memories\nimportance=0.9]

    RESPONSE_DONE[Response sent] --> OBSERVER_ASYNC[BehavioralObserver async fire-and-forget]
    OBSERVER_ASYNC --> DETECT[Detect implicit preferences\nfrom last 3 conversation turns]
    DETECT --> STORE_PREF[store as PREFERENCE tag memory]

    TOGGLE_OFF[long_term_memory_enabled = False] --> BYPASS[SentenceTransformer never loaded\nno semantic search]
    BYPASS --> FALLBACK[Fallback: SQLite substring search]
```

---

## 11. Cancellation & Pause Architecture

```mermaid
flowchart LR
    USER_CANCEL[User clicks STOP button] --> WS_CANCEL[cancel_execution WS message]
    USER_PAUSE[User triggers pause] --> WS_PAUSE[pause_execution WS message]

    WS_CANCEL --> RUNTIME_CANCEL[AgentRuntime.request_cancel\nor LangGraph is_cancelled = True]
    WS_PAUSE --> RUNTIME_PAUSE[AgentRuntime.pause\nclear asyncio.Event]

    RUNTIME_CANCEL --> KILL_LLM[Cancel _agent_task asyncio.Task\ninterrupts LLM inference mid-stream]
    RUNTIME_CANCEL --> KILL_TOOL[Cancel _tool_task asyncio.Task\ninterrupts running tool]
    KILL_LLM --> EMIT_TERM[Emit tool_terminated for active step]
    KILL_TOOL --> EMIT_TERM

    RUNTIME_PAUSE --> BLOCK[Loop blocks at _check_pause\nawait asyncio.Event]
    BLOCK --> WAIT[Task is frozen until resume]

    WS_RESUME[resume_execution WS message] --> SET_EVENT[Set asyncio.Event]
    SET_EVENT --> UNBLOCK[Loop resumes from where it paused]
```

---

## 12. Token Tracking

Token usage is tracked at two levels:

| Level | Scope | Reset |
|-------|-------|-------|
| **Thread** | Per active conversation thread | On "New Thread" |
| **Session** | Cumulative across all threads | On app restart |
| **Global (per model)** | Lifetime token usage per model key | Persisted in localStorage |

Token data is extracted from PydanticAI `result.usage` — handles both `request_tokens`/`response_tokens` and `input`/`output` field name variants across PydanticAI versions.
