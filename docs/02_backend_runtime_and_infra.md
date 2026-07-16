# OpenSarthi — Backend Runtime & Infrastructure

> **Updated:** July 2026 — Dual execution engine (AgentRuntime + LangGraph), SileroVAD ONNX (no PyTorch), 32-tool registry, conversational settings tool, long-term memory toggle + model caching, DevLogger structured run logs, smart overlay minimize, cancellation/pause architecture, token tracking, and Android Chaquopy path.

---

## 1. Architecture Overview

```
FastAPI (main.py)
├── WebSocket endpoint: /ws          (api/websocket.py)
├── HTTP endpoints: /health, /port   (main.py)
└── CORS: all origins (localhost only in production)
                │
     ┌──────────┴───────────────┐
     ▼                          ▼
AgentRuntime              LangGraph Graph
(agent_runtime.py)        (graph/graph.py)
[USE_LANGGRAPH=false]     [USE_LANGGRAPH=true]
     │                          │
     └──────────┬───────────────┘
                │ (both engines share)
     ┌──────────┴────────────────────────────┐
     │           Shared Services             │
     ├── planner/agent.py  (PydanticAI)      │
     ├── tools/registry.py (32 tools)        │
     ├── memory/manager.py (semantic SQLite) │
     ├── observation.py    (desktop snapshot)│
     ├── voice/pipeline.py (full pipeline)   │
     └── config.py + db.py (settings + data) │
     └───────────────────────────────────────┘
```

---

## 2. FastAPI Server (`main.py`)

### Startup Sequence

1. Load settings from `~/.config/opensarthi/.env` via `pydantic-settings`
2. Initialize SQLite database (`db.py`)
3. Initialize `MemoryManager` (loads `SentenceTransformer` **only** if `long_term_memory_enabled=True`)
4. Boot voice pipeline (`VoicePipeline.initialize()`) in background thread
5. Bind to a free OS port → print `PORT:<n>` to stdout (Tauri reads this)
6. Start Uvicorn ASGI server

### HTTP Endpoints

| Endpoint | Method | Purpose |
|---------|--------|---------|
| `/` | GET | Health check |
| `/health` | GET | Returns `{status: "ok"}` |
| `/port` | GET | Returns `{port: <n>}` |

### CORS Policy

CORS configured with `allow_origins=["*"]` — this is safe because the server binds to `127.0.0.1` only and is not reachable externally.

---

## 3. WebSocket Handler (`api/websocket.py`)

All agent interaction flows through a single persistent WebSocket connection per client.

### Connection Lifecycle

```
Client connects
    ↓
ws_handler.emit_state(IDLE)  ← initial state broadcast
    ↓
Emit settings_sync  ← full settings snapshot
    ↓
Recv/Send loop (asyncio)
    ↓
Client disconnects → cleanup active tasks
```

### Message Routing

| Message Type | Handler |
|-------------|---------|
| `user_message` | Classify → AgentRuntime or LangGraph |
| `run_json_plan` | Direct plan execution (no LLM) |
| `cancel_execution` | `AgentRuntime.request_cancel()` |
| `pause_execution` | `AgentRuntime.pause()` |
| `resume_execution` | `AgentRuntime.resume()` |
| `update_settings` | `save_settings_to_env()` → rebuild deps → `settings_sync` |
| `get_history` | `db.get_threads()` |
| `load_thread` | `db.load_messages()` + token restore |
| `permission_response` | Forward to pending permission gate |
| `input_response` | Forward to pending input gate |
| `manual_voice_trigger` | Start STT via VoicePipeline |

### WebSocket Handler (`WSHandler` class)

`WSHandler` wraps the raw `WebSocket` object and provides:
- `send_message(type, payload)` — typed async send
- `emit_state(AgentStateContext)` — state machine broadcast
- `check_pause(thread_id)` — blocks if paused
- `request_permission(tool, description, risk, args)` — shows PermissionDialog
- `request_input(prompt, field, sensitive)` — shows InputDialog

---

## 4. Dual Execution Engine

### Engine Selection

```python
USE_LANGGRAPH = os.getenv("USE_LANGGRAPH", "false").lower() == "true"
```

Both engines receive identical inputs and emit identical WebSocket events.

### AgentRuntime (`agent_runtime.py`)

Self-contained stateful execution loop. Features:
- **Cancel:** `request_cancel()` → sets `_cancel_event` → `asyncio.Task.cancel()` on both LLM and tool tasks
- **Pause:** `pause()` / `resume()` → `asyncio.Event` used at the top of each loop iteration
- **Parallel execution:** Topological sort (via `decomposer.py`) groups independent steps for concurrent execution
- **Self-healing:** `HealerAgent.diagnose_and_fix()` called synchronously on step failure
- **Memory:** Auto-recalls top-8 semantic + all preference entries before every planning call

### LangGraph (`graph/`)

Compiled `StateGraph` for advanced stateful orchestration:

```python
workflow = StateGraph(OpenSarthiState)
workflow.add_node("classify", classify_node)
workflow.add_node("observe", observe_node)
workflow.add_node("plan", plan_node)
workflow.add_node("execute", execute_step_node)
workflow.add_node("heal", heal_node)
workflow.add_node("replan", replan_node)
workflow.add_node("review", review_node)
workflow.add_node("chat", chat_node)
```

Nodes emit the same WebSocket events as AgentRuntime nodes. The `replan_node` increments `retry_count` and resets `plan_steps` to trigger a new `observe → plan` cycle.

---

## 5. Planner (`planner/`)

### PydanticAI Agent (`planner/agent.py`)

The planner uses a **single PydanticAI `Agent`** instance that:
1. Receives a fully-structured context (goal + snapshot + history + memories + skills)
2. Responds with a JSON `Plan` object (list of `PlanStep`) OR direct text for chat

```python
agent = Agent(
    model=model,                        # dynamic, from config
    system_prompt=build_system_prompt(skills),  # skill-aware
    output_type=Union[Plan, str],       # structured or conversational
)
```

### System Prompt Construction (`build_system_prompt`)

The system prompt is built **at runtime** based on user skills:
- `desktop_automation` skill → includes tool-call JSON format instructions
- `developer` skill → adds code/shell context
- `user_name` / `custom_prompt` → prepended as identity preamble
- Without `desktop_automation` → the entire tool schema is omitted (saves tokens)

### Context Building (`build_structured_context`)

Assembles the full LLM message:
```
SYSTEM PROMPT (skill-aware)
USER: [structured context block]
  Goal: <user goal>
  Desktop State: <active window + open apps>
  Screenshot: <base64 JPEG if screen_required>
  Previous Actions: <completed + failed>
  Relevant Memories: <top-8 semantic>
  User Preferences: <[PREFERENCE] tags>
  Skills: <enabled skill names>
```

### Plan Schema (`planner/schemas.py`)

```python
class PlanStep(BaseModel):
    tool: str
    args: dict
    description: str
    verify_with: str | None = None   # verification tool after execution
    wait_after: float | None = None  # seconds to sleep after step
    depends_on: list[int] = []       # step indices this step depends on

class Plan(BaseModel):
    goal: str
    steps: list[PlanStep]
    recovery_hint: str | None = None
```

### Task Decomposer (`planner/decomposer.py`)

Converts the flat `Plan.steps` list into parallel execution groups using **topological sort**:
1. Build dependency graph from `depends_on` fields
2. Steps with no dependencies → first parallel group
3. Steps depending only on group 0 → second parallel group, etc.
4. Steps in the same group are executed concurrently via `asyncio.gather`

---

## 6. Tool System (`tools/`)

### BaseTool (`tools/base.py`)

```python
class RiskLevel(str, Enum):
    SAFE = "SAFE"
    MODERATE = "MODERATE"
    HIGH = "HIGH"

class BaseTool(ABC):
    name: str
    description: str
    schema: dict               # JSON schema for LLM
    risk_level: RiskLevel

    @abstractmethod
    async def execute(self, args: dict) -> ToolResult: ...

    async def safe_execute(
        self, args: dict, permission_manager=None
    ) -> ToolResult:
        # Checks risk_level → requests permission if MODERATE/HIGH
        # Calls self.execute(args)
        # Returns ToolResult
```

### Tool Registry (`tools/registry.py`)

32 tools registered at import time. `validate_registry()` runs at import → logs warning for any tool missing a schema.

Key registry functions:
- `get(name: str) → BaseTool | None`
- `all_tools() → list[BaseTool]`
- `get_schemas() → list[dict]` — used for MCP and prompt injection

### Tool Categories

**Desktop Automation (7 tools):** `click`, `type_text`, `press_key`, `open_app`, `focus_window`, `click_element`, `observe_desktop`

**System (1):** `shell` — executes arbitrary shell commands. On Linux, wrapped with `bubblewrap` when available for filesystem sandboxing. Streaming output sent via `shell_output` WebSocket events.

**Wait Utilities (2):** `wait_for_window` (polls `wmctrl`/AT-SPI), `wait_for_text` (polls OCR via pytesseract)

**Memory (3):** `remember` (store), `recall` (query), `forget_memory` (delete)

**Notes (2):** `save_note`, `get_notes`

**Self-Improvement (1):** `self_fix` — AI-assisted source code modification with rollback

**Conversational Settings (1):** `update_settings` — modifies any setting by voice/text command and emits `settings_sync`

**Productivity (11):** `web_search`, `get_weather`, `set_timer`, `list_timers`, `cancel_timer`, `list_files`, `open_path`, `read_file`, `set_volume`, `get_battery`, `toggle_wifi`

**Media (1):** `media_control` (play/pause/next/previous via D-Bus/playerctl)

---

## 7. Memory System (`memory/`)

### Architecture

```
MemoryManager (memory/manager.py)
    ├── long_term: LongTermMemory (memory/long_term.py)
    │       ├── SQLite storage: ~/.config/opensarthi/opensarthi.db (long_term_memories table)
    │       ├── Embedding: SentenceTransformer("all-MiniLM-L6-v2")
    │       │       └── Cached at module level — loaded once, reused across all calls
    │       └── Retrieval: cosine similarity of query embedding vs stored embeddings
    │
    └── recall(goal, top_k=8) → list[MemoryEntry]
        search("[PREFERENCE]", top_k=8) → preference list
```

### LongTermMemory Operations

```python
await memory.store(content, source, thread_id, importance=0.5)
await memory.recall(query, top_k=8)  # cosine similarity search
await memory.forget(memory_id)
```

### Model Caching

```python
# Module-level singleton — prevents 12-second reload on each call
_model_cache: SentenceTransformer | None = None

def _get_model() -> SentenceTransformer:
    global _model_cache
    if _model_cache is None:
        _model_cache = SentenceTransformer("all-MiniLM-L6-v2")
    return _model_cache
```

### Long-Term Memory Toggle

When `long_term_memory_enabled = False`:
- `_get_model()` is never called
- `recall()` → returns `[]` immediately
- `store()` → no-op
- Falls back to SQLite keyword search in the `recall` tool for basic functionality

This saves ~12 seconds of startup time and ~200MB RAM.

### Graceful Degradation

If `sentence-transformers` is not installed:
- `from sentence_transformers import SentenceTransformer` fails silently
- `long_term.py` falls back to SQLite `LIKE` substring matching
- Memory still works functionally; semantic accuracy is reduced

---

## 8. Voice Pipeline (`voice/`)

### Pipeline Stages

```
Microphone (PyAudio)
    ↓ 16kHz, mono, 512-sample chunks
SileroVAD (ONNX Runtime, voice/vad.py)
    ↓ speech probability per chunk
WakeWordDetector (openwakeword, voice/wakeword.py)
    ↓ "hey sarthi" / custom phrases
FasterWhisperSTT (voice/stt.py)
    ↓ transcript text
WebSocket user_message → Agent
    ↓ response text
TTS (gtts/kokoro, asyncio.subprocess)
    ↓ suspend STT during playback
Audio playback → resume STT + 300ms
```

### SileroVAD (`voice/vad.py`)

- **No PyTorch dependency** — uses `onnxruntime` CPU provider only
- Model search order: `faster-whisper` assets → `openwakeword` resources → `~/.config/opensarthi/models/silero_vad.onnx`
- Maintains stateful LSTM state `(h, c, context)` across 512-sample chunks for accurate detection
- Fallback: RMS energy threshold (`rms > 0.015`) if ONNX session fails to load

### FasterWhisperSTT (`voice/stt.py`)

- Loads `faster-whisper` model lazily on first speech event
- Runs on CPU (no GPU required)
- Returns timestamped word segments

### Wake Word Detector (`voice/wakeword.py`)

- Uses `openwakeword` library
- Configurable phrases and detection threshold via settings
- Phrases hot-updated when settings change (no restart needed)

### Anti-Echo Protection

STT audio capture is suspended during TTS playback:
```python
self.is_speaking = True
# play TTS...
await asyncio.sleep(0.3)
self.is_speaking = False
```

During `is_speaking=True`, VAD results are discarded even if speech is detected.

---

## 9. Desktop Observation (`observation.py`)

`DesktopObserver.snapshot()` returns a `DesktopSnapshot`:

```python
class DesktopSnapshot:
    active_window: WindowInfo    # title, app_name, bounds
    windows: list[WindowInfo]    # all open windows
    screenshot_path: str         # path to temp JPEG file
    screenshot_b64: str          # base64-encoded JPEG
```

### Platform-Specific Implementation

| OS | Active Window | Input Automation |
|----|--------------|-----------------|
| Linux X11 | `xdotool getactivewindow` | `xdotool` |
| Linux Wayland | AT-SPI via `observer/screen.py` | `ydotool` |
| Windows | `win32gui.GetForegroundWindow` | `pyautogui` |

### Screenshot

Uses `mss` (multi-screen screenshot library) — no Xorg display server dependency.

---

## 10. Configuration System (`config.py`)

All settings stored in a `.env` file using `pydantic-settings`:

### Platform Paths

| Platform | Path |
|---------|------|
| Linux | `~/.config/opensarthi/.env` |
| Windows | `%LOCALAPPDATA%\opensarthi\.env` |
| Android | `/data/data/com.opensarthi.app/files/opensarthi/.env` |
| Dev fallback | `runtime/.env` |

### Full Settings Schema

```python
class Settings(BaseSettings):
    app_name: str = "OpenSarthi"
    # Wake word detection
    wake_words: list[str] = ["hey sarthi", "hello sarthi"]
    wake_word_enabled: bool = True
    wake_word_threshold: float = 0.5
    # LLM selection
    local_model: str = "qwen2.5-coder:3b"
    cloud_model: str = "gemini-2.5-flash"
    ai_provider: str = "google"  # google|openai|anthropic|groq|openrouter|ollama
    # API keys (optional, provider-dependent)
    gemini_api_key: str | None = None
    openai_api_key: str | None = None
    anthropic_api_key: str | None = None
    groq_api_key: str | None = None
    openrouter_api_key: str | None = None
    # Voice settings
    voice_accent: str = "ie"
    voice_speed: float = 1.35
    continuous_listening: bool = False
    # UI
    active_theme: str = "theme-green-black"
    # Personalization
    user_name: str = ""
    user_skills: list[str] = ["general", "desktop_automation", "developer", "home_user"]
    long_term_memory_enabled: bool = True
    custom_prompt: str = ""
    # Sound (stored in localStorage on frontend; backend receives via update_settings)
    sound_enabled: bool = True
    sound_volume: int = 60
```

### `save_settings_to_env(kwargs)`

Writes changed fields to the `.env` file:
1. Reads existing `.env`
2. Filters out empty string values for API keys (prevents accidental deletion)
3. Updates only provided fields
4. Writes back to disk
5. Rebuilds `AgentDeps` with new settings
6. Emits `settings_sync` to frontend

---

## 11. Database Layer (`db.py`)

SQLite at `~/.config/opensarthi/opensarthi.db`:

### Tables

```sql
-- Conversation history
CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL,
    role TEXT NOT NULL,           -- user|assistant|system
    content TEXT NOT NULL,
    timestamp REAL NOT NULL
);

-- Thread metadata
CREATE TABLE threads (
    id TEXT PRIMARY KEY,
    created_at REAL NOT NULL,
    first_message TEXT
);

-- Token usage per thread
CREATE TABLE thread_tokens (
    thread_id TEXT PRIMARY KEY,
    request_tokens INTEGER DEFAULT 0,
    response_tokens INTEGER DEFAULT 0,
    total_tokens INTEGER DEFAULT 0
);

-- User notes
CREATE TABLE notes (
    id TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    created_at REAL NOT NULL
);

-- Long-term semantic memories
CREATE TABLE long_term_memories (
    id TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    embedding TEXT,               -- JSON array of floats
    source TEXT,
    thread_id TEXT,
    importance REAL DEFAULT 0.5,
    created_at REAL NOT NULL
);
```

### Sliding Window

Only the last **20 messages per thread** are sent to the LLM. Older messages remain in the DB for history loading but are excluded from the active context.

---

## 12. State Machine (`state_machine.py`)

`AgentState` enum broadcasts current agent lifecycle over WebSocket:

| State | Broadcast Trigger |
|-------|------------------|
| `IDLE` | Connection established, task completed |
| `CLASSIFYING` | Intent classification started |
| `PLANNING` | LLM plan generation started |
| `EXECUTING` | Tool step started |
| `HEALING` | Self-healing triggered |
| `RETRYING` | Replan started |
| `RESPONDING` | Final response streaming |
| `CANCELLED` | `cancel_execution` received |
| `ERROR` | Unrecoverable exception |

---

## 13. DevLogger (`dev_logger.py`)

Structured agent run logging for debugging and analysis:

**Log directory:** `runtime/logs/agent_runs/run_<timestamp>_<short_id>/`

**Files per run:**
| File | Contents |
|------|---------|
| `planning_context.txt` | Full LLM context sent for each planning attempt |
| `llm_responses.txt` | Raw LLM output per attempt |
| `tool_calls.txt` | Tool name, args, result status, observation per call |

DevLogger is attached to `AgentRuntime` when `DEV_LOGGING=true` env var is set.

---

## 14. Self-Healing Sub-System

### HealerAgent (`agents/healer.py`)

Called synchronously after each tool step failure. Two-stage healing:

**Stage 1 — Heuristic (fast, no LLM):**

| Failure Signature | Auto-Fix |
|---|---|
| `type_text` fails, "focus" in error | Inject `click_element` before typing |
| `click` fails with coordinate issue | Suggest `click_element` with name |
| `open_app` fails | Try alternate binary name |
| `wait_for_window` timeout | Increase timeout by 3000ms |
| `shell` command not found | Add full path fallback |

**Stage 2 — LLM Diagnosis (if heuristics fail):**
- Sends failed step + error + screenshot to LLM
- LLM returns a corrected `PlanStep` or `null` (give up)

**Safety Cap:**
- Max **2 heal attempts per step** (tracked in `heal_attempts: dict[int, int]`)
- On 3rd failure → `replan_node` rewrites entire plan
- Max **5 full replans** (`max_retries=5`) → task abandoned

### ReviewerAgent (`agents/reviewer.py`)

Post-task async fire-and-forget:
1. Receives full execution log (steps + results + errors)
2. LLM extracts 1–3 actionable lessons
3. Stored as `long_term_memories` with `source=self_review, importance=0.9`

### BehavioralObserver (`agents/behavioral_observer.py`)

Post-response async fire-and-forget:
1. Scans last 3 conversation turns
2. LLM detects implicit preferences ("prefers bullet points", "doesn't want code blocks", etc.)
3. Stored as `[PREFERENCE]` tagged memories
4. Always injected into subsequent LLM contexts

---

## 15. Cancellation & Pause

```python
class AgentRuntime:
    _agent_task: asyncio.Task | None    # LLM inference task
    _tool_task: asyncio.Task | None     # Tool execution task
    _cancel_event: asyncio.Event
    _pause_event: asyncio.Event

    def request_cancel(self):
        self._cancel_event.set()
        if self._agent_task: self._agent_task.cancel()
        if self._tool_task: self._tool_task.cancel()

    def pause(self): self._pause_event.clear()
    def resume(self): self._pause_event.set()

    async def _check_pause(self, thread_id: str):
        if not self._pause_event.is_set():
            await self.ws.send_message("task_paused", {})
            await self._pause_event.wait()
            await self.ws.send_message("task_resumed", {})
```

---

## 16. Android Runtime Path

On Android (via Capacitor + Chaquopy):
- `main_android.py` is the entry point (port 8765 hardcoded)
- Python runs in-process via Chaquopy JVM bridge
- Voice: uses Android TTS/STT APIs via `voice/android_bridge.py`
- No `mss`, `pyaudio`, or `xdotool` — all Linux-specific imports are guarded

```python
# In main_android.py
import sys
sys.platform = "android"  # Guard Linux-only imports
```

---

## 17. Requirements Reference

```
fastapi>=0.115
uvicorn[standard]>=0.32
websockets>=13
pydantic>=2.9
pydantic-settings>=2.6
pydantic-ai>=0.2
groq
anthropic
google-generativeai
ollama>=0.4
httpx>=0.28
SpeechRecognition>=3.10
pyaudio>=0.2
faster-whisper>=1.1
openwakeword
mss>=9.0
PyGObject>=3.50; sys_platform == "linux"     # AT-SPI window detection
pyautogui>=0.9; sys_platform == "win32"
pytesseract>=0.3
aiosqlite>=0.20
structlog>=24.4
psutil>=6.0
gtts                                          # TTS (basic)
# LangGraph orchestration (USE_LANGGRAPH=true)
langgraph>=0.4
langchain-core>=0.3
langgraph-checkpoint-sqlite; sys_platform != "android"
sentence-transformers>=3.0
onnxruntime                                   # SileroVAD (no PyTorch needed)
```

> **Python version: 3.12 exactly.** `faster-whisper`, `kokoro`, `numpy`, `blis` require pre-compiled wheels only available for Python 3.10–3.12.
