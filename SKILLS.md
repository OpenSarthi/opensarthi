# OpenSarthi — SKILLS.md

> **Purpose:** This file is the single source of truth for any LLM (Gemini, Claude, GPT, Copilot, Cursor, Codex, etc.) working on this codebase.  
> Read this **first** before writing or modifying any code. It captures architecture, conventions, invariants, contracts, and pitfalls that are not obvious from the code alone.

---

## 1. Project Identity

| Field | Value |
|-------|-------|
| **Name** | OpenSarthi |
| **Tagline** | AI-native Desktop & Android Agent — voice-first, autonomous, multi-platform |
| **What it is** | An autonomous, voice-first AI agent that executes system-level tasks, controls apps, interacts with the screen, sandboxes shell commands, and responds to natural voice input — on Linux desktop and Android |
| **What it is NOT** | A chatbot, a browser extension, an Electron app, or a cloud-hosted service |
| **Platforms** | Linux desktop (primary), Windows (in progress), Android (Capacitor + Chaquopy) |
| **License** | See `LICENSE` at repo root |

---

## 2. Architecture Mental Model

```
┌──────────────────────────────────────────────────────────┐
│               Tauri v2 Desktop Shell                     │
│         React 19 + TypeScript + Vite 6 (WebView)         │
│   Themes · HUD · Voice · Chat · Tasks · Onboarding       │
└───────────────────────┬──────────────────────────────────┘
                        │  WebSocket (ws://127.0.0.1:<port>/ws)
┌───────────────────────▼──────────────────────────────────┐
│              Python Runtime Sidecar                       │
│           FastAPI + PydanticAI + uvicorn                  │
│   Agent · Planner · Tools · Voice · Memory · Providers    │
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────┐
│           Android App (Capacitor + Chaquopy)              │
│   React 19 + TypeScript + Vite (WebView via Capacitor)   │
│   Mobile UI · Voice · Chat · Tasks · Onboarding          │
└───────────────────────┬──────────────────────────────────┘
                        │  WebSocket (ws://127.0.0.1:8765/ws)
┌───────────────────────▼──────────────────────────────────┐
│       Python Runtime (Chaquopy — runs in-process)         │
│           FastAPI + PydanticAI + uvicorn                  │
│   Android voice via SpeechRecognizer + TextToSpeech       │
└──────────────────────────────────────────────────────────┘
```

### Key Architectural Facts

1. **Two-process model (Desktop)** — Tauri (Rust + WebView) spawns the Python runtime as a sidecar process. They communicate exclusively over a **local WebSocket** on a dynamically negotiated port.
2. **In-process model (Android)** — Chaquopy embeds Python inside the APK. The Python FastAPI server runs in a `RuntimeService` foreground service on port 8765.
3. **No REST API** — All communication is WebSocket-based. There are no HTTP endpoints used by the frontend.
4. **Monorepo** — pnpm workspaces. `apps/desktop/` is the Tauri+React app. `apps/android/` is the Capacitor+React app. `runtime/` is the Python sidecar/embedded server.
5. **Linux-first, Windows in progress, Android active** — Android uses `OPENSARTHI_PLATFORM=android` env var to switch tool registry and voice pipeline.

---

## 3. Technology Stack (Exact Versions Matter)

### Frontend (`apps/desktop/`)

| Layer | Technology | Notes |
|-------|-----------|-------|
| Shell | **Tauri v2** | Not v1 — v2 has granular capabilities, different plugin API |
| UI | **React 19** | Uses concurrent features |
| Bundler | **Vite 6** | Config at `apps/desktop/vite.config.ts` |
| Language | **TypeScript** | Strict mode |
| State | **Zustand** | Single store: `assistantStore.ts` — NOT Redux, NOT Context |
| Animation | **Framer Motion** | AnimatePresence for route-level transitions |
| Styling | **Vanilla CSS** with CSS variables | 5 theme token sets in `styles/`. NOT Tailwind in production |
| Icons | **Lucide React** | |

### Backend (`runtime/`)

| Layer | Technology | Notes |
|-------|-----------|-------|
| Python | **3.12** | 3.14+ is NOT supported (no wheels for ML packages) |
| API | **FastAPI** + **uvicorn** | Single WebSocket endpoint at `/ws` |
| Agent | **PydanticAI ≥ 0.2** | `Agent` with `deps_type=AgentDependencies` |
| Validation | **Pydantic v2** | All schemas in `planner/schemas.py` |
| Config | **pydantic-settings** | Loads from `~/.config/opensarthi/.env` |
| DB | **SQLite** via **aiosqlite** | Chat history + token tracking |
| Voice STT | **SpeechRecognition** (Google) + **faster-whisper** (local) | Dual STT pipeline |
| ```
opensarthi/
├── apps/desktop/                    # Tauri v2 + React 19 frontend
│   ├── src/
│   │   ├── App.tsx                 # Root: onboarding gate + modal state + theme application
│   │   ├── components/
│   │   │   ├── assistant/          # AssistantOverlay (3-panel HUD + multi-tab), TaskList (+ JSON import)
│   │   │   ├── onboarding/         # OnboardingView (cold-start + edit mode)
│   │   │   ├── execution/          # ActionLog (tool execution timeline)
│   │   │   ├── permissions/        # PermissionDialog, InputDialog
│   │   │   └── settings/           # SettingsView, HistoryView
│   │   ├── hooks/
│   │   │   ├── useWebSocket.ts     # WS client, message routing, settings sync
│   │   │   └── useTauriEvent.ts    # Tauri IPC event listeners
│   │   ├── stores/
│   │   │   └── assistantStore.ts   # Zustand: messages, tabs, tokens, personalization, themes
│   │   ├── lib/
│   │   │   ├── ws.ts               # WebSocket client singleton
│   │   │   ├── schemas.ts          # Zod schemas for WS payloads
│   │   │   └── constants.ts        # Tauri event names, defaults
│   │   └── styles/                 # Global CSS + 6 theme token sets
│   └── src-tauri/
│       ├── src/
│       │   ├── lib.rs              # App entry, sidecar launch
│       │   ├── sidecar.rs          # Python process management & port detection
│       │   ├── tray.rs             # System tray
│       │   └── ipc.rs              # Tauri IPC commands
│       ├── binaries/               # Bootstrap script
│       └── resources/uv            # Bundled uv binary for Python management
│
├── runtime/                         # Python AI sidecar
│   ├── main.py                     # FastAPI app + port negotiation
│   ├── config.py                   # pydantic-settings (loads ~/.config/opensarthi/.env)
│   ├── db.py                       # SQLite: messages + thread token storage
│   ├── agent_runtime.py            # Stateful executor + self-heal (HealerAgent, ReviewerAgent)
│   ├── observation.py              # Desktop snapshot (screenshot + window info + AT-SPI + OCR)
│   ├── state_machine.py            # AgentState enum + AgentStateContext dataclass
│   ├── sync_primitives.py          # Async helpers: wait_for_window, wait_for_text
│   ├── api/
│   │   └── websocket.py            # Session, ConnectionManager, all WS message handlers
│   ├── agents/
│   │   ├── classifier.py           # LLM intent classification (CHAT/TASK/CLARIFY)
│   │   ├── orchestrator.py         # Message routing + context summarization
│   │   ├── healer.py               # HealerAgent: heuristic + LLM step correction
│   │   ├── reviewer.py             # ReviewerAgent: post-task lesson extraction
│   │   └── behavioral_observer.py  # BehavioralObserver: preference learning
│   ├── planner/
│   │   ├── agent.py                # PydanticAI Agent + build_system_prompt + build_structured_context
│   │   └── schemas.py              # Plan, PlanStep, ToolResult, ToolResultConfidence
│   ├── tools/
│   │   ├── base.py                 # BaseTool ABC + RiskLevel enum + safe_execute
│   │   ├── desktop.py              # click, type_text, press_key, open_app, click_element, focus_window
│   │   ├── system.py               # shell (with blocked patterns + sudo handling)
│   │   ├── wait_tools.py           # wait_for_window, wait_for_text
│   │   ├── memory.py               # remember, recall, forget_memory tools
│   │   ├── notes.py                # save_note, get_notes tools
│   │   ├── self_fix.py             # SelfFixTool: AI code rewrite + rollback
│   │   └── registry.py             # Tool registry (all_tools, get)
│   ├── memory/
│   │   ├── long_term.py            # Semantic SQLite memory (all-MiniLM-L6-v2 + cosine sim)
│   │   ├── manager.py              # Unified MemoryManager (recall, store)
│   │   └── passive.py              # Passive memory extraction hook
│   ├── providers/
│   │   └── linux/
│   │       └── accessibility.py    # AT-SPI via GObject Introspection
│   └── voice/
│       ├── stt.py                  # Dual STT: Google + Whisper
│       └── pipeline.py             # Wake word, VAD, echo protection, TTS
│
├── docs/                            # Technical documentation
│   ├── 01_frontend_and_desktop_shell.md
│   ├── 02_backend_runtime_and_infra.md
│   ├── 03_agentic_flow.md           # ← Updated with self-healing + self-improving flows
│   └── 04_websocket_protocol.md
│
├── package.json                     # pnpm workspace root
├── pnpm-workspace.yaml
├── SKILLS.md                        # ← YOU ARE HERE
└── README.md
```── desktop.py              # click, type_text, press_key, open_app, click_element, focus_window
│   │   ├── system.py               # shell (with blocked patterns + sudo handling)
│   │   ├── wait_tools.py           # wait_for_window, wait_for_text
│   │   └── registry.py             # Tool registry (all_tools, get)
│   ├── providers/
│   │   └── linux/
│   │       └── accessibility.py    # AT-SPI via GObject Introspection
│   └── voice/
│       ├── stt.py                  # Dual STT: Google + Whisper
│       └── pipeline.py             # Wake word, VAD, echo protection, TTS
│
├── docs/                            # Technical documentation
│   ├── 01_frontend_and_desktop_shell.md
│   ├── 02_backend_runtime_and_infra.md
│   ├── 03_agentic_flow.md
│   └── 04_websocket_protocol.md
│
├── package.json                     # pnpm workspace root
├── pnpm-workspace.yaml
├── SKILLS.md                        # ← YOU ARE HERE
└── README.md
```

---

## 5. The Agent Loop — How It Actually Works

This is the most critical section. Every LLM working on this project must understand this flow.

### 5.1 Message Entry Point

```
User input (text or voice)
    → WebSocket message { type: "user_message" }
    → Session.handle_user_message()
    → Builds the active model based on provider setting
    → Creates AgentRuntime instance
    → Calls runtime.run(goal, model, message_history)
```

### 5.2 AgentRuntime.run() — The Core Loop

```
1. Take desktop snapshot (observation.py)
2. Auto-recall memories:
   a. Top-5 semantic memories (cosine search against the goal)
   b. All [PREFERENCE] memories from behavioral_observer (always injected)
3. Build structured context string (planner/agent.py::build_structured_context)
   — injects: goal, desktop state, USER PREFERENCES, RELEVANT PAST EXPERIENCE,
     execution history, available tools, permissions
4. Call LLM via PydanticAI agent.run()
5. Parse response:
   — If plain text → fire BehavioralObserver (background) → return as assistant_response (chat mode)
   — If JSON array/object → parse into Plan with PlanStep objects (task mode)
6. Decompose steps into parallel groups via topological sorting (decomposer.py).
7. Concurrently execute steps within each parallel group (asyncio.gather):
   a. Check cancel/pause flags
   b. Look up tool from registry
   c. Call tool.safe_execute(args, permission_manager)
   d. Emit tool_started → tool_completed/tool_error via WS
   e. On failure: HealerAgent.diagnose_and_fix() → try corrected step before retrying
   f. Track completed_actions / failed_actions
8. If any step fails AND retry < max_replanning_attempts (3):
   → Loop back to step 1 (replan with failure context)
9. On task end (success or final failure):
   → Fire ReviewerAgent.review_and_learn() (background — extracts lessons)
   → Fire BehavioralObserver.observe_and_store() (background — detects preferences)
10. Format and return final response with ✓/❌ summary
```

### 5.3 Chat vs. Task Classification

The **LLM itself** decides — there is NO separate classifier model. The system prompt contains instructions:
- If the response is plain text → it's a chat response
- If the response contains a JSON array of `{tool, args, description}` objects → it's a task plan

**Critical:** When `desktop_automation` skill is **not** selected, the JSON tool-call format is **removed from the prompt entirely** — the LLM physically cannot output task plans.

### 5.4 JSON Plan Direct Execution (Import Mode)

Users can paste raw JSON step arrays in the frontend. These bypass LLM planning entirely:
```
Frontend → run_json_plan WS message → runtime.run_plan_directly(steps, goal)
```
No LLM is called. No tokens consumed. Steps execute immediately.

---

## 6. Tool System — Contracts & Invariants

### 6.1 Tool Architecture

```python
BaseTool (ABC)
├── name: str              # Registry key, used in JSON plans
├── description: str       # Shown to LLM for tool selection
├── risk_level: RiskLevel  # SAFE | MODERATE | DANGEROUS | FORBIDDEN
├── execute(args) → ToolResult          # Core implementation
└── safe_execute(args, pm) → ToolResult # Permission-checked wrapper
```

### 6.2 Registered Tools

| Tool | Name | Risk | Args |
|------|------|------|------|
| Click | `click` | MODERATE | `x: int, y: int, button?: str` |
| Type Text | `type_text` | MODERATE | `text: str` |
| Press Key | `press_key` | MODERATE | `key: str` |
| Open App | `open_app` | MODERATE | `app: str` |
| Focus Window | `focus_window` | MODERATE | `title: str` |
| Click Element | `click_element` | MODERATE | `role: str, name: str` |
| Shell | `shell` | DANGEROUS | `command: str, timeout?: float` |
| Wait for Window | `wait_for_window` | SAFE | `title: str, timeout?: float` |
| Wait for Text | `wait_for_text` | SAFE | `text: str, timeout?: float` |
| Remember | `remember` | SAFE | `fact: str, importance?: float` |
| Recall | `recall` | SAFE | `query: str` |
| Forget Memory | `forget_memory` | SAFE | `query: str` |
| Save Note | `save_note` | SAFE | `title: str, content: str` |
| Get Notes | `get_notes` | SAFE | `query?: str` |
| Self Fix | `self_fix` | DANGEROUS | `description: str, target_file: str` |

### 6.3 ToolResult Contract

Every tool returns a `ToolResult`:
```python
ToolResult(
    success: bool,
    observation: str | None,      # Human-readable description of what happened
    error: str | None,            # Error message if failed
    retryable: bool = True,       # Can the agent retry this step?
    confidence: HIGH | MEDIUM | LOW,
    suggested_next: str | None,   # Hint for the agent's next action
    ui_changed: bool | None,      # Did the screen change?
    raw_output: Any | None,       # Machine-readable output
)
```

**Invariant:** Use `ToolResult.ok()` / `ToolResult.fail()` class methods. Never construct ToolResult with `success=True` and a non-None `error`, or `success=False` without an `error`.

### 6.4 Adding a New Tool — Checklist

1. Create a class extending `BaseTool` in the appropriate file under `runtime/tools/`
2. Set `name`, `description`, `risk_level` as class attributes
3. Implement `async def execute(self, args: dict) -> ToolResult`
4. Register it in `runtime/tools/registry.py`
5. Add an args hint in `planner/agent.py::_args_hint()` so the LLM knows the signature
6. If DANGEROUS, the `safe_execute` wrapper will automatically request user permission via WebSocket

---

## 7. Desktop Provider System

### 7.1 Provider Detection

```python
# In desktop.py
def get_desktop_provider() -> DesktopProvider:
    if platform.system() == "Windows":
        return PyAutoGUIProvider()
    if os.environ.get("WAYLAND_DISPLAY"):
        return YdotoolProvider()
    else:
        return XdotoolProvider()
```

### 7.2 Provider Capabilities

| Capability | X11 (xdotool) | Wayland (ydotool) | Windows (pyautogui) |
|-----------|---------------|-------------------|---------------------|
| click | ✅ | ❌ (stub) | ✅ |
| type_text | ✅ | ✅ | ✅ |
| press_key | ✅ | ✅ | ✅ |
| capture_screen | ✅ (mss) | ✅ (mss) | ✅ (pyautogui) |
| Window focus | ✅ (wmctrl/xdotool) | ❌ | ❌ |

**Invariant:** Provider is selected **once** at module load time (`_provider = get_desktop_provider()`). It does not change during runtime.

---

## 8. WebSocket Protocol

### 8.1 Envelope Format

```json
{
  "id": "uuid-v4",
  "type": "message_type",
  "payload": { ... },
  "timestamp": 1748600000000
}
```

### 8.2 Frontend → Backend Messages

| Type | Purpose | Key Payload Fields |
|------|---------|-------------------|
| `user_message` | User text/voice input | `text`, `thread_id`, `source` |
| `run_json_plan` | Direct plan execution | `goal`, `steps[]` |
| `cancel_execution` | Kill in-flight LLM + tool | — |
| `pause_execution` | Pause after current step | — |
| `resume_execution` | Resume paused execution | — |
| `update_settings` | Save provider/model/keys/skills | all settings fields |
| `get_history` | List all threads | — |
| `load_thread` | Load specific thread | `thread_id` |
| `new_chat` | Create new thread | — |
| `delete_thread` | Delete thread | `thread_id` |
| `delete_all_threads` | Clear all history | — |
| `permission_response` | User approved/denied action | `request_id`, `approved` |
| `input_response` | User text input (e.g. sudo password) | `request_id`, `value` |
| `speak_text` | Trigger TTS playback | `text` |
| `stop_speech` | Stop active TTS | — |
| `voice_state` | Manual mic toggle | `state: "listening"\|"idle"` |

### 8.3 Backend → Frontend Messages

| Type | Purpose | Key Payload Fields |
|------|---------|-------------------|
| `assistant_response` | Final LLM response | `content`, `usage{request_tokens, response_tokens, total_tokens}` |
| `plan_created` | Agent generated a plan | `id`, `goal`, `steps[]`, `recovery_hint` |
| `tool_started` | Step execution began | `step_index` |
| `tool_completed` | Step succeeded | `step_index`, `result` |
| `tool_error` | Step failed | `step_index`, `error` |
| `tool_terminated` | Step cancelled | `step_index` |
| `tool_action` | Live progress for ActionLog | `tool`, `description`, `status` |
| `agent_state` | State machine transition | `state`, `goal`, `step`, `total_steps`, `error` |
| `permission_request` | Dangerous action needs approval | `request_id`, `tool`, `args`, `risk_level` |
| `input_request` | Agent needs user text input | `request_id`, `prompt` |
| `settings_sync` | Full settings on connect/update | all settings fields |
| `history_response` | Thread list | `threads[]` |
| `thread_loaded` | Thread messages + tokens | `thread_id`, `messages[]`, `token_totals` |
| `voice_state` | Voice pipeline state change | `state` |
| `transcript_update` | Live STT result | `text`, `engine`, `is_final` |
| `speech_started`/`speech_completed` | TTS lifecycle | — |
| `task_paused`/`task_resumed` | Execution control | — |
| `error` | System error | `message`, `code` |

---

## 9. State Machine

The agent runtime has a formal state machine (`state_machine.py`):

```
IDLE → PLANNING → EXECUTING → COMPLETE → IDLE
                ↕              ↕
             OBSERVING      WAITING
                            RETRYING
                        ASKING_PERMISSION
                            ERROR
```

### States

| State | Meaning |
|-------|---------|
| `idle` | No active task |
| `listening` | Voice pipeline active |
| `planning` | LLM generating plan |
| `executing` | Running a tool step |
| `waiting` | Explicit wait (wait_after on PlanStep) |
| `observing` | Taking desktop snapshot |
| `retrying` | Step failed, retrying |
| `asking_permission` | Dangerous tool awaiting user approval |
| `error` | Unrecoverable failure |
| `complete` | Goal achieved |

**Invariant:** Every state transition calls `await self.ws.emit_state(self.state)` to broadcast to the frontend.

---

## 10. Skill-Aware Dynamic Prompt System

The system prompt is **not static**. It is built at runtime by `planner/agent.py::build_system_prompt()` based on the user's selected skills.

### Skill → Prompt Effect Matrix

| Skill | Effect |
|-------|--------|
| `desktop_automation` | Enables JSON tool-call format + tool rules + available tools section |
| `developer` | Code quality hints, prefer terminal commands |
| `system_admin` | Direct shell command preference |
| `media` | Spotify/YouTube/media control guidance |
| `writing` | Text quality, multiple variants hint |
| `research` | Thorough analysis, source citation guidance |
| `web` | Browser automation flow: open_app → wait_for_window → type_text |
| `privacy` | Prefer local processing, data exposure warnings |

**Critical:** If `desktop_automation` is NOT in the user's skills, the **entire tool-call JSON format is removed** from the prompt. The LLM cannot generate task plans. This is a token-saving optimization.

### Structured Context

Before every `agent.run()`, `build_structured_context()` injects:
- Current goal
- Desktop state (active window, focused element, accessibility tree summary)
- Execution context (completed/failed actions, retry count)
- Available tools with signatures and risk levels (only if desktop_automation skill is active)
- Constraints

---

## 11. Cancellation & Pause Architecture

### Cancel Path
```
Frontend cancel button
  → cancel_execution WS message
  → runtime.request_cancel()
  → Sets _cancel_requested = True
  → Cancels _agent_task (LLM inference) via asyncio.Task.cancel()
  → Cancels _tool_task (tool execution) via asyncio.Task.cancel()
  → CancelledError caught in run loop
  → Emits tool_terminated for remaining steps
```

### Pause Path
```
pause_execution → runtime.pause() → clears asyncio.Event
  → Execution blocks at _check_pause() before next step
resume_execution → runtime.resume() → sets asyncio.Event
  → Execution continues
```

**Invariant:** `request_cancel()` also sets the pause event to unblock any paused execution, preventing deadlock.

---

## 12. Configuration & Settings

### Config File Location
- **Runtime:** `~/.config/opensarthi/.env` (Linux) or `%LOCALAPPDATA%/opensarthi/.env` (Windows)
- **Dev fallback:** `runtime/.env`

### Config Flow
```
Frontend settings modal
  → update_settings WS message
  → websocket.py updates settings object in-memory
  → save_settings_to_env() writes to .env file
  → Deps rebuilt with new skills/name/prompt
  → settings_sync sent back to frontend
```

### Supported Providers

| Provider | Config Key | Model Config | Base URL |
|----------|-----------|-------------|----------|
| Ollama | `ollama` | `local_model` | `http://localhost:11434` |
| Google Gemini | `google` | `cloud_model` | PydanticAI default |
| OpenAI | `openai` | `cloud_model` | `https://api.openai.com/v1` |
| Anthropic | `anthropic` | `cloud_model` | PydanticAI default |
| Groq | `groq` | `cloud_model` | `https://api.groq.com/openai/v1` |
| OpenRouter | `openrouter` | `cloud_model` | `https://openrouter.ai/api/v1` |

**Invariant:** Groq, OpenAI, and OpenRouter all use `OpenAIModel` with `OpenAIProvider` and different `base_url`s. Anthropic and Google use their native PydanticAI models.

---

## 13. Security Model

### Risk Levels & Permissions
```
SAFE       → Auto-execute (read-only: screenshots, window queries)
MODERATE   → Auto-execute (typing, clicking, app launching)
DANGEROUS  → Requires explicit user permission via WebSocket dialog
FORBIDDEN  → Never auto-execute
```

### Shell Safety
- Blocked patterns: `rm -rf /`, `mkfs.`, `dd if=...of=/dev/`, fork bombs, `chmod -R 777 /`, `> /dev/sd`
- Windows-specific blocks: `format C:`, `del /s /q`
- Sudo commands trigger `input_request` for password (piped via `echo | sudo -S`)
- Default timeout: 30 seconds
- Planned: bubblewrap (`bwrap`) sandboxing (see `docs/02_backend_runtime_and_infra.md`)

---

## 14. Voice Pipeline

### Architecture
```
Microphone
  → OpenWakeWord (always listening, low CPU)
  → On trigger: activate full STT
  → Dual STT: Google SpeechRecognition (fast) + Whisper (accurate, local)
  → transcript_update WS messages
  → On finalization: user_message WS message → agent
  → Response → Kokoro TTS → speech_started/speech_completed WS
```

### Echo Protection
- `is_speaking` flag prevents self-transcription during TTS playback
- Audio buffer is dropped when TTS is active

### Manual Mode
- Frontend mic button sends `voice_state: "listening"` / `"idle"`
- Bypasses wake word, directly activates STT

---

## 15. Frontend Architecture

### Zustand Store (`assistantStore.ts`)

Single store manages:
- `messages[]` — chat messages for current thread
- `currentPlan` / `planSteps[]` — active execution plan
- `tokenUsage` — per-request and session-total token counts
- `activeProvider` / `activeLocalModel` / `activeCloudModel` — model settings
- `onboardingCompleted` — cold-start gate
- `personalization` — user name, skills, custom prompt
- `activeTheme` — one of 5 theme token sets

### Theme System

5 built-in themes via CSS custom properties on `document.body`:
- `theme-red-black` (Glass Red — default)
- `theme-green-black` (Forest Green)
- `theme-purple-black` (Deep Purple)
- `theme-sky-white` (Cyber Sky)
- `theme-pink-white` (Sakura Pink)

**Convention:** Theme is applied by toggling class on `document.body`. All CSS uses `var(--token-name)`.

### Three-Panel HUD Layout

```
┌──────────────┬────────────────────┬──────────────────┐
│ Agent Tasks  │      Chat          │ Live Plan &      │
│ (left panel) │    (center)        │ Activity (right) │
│              │                    │                  │
│ + JSON       │ Messages + Input   │ ActionLog        │
│   Import     │ + Voice Button     │ + Token Counter  │
└──────────────┴────────────────────┴──────────────────┘
```

---

## 16. Database Schema

SQLite at `~/.config/opensarthi/opensarthi.db`:

### Tables (from `db.py`)
- **messages** — `id, thread_id, role, content, timestamp`
- **threads** — `id, title, created_at, updated_at`
- **thread_tokens** — `thread_id, request_tokens, response_tokens, total_tokens`

### Token Tracking
- Tokens are accumulated per `thread_id` via `db.accumulate_thread_tokens()`
- On `thread_loaded`, stored token counts are sent to frontend for HUD restoration
- Each `assistant_response` includes per-request `usage` object

---

## 17. Build & Distribution

### Development
```bash
pnpm install            # JS dependencies
cd runtime && python3.12 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cd ..
pnpm dev                # Starts Tauri dev + Python sidecar
```

### AppImage Build
```bash
PATH="$(pwd)/apps/desktop/src-tauri/mock_pkg_config:$PATH" \
NO_STRIP=true \
APPIMAGE_EXTRACT_AND_RUN=1 \
pnpm tauri build -b appimage
```

### Portable Bootstrap (AppImage)
- Auto-creates venv using bundled `uv` binary
- Downloads Python 3.12 if not present
- Validates core imports before reusing cached venv (stale venv detection)
- All user data in `~/.config/opensarthi/` (never in read-only AppImage mount)

---

## 18. Critical Invariants & Patterns

These are rules that **must not be violated**. Breaking them will cause subtle bugs or architectural regression.

### Code Patterns

1. **All tool classes must extend `BaseTool`** and implement `async execute(self, args: dict) -> ToolResult`. Use `ToolResult.ok()` / `ToolResult.fail()` factory methods.

2. **Never call `os.system(llm_output)` or `subprocess.run()` directly with LLM output.** All shell execution goes through `ShellTool` which has blocked pattern checks and permission gating.

3. **The `agent` object in `planner/agent.py` is a global singleton.** Don't create new Agent instances per request — reuse the singleton and pass different `model` and `deps` at call time.

4. **Provider model construction happens in `websocket.py::handle_user_message()`**, not in `agent.py`. The agent itself is model-agnostic.

5. **`_parse_response()` in `agent_runtime.py` is highly resilient.** It handles: plain JSON arrays, JSON objects with `steps` key, single-step objects, `action`→`tool` aliasing, `comment`→`description` aliasing, list-based args→dict conversion. Don't simplify this without understanding all LLM output variations.

6. **WebSocket message handlers in `process_incoming()` must be non-blocking for long-running operations.** Use `asyncio.create_task()` for operations like `handle_json_plan`. The `handle_user_message` is awaited directly (blocking is acceptable — one message at a time per session).

### Naming Conventions

| Context | Convention | Example |
|---------|-----------|---------|
| Python files | `snake_case.py` | `agent_runtime.py` |
| Python classes | `PascalCase` | `AgentRuntime`, `BaseTool` |
| TypeScript files | `camelCase.ts` / `PascalCase.tsx` | `useWebSocket.ts`, `App.tsx` |
| WS message types | `snake_case` | `user_message`, `tool_completed` |
| CSS themes | `theme-{color}-{bg}` | `theme-red-black` |
| Tool names | `snake_case` | `open_app`, `type_text`, `wait_for_window` |

### Error Handling Patterns

- **LLM errors:** Network errors (`ConnectTimeout`, `ReadTimeout`, etc.) are re-raised to propagate to the WS error handler. Non-network errors are caught and returned as formatted strings.
- **Tool errors:** Always return `ToolResult.fail()`, never raise. The `safe_execute` wrapper catches unexpected exceptions.
- **WS errors:** Catch at `process_incoming` level, emit `error` message to frontend.

---

## 19. Known Pitfalls & Gotchas

1. **Python 3.14+ breaks everything.** No pre-compiled wheels for `faster-whisper`, `kokoro`, `numpy`. Stick to 3.12.

2. **`xdotool` only works on X11.** On Wayland, `ydotool` is used but `click()` is a no-op stub. Don't write tests that assume clicking works on Wayland.

3. **The `_provider` in `desktop.py` is module-level.** It's set once at import time. If the display server changes (e.g., switching from X11 to Wayland session), the provider won't update until restart.

4. **`save_settings_to_env()` is called BEFORE personalization fields are updated** in `handle_update_settings()`. This is a known ordering issue — personalization writes happen after the env file is saved, so they're saved on the *next* settings update.

5. **Token tracking returns 0 for Ollama** (local models). PydanticAI's usage data may be `None` for Ollama.

6. **`message_history` uses a 20-message sliding window.** Very long conversations lose earlier context. This is intentional to stay within context limits.

7. **OpenWakeWord phrases are hot-reloaded** via `voice_pipeline.wake_detector.update_phrases()` when settings are updated. But if the pipeline isn't initialized yet, this silently fails.

8. **`mock_pkg_config` in build command** is needed because Arch Linux returns incorrect paths for `pkg-config --variable=gdk_pixbuf_binarydir`.

9. **`open_app` has an extensive alias table** — LLMs often generate display names like "Chrome" instead of binary names like "google-chrome-stable". The alias table handles this, but new apps need to be added manually.

10. **Sudo password handling** pipes the password via `echo | sudo -S`, which is visible in process listings. This is a known security concern documented for future improvement.

---

## 20. Roadmap & Status

### ✅ Implemented (Active)

| Directory / File | Status | Purpose |
|---|---|---|
| `runtime/agents/healer.py` | **Active** | Self-Healing Agent: heuristic + LLM diagnosis, corrects failed steps |
| `runtime/agents/reviewer.py` | **Active** | Self-Improving Reviewer: extracts lessons post-task into long-term memory |
| `runtime/agents/behavioral_observer.py` | **Active** | Preference learning from conversation patterns |
| `runtime/memory/long_term.py` | **Active** | Semantic SQLite memory with all-MiniLM-L6-v2 embeddings + cosine sim |
| `runtime/tools/memory.py` | **Active** | remember, recall, forget_memory tools |
| `runtime/tools/self_fix.py` | **Active** | AI-powered code rewrite + compile verify + rollback |
| `runtime/tools/notes.py` | **Active** | save_note, get_notes |

### 🚧 Stubs / Planned

| Directory | Status | Purpose |
|---|---|---|
| `runtime/security/` | Stub | bubblewrap sandboxing (currently direct shell execution) |
| `runtime/mcp/` | Stub | Model Context Protocol server/client |

### Planned Features
- [x] Parallel task execution (`depends_on` in PlanStep + `asyncio.gather`)
- [ ] ElevenLabs streaming TTS
- [ ] Web Search Tool (Tavily/Brave)
- [ ] Morning Briefing
- [ ] MCP Server (expose tools as MCP)
- [ ] API Key Keyring (libsecret migration from plaintext .env)
- [ ] Wayland Window Tracking (ydotool for KDE/GNOME)

---

## 21. Testing

- Test directory: `runtime/tests/`
- No frontend test suite currently
- Backend tests focus on tool execution, plan parsing, and config management
- Run with: `cd runtime && python -m pytest tests/`

---

## 22. How to Use This File

### For LLMs / AI Coding Assistants

1. **Read sections 5–6 first** (Agent Loop + Tool System) — this is where most bugs and features live
2. **Check section 8** (WebSocket Protocol) before modifying any message handler
3. **Check section 18** (Critical Invariants) before any refactor
4. **Check section 19** (Pitfalls) when debugging unexpected behavior
5. **Check section 4** (File Ownership) to know which file to modify

### For Human Contributors

1. Start with the README for the overview
2. Read `docs/03_agentic_flow.md` for flowcharts
3. Read this SKILLS.md for the invariants and pitfalls that aren't in the code
4. Check `docs/04_websocket_protocol.md` for the full message reference

---

## 23. Android Platform

### 23.1 Architecture

| Component | Technology | Notes |
|-----------|-----------|-------|
| App Shell | **Capacitor v5** | Wraps React WebView in native Android Activity |
| UI | **React 19 + TypeScript** | Same design language as desktop; single-column mobile layout |
| Python Runtime | **Chaquopy 14.0** | Embeds Python 3.11 inside the APK; runs FastAPI in-process |
| Voice STT | **Android SpeechRecognizer** | Native OS API; rearmed continuously for always-on listening |
| Voice TTS | **Android TextToSpeech** | Native OS API; called from `AndroidVoiceBridge.kt` |
| Automation | **AccessibilityService** | Required for click/type/scroll automation (user must enable) |
| Background | **RuntimeService** | Foreground service keeps Python runtime alive when backgrounded |

### 23.2 Key Files

| File | Purpose |
|------|---------|
| `apps/android/src/components/mobile/MobileAssistant.tsx` | Main mobile UI (chat + voice + execution sheet) |
| `apps/android/src/components/mobile/SettingsView.tsx` | Mobile settings (provider, model, keys, voice, theme) |
| `apps/android/src/components/mobile/SplashScreen.tsx` | React loading splash shown while WS connects |
| `apps/android/android/app/src/main/java/dev/opensarthi/android/AndroidVoiceBridge.kt` | Singleton for STT + TTS; rearmed after each transcript |
| `apps/android/android/app/src/main/java/dev/opensarthi/android/RuntimeService.kt` | Foreground service that starts the Python FastAPI server |
| `apps/android/android/app/src/main/java/dev/opensarthi/android/MainActivity.kt` | BridgeActivity; initializes voice bridge + starts service |
| `runtime/main_android.py` | Android entry point; patches tool registry; starts uvicorn |
| `runtime/voice/android_bridge.py` | Python ↔ Kotlin voice bridge (STT queue + TTS async) |
| `runtime/tools/android/` | Android-specific tool implementations |

### 23.3 Android Voice Pipeline Flow

```
SpeechRecognizer (Kotlin, always armed)
  → onResults → sendTranscriptToPython()
  → voice/android_bridge.py :: _on_transcript()
  → _active_pipeline._transcript_queue.put_nowait(text)
  → AsyncIterator in start_listening() yields transcript
  → websocket.py :: _listen_loop() sends transcript_update WS msg
  → React frontend checks for wake word in transcript_update handler
  → If wake word matched → setVoiceState("listening") + setTranscript(clean)
  → Silence timer fires → handleVoiceSend(finalTranscript)
  → user_message WS → agent processes → assistant_response
  → speak_text WS → voice/android_bridge.py :: speak(text)
  → AndroidVoiceBridge.kt :: speak() → TextToSpeech.speak()
  → onDone callback → asyncio event set → pipeline unblocks
  → speech_completed WS → frontend updates state
```

### 23.4 Android Tool Registry

Tools are patched at startup in `main_android.py → _patch_android_tools()`:
- Desktop-only tools (`click`, `open_app`, `shell`, etc.) are replaced with Android stubs or accessibility-backed implementations
- The `OPENSARTHI_PLATFORM=android` env var gates these overrides
- Android tools live in `runtime/tools/android/`

### 23.5 Android Build System

```
apps/android/
├── android/                     # Native Android project (Gradle)
│   ├── app/build.gradle         # Chaquopy config, APK signing, dependencies
│   ├── gradle.properties        # JVM heap: -Xmx4096m (needed for asset compression)
│   └── app/src/main/
│       ├── AndroidManifest.xml  # Permissions: RECORD_AUDIO, FOREGROUND_SERVICE, etc.
│       ├── res/values/
│       │   ├── styles.xml       # Splash screen theme (Theme.SplashScreen)
│       │   └── colors.xml       # Brand colors (#050905 dark bg)
│       └── java/dev/opensarthi/android/
│           ├── MainActivity.kt
│           ├── RuntimeService.kt
│           ├── AndroidVoiceBridge.kt
│           └── OpenSarthiApp.kt
└── src/                         # React/TypeScript source
    ├── App.tsx                  # Root: WS setup + modal routing
    ├── components/mobile/       # MobileAssistant, SettingsView, SplashScreen, etc.
    ├── lib/                     # ws.ts, schemas.ts
    └── stores/                  # assistantStore (shared with desktop)
```

Build command:
```bash
cd apps/android
npm run build            # Build React assets
npx cap sync android     # Sync to native project
cd android
./gradlew assembleRelease --no-daemon
```

### 23.6 Android-specific Invariants

1. **`AndroidVoiceBridge` is a singleton** initialized once in `MainActivity.onCreate()`. Never re-create it.
2. **SpeechRecognizer must run on main thread** — `rearmRecognizer()` is always posted via `mainHandler.post()`.
3. **`OPENSARTHI_PLATFORM=android`** must be set before any tool or voice import. It is set in `main_android.py`.
4. **Continuous listening** = SpeechRecognizer is always rearmed after each result (via `rearmRecognizer()` on the Kotlin side). The Python/React side controls whether transcripts trigger commands via wake-word gating.
5. **TTS blocks STT** — `AndroidVoiceBridge.speak()` calls `speechRecognizer.stopListening()` first; it rearmed in `onDone` callback after speech completes.
6. **Gradle heap must be ≥ 4096m** (`org.gradle.jvmargs=-Xmx4096m`) to avoid `Java heap space` error during `compressReleaseAssets`.

### 23.7 Separate Repo Decision

**Recommendation: Keep in monorepo.** The Android app shares:
- The entire `runtime/` Python codebase
- The `assistantStore.ts` Zustand store
- WebSocket protocol (identical message format)
- Design system (CSS variables, themes, fonts)

A separate repo would require maintaining two copies of the runtime and duplicating schema changes. The monorepo approach with `apps/android/` is the correct structure.

---

> **Maintained by:** The OpenSarthi team. Update this file when adding new tools, message types, providers, or architectural changes.
