# OpenSarthi — Agentic Flow

This document describes the complete execution lifecycle of OpenSarthi from user input to final response, with Mermaid flowcharts for each major stage.

---

## 1. Packaged App Bootstrap & Startup Flow

This flowchart describes the boot sequence when executing the packaged AppImage/executable on a target system.

```mermaid
flowchart TD
    START([User runs AppImage / .exe]) --> TAURI[Tauri Shell Launches]
    TAURI --> SPAWN[Spawn sidecar bootstrap launcher]
    
    SPAWN --> PATH_CHECK{Check ~/.config/opensarthi/venv}
    PATH_CHECK -->|Venv exists| IMPORT_CHECK{Validate package imports\nfastapi, pydantic_ai, etc.}
    PATH_CHECK -->|Venv missing| SETUP_VENV[Use bundled 'uv' to download\nstandalone Python 3.12]
    
    IMPORT_CHECK -->|Imports succeed| BOOT_FASTAPI[Launch FastAPI via Uvicorn]
    IMPORT_CHECK -->|Imports fail| SETUP_VENV
    
    SETUP_VENV --> VENV_CREATE[Create virtual environment]
    VENV_CREATE --> PIP_INSTALL[Run 'uv pip install -r requirements.txt']
    PIP_INSTALL --> BOOT_FASTAPI
    
    BOOT_FASTAPI --> PORT_NEG[Bind to free OS port\nPrint 'PORT:xxxxx' to stdout]
    PORT_NEG --> RUST_READ[Rust sidecar manager reads port]
    RUST_READ --> WEBVIEW[Tauri WebView UI loads]
    WEBVIEW --> WS_CONNECT[Connect WebSocket to ws://127.0.0.1:xxxxx]
    WS_CONNECT --> SYNC_SETTINGS[Sync configuration\nRestore active thread & token count]
    SYNC_SETTINGS --> READY([OpenSarthi ready for input])
```

---

## 2. Top-Level Message Flow

```mermaid
flowchart TD
    A([User Input\nVoice or Text]) --> B[WebSocket → websocket.py]
    B --> C{Message Type?}

    C -->|user_message| D{Is it a task\nor chat?}
    C -->|run_json_plan| JP[run_plan_directly\nno LLM planning]
    C -->|cancel_execution| CANCEL[request_cancel\nkill agent + tool tasks]
    C -->|pause_execution| PAUSE[pause\nblock at asyncio.Event]
    C -->|resume_execution| RESUME[resume\nset asyncio.Event]
    C -->|update_settings| SETTINGS[save_settings_to_env\nrebuild AgentDeps]

    D -->|Chat: question/explain/code| CHAT[agent.run\nstreaming response\nassistant_response →WS]
    D -->|Task: desktop action needed| TASK[AgentRuntime.run\nagentic loop]

    CHAT --> DONE([assistant_response\nto frontend])
    TASK --> DONE
    JP --> DONE
```

---

## 3. How the Agent Decides: Chat vs. Task (Intent Classification)

The orchestrator utilizes a lightweight `PydanticAgent` API call to dynamically classify the user's input into exactly one of three intents: `CHAT`, `TASK`, or `CLARIFY`.

```mermaid
flowchart LR
    INPUT[User message] --> ORCH[OrchestratorAgent.route]
    ORCH --> CLS[LLM Intent Classification\nPydanticAgent]
    
    CLS -->|CHAT / CLARIFY| CHAT_AGENT[Conversational PydanticAgent\nDirect markdown response]
    CLS -->|TASK| RUNTIME[AgentRuntime Planner Loop\nDesktop Context & Tools]
    
    CHAT_AGENT --> WS_CHAT[assistant_response\nbypasses desktop planning]
    RUNTIME --> TASK_PLAN[Parse JSON plan\nPlan + PlanStep schemas]
    TASK_PLAN --> EXEC[Execute Tools & Desktop Actions]
```

> **Key Routing Benefit:** By classifying intent upfront via the API, conversational interactions (`CHAT`) completely bypass the heavy desktop observation loop, returning beautifully formatted Markdown instantly. Only actionable commands (`TASK`) trigger the full window snapshotting and planning loop.

---

## 4. AgentRuntime Execution Loop (with Self-Healing)

```mermaid
flowchart TD
    START([AgentRuntime.run\ngoal, model, history]) --> SNAP[Take desktop snapshot\nobservation.py]
    SNAP --> RECALL[Auto-recall memories\ntop-5 semantic + all preferences]
    RECALL --> CTX[build_structured_context\ngoal + snapshot + memories\n+ completed/failed actions]
    CTX --> LLM_PLAN[_agent_run\nasyncio.Task wrapping agent.run]

    LLM_PLAN --> CANCELLED_LLM{CancelledError?}
    CANCELLED_LLM -->|Yes| ABORT([Return\nExecution cancelled])
    CANCELLED_LLM -->|No| PARSE_PLAN[Parse JSON plan\nfrom LLM response]

    PARSE_PLAN --> VALID{Valid plan?}
    VALID -->|No / plain text| OBSERVER_BG[Fire BehavioralObserver\nasync background task]
    OBSERVER_BG --> RETURN_TEXT([Return LLM text\nas assistant_response])
    VALID -->|Yes| EMIT_PLAN[Emit plan_created → WS]

    EMIT_PLAN --> DECOMPOSE[Task Decomposer\nGroup steps by dependency topological sort]
    DECOMPOSE --> LOOP_START

    subgraph LOOP_START[For each parallel group in groups]
        direction TB
        EXEC_GATHER[Execute group concurrently\nasyncio.gather]
        
        subgraph STEP_EXEC[For each step in group]
            CHECK_CANCEL{cancel\nrequested?} -->|Yes| TERMINATE([Emit tool_terminated\nReturn cancelled])
            CHECK_CANCEL -->|No| CHECK_PAUSE[_check_pause\nawait asyncio.Event]
            CHECK_PAUSE --> EMIT_START[Emit tool_started → WS]
            EMIT_START --> TOOL_EXEC[_tool_execute\nasyncio.Task wrapping\ntool.safe_execute]
            TOOL_EXEC --> TOOL_CANCELLED{CancelledError?}
            TOOL_CANCELLED -->|Yes| TERMINATE
            TOOL_CANCELLED -->|No| TOOL_RESULT{Success?}
            TOOL_RESULT -->|Yes| COMPLETE[Emit tool_completed → WS\nAppend to completed_actions]
            TOOL_RESULT -->|No| HEAL{HealerAgent\nquick-fix or LLM-fix?}
            HEAL -->|Fix found| HEALED_EXEC[Execute healed step]
            HEALED_EXEC --> HEALED_OK{Success?}
            HEALED_OK -->|Yes| COMPLETE
            HEALED_OK -->|No| FAIL[Emit tool_error → WS\nAppend to failed_actions]
            HEAL -->|No fix| FAIL
        end
        
        EXEC_GATHER --> STEP_EXEC
    end

    STEP_EXEC --> NEXT_GROUP[Next group]
    NEXT_GROUP --> MORE{More groups?}
    MORE -->|Yes| LOOP_START
    MORE -->|No| DONE

    DONE --> REPLAN{Failed actions exist\nAND retry < 3?}
    REPLAN -->|Yes, retry| SNAP
    REPLAN -->|No| LEARN[Fire ReviewerAgent +\nBehavioralObserver\nasync background tasks]
    LEARN --> FORMAT[Format final response\n✓ completed / ❌ failed]
    FORMAT --> RETURN([Return formatted summary\nassistant_response → WS])
```

---

## 5. Self-Healing & Self-Improving Flow

```mermaid
flowchart TD
    STEP_FAIL([Step Fails]) --> HEALER[HealerAgent.diagnose_and_fix]
    HEALER --> QUICK{Quick heuristic\\napplies?}
    QUICK -->|type_text without focus| FIX_FOCUS[Inject click_element step\\nbefore type_text]
    QUICK -->|No| LLM_HEAL[LLM healing call\\nscreen state + error -> corrected step]
    LLM_HEAL --> HEALED{Fix found?}
    HEALED -->|Yes| APPLY[Apply healed step\\nEmit self_heal tool_action]
    HEALED -->|No| REPLAN[Normal replan loop]
    FIX_FOCUS --> APPLY
    APPLY --> RETRY[Retry healed step]
    RETRY --> OK{Success?}
    OK -->|Yes| CONTINUE([Continue plan])
    OK -->|No| REPLAN

    TASK_END([Task Completes]) --> REVIEWER[ReviewerAgent.review_and_learn\\nAsync fire-and-forget]
    REVIEWER --> LLM_REVIEW[LLM analyses execution log\\nExtracts 1-3 lessons]
    LLM_REVIEW --> STORE_LESSONS[Store to long_term_memories\\nsource=self_review importance=0.9]

    TASK_END --> OBSERVER[BehavioralObserver.observe_and_store\\nAsync fire-and-forget]
    OBSERVER --> LLM_DETECT[LLM scans last 3 conversation turns\\nDetects implicit preferences]
    LLM_DETECT --> STORE_PREFS[Store to long_term_memories\\nsource=behavioral_observer]

    STORE_LESSONS --> NEXT_TASK[Next similar task]
    STORE_PREFS --> NEXT_TASK
    NEXT_TASK --> AUTO_RECALL[auto_recalled_memories fetch\\ntop-5 semantic + all preferences]
    AUTO_RECALL --> CONTEXT_INJECT[Injected as USER PREFERENCES\\n+ RELEVANT PAST EXPERIENCE]
    CONTEXT_INJECT --> SMARTER([Agent is smarter this time])
```

### Self-Healing Heuristics (No LLM Needed)

| Failure Pattern | Auto-Fix |
|---|---|
| `type_text` fails, "focus" in error | Inject `click_element` step before typing |
| `click` fails with coordinate issue | Suggest `click_element` with accessible name |
| `open_app` fails | Try alternate app binary name |
| `wait_for_window` times out | Increase timeout by 3000ms |

---

## 6. Cancellation & Pause Architecture

```mermaid
stateDiagram-v2
    [*] --> IDLE

    IDLE --> PLANNING: user_message received
    PLANNING --> EXECUTING: plan parsed
    EXECUTING --> PAUSED: pause_execution
    PAUSED --> EXECUTING: resume_execution
    EXECUTING --> IDLE: all steps done
    EXECUTING --> IDLE: cancel_execution
    PLANNING --> IDLE: cancel_execution
    PAUSED --> IDLE: cancel_execution
```

### Cancel Signal Path

```mermaid
flowchart LR
    FE[Frontend\ncancel button] -->|cancel_execution WS| WS[websocket.py]
    WS --> RC[runtime.request_cancel]
    RC --> E1[_agent_task.cancel\nstops LLM mid-inference]
    RC --> E2[_tool_task.cancel\nstops tool mid-execution]
    E1 --> CAUGHT[CancelledError caught\nin run loop]
    E2 --> CAUGHT
    CAUGHT --> EMIT[Emit tool_terminated\nor plain abort]
```

---

## 6. JSON Plan Direct Execution (Import Mode)

```mermaid
flowchart TD
    FE[Frontend JSON Import\nPaste step array] --> VALIDATE[Client-side validation\nEach step has tool field]
    VALIDATE --> WS_SEND[wsClient.send\nrun_json_plan payload]
    WS_SEND --> WS_HANDLER[websocket.py\nhandle_json_plan]
    WS_HANDLER --> CHECK{Valid steps?}
    CHECK -->|No| ERR[error → WS]
    CHECK -->|Yes| RUN[runtime.run_plan_directly\nsteps list + goal string]
    RUN --> EMIT_PLAN[Emit plan_created → WS]
    EMIT_PLAN --> EXEC_LOOP[Same execution loop\nas normal task]
    EXEC_LOOP --> DONE([Result → assistant_response])
```

> No LLM is called. No tokens consumed. Plan executes immediately.

---

## 7. Voice Input Pipeline

```mermaid
flowchart TD
    MIC([Microphone]) --> AUDIO[AudioCapture\ncontinuous stream]
    AUDIO --> WW[Wake Word Detector\nOpenWakeWord]
    AUDIO --> VAD[Voice Activity\nDetection]

    WW -->|detected| ACTIVATE[Activate full STT]
    VAD -->|speech end\nor 8s silence| FINALIZE[Finalize transcription]

    ACTIVATE --> STT_GATE{Echo Protection\nis_speaking?}
    STT_GATE -->|Yes, TTS active| DROP[Drop audio\navoid self-transcription]
    STT_GATE -->|No| DUAL_STT

    subgraph DUAL_STT[Dual STT]
        GOOGLE[Google STT\nCloud, fast]
        WHISPER[Whisper STT\nLocal, accurate]
    end

    DUAL_STT --> TRANSCRIPT[transcript_update → WS]
    TRANSCRIPT --> FE_DISPLAY[Frontend\nTranscriptView overlay]
    FINALIZE --> USER_MSG[user_message → WS\nTrigger agent]
```

---

## 8. Personalization → Prompt Pipeline

```mermaid
flowchart LR
    ONBOARD[OnboardingView\nSkills + Name + Instructions] -->|onComplete| APP[App.tsx\nsetPersonalization]
    APP -->|wsClient.send\nupdate_settings| BACKEND[websocket.py\nhandle_update_settings]
    BACKEND -->|save_settings_to_env| ENV[~/.config/opensarthi/.env]
    BACKEND -->|settings.reload| DEPS_UPDATE[Rebuild AgentDependencies\nskills + user_name + custom_prompt]

    DEPS_UPDATE --> NEXT_RUN[Next agent.run call]
    NEXT_RUN --> BUILD_PROMPT[build_system_prompt\nskills, user_name, custom_prompt]
    BUILD_PROMPT --> LLM[LLM receives\noptimized prompt]
```

### Skill → Prompt Feature Matrix

| Skill Selected | Effect on Prompt |
|---------------|-----------------|
| `desktop_automation` | JSON tool-call format + tool rules enabled |
| `developer` | Code quality hints, prefer terminal commands |
| `system_admin` | Direct shell command preference |
| `media` | Spotify/YouTube/media control guidance |
| `writing` | Text quality, multiple variants hint |
| `research` | Thorough analysis, source citation guidance |
| `web` | open_app → wait_for_window → type_text flow hint |
| `privacy` | Prefer local processing, data exposure warnings |
| None of above | Standard conversational response only |

---

## 10. Multi-Agent Orchestrator & Specialized Tools

OpenSarthi now utilizes a multi-agent orchestration architecture inspired by the GWEN framework.

### Orchestration Model
1. **Orchestrator Agent**:
   - Classifies user messages locally or via LLM into `CHAT`, `TASK`, or `CLARIFY`.
   - Compresses task execution history to avoid token bloat.
   - Spawns and manages sub-agents (e.g. `PlannerAgent`, `VerifierAgent`).

2. **Specialized Tools (Cross-Platform)**:
   - **`media_control`**: Controls media players via `playerctl` and system volume via `pactl`.
   - **`remember` / `recall`**: Interacts with the long-term semantic memory SQLite database to store and fetch user facts.
   - **`save_note` / `get_notes`**: Manages user notes as markdown files stored under `~/opensarthi_notes`.
   - **`self_fix`**: A self-healing developer utility. Runs typecheck verification, prompts the model to generate a correction code file, compile-checks the result, and automatically rolls back using backup files on failure.

---

## 9. Settings Sync Flow

```mermaid
sequenceDiagram
    participant FE as Frontend
    participant WS as websocket.py
    participant CFG as config.py
    participant RT as AgentRuntime

    FE->>WS: update_settings {model, keys, skills, ...}
    WS->>CFG: save_settings_to_env(payload)
    CFG-->>WS: settings updated
    WS->>RT: runtime.deps = AgentDependencies(skills=..., user_name=..., ...)
    WS->>FE: settings_sync {full current settings}
    FE->>FE: useAssistantStore.setPersonalization()
    FE->>FE: useAssistantStore.setActiveModels()
```

---

## 10. Token Tracking Flow

```mermaid
flowchart LR
    AGENT_RUN[agent.run completes] --> USAGE[result.usage\nrequest + response + total]
    USAGE --> DB[db.update_thread_tokens\naccumulate for thread_id]
    USAGE --> WS_RESP[assistant_response\npayload includes usage]
    WS_RESP --> STORE[assistantStore\nupdateTokenUsage]
    STORE --> HUD[HUD display\nTOKEN USAGE + SESSION TOTAL]

    HISTORY_LOAD[thread_loaded] --> DB_READ[db.get_thread_tokens\nstored token counts]
    DB_READ --> RESTORE[assistantStore\nrestoreThreadTokens]
    RESTORE --> HUD
```
