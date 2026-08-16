# OpenSarthi — Backend Runtime & Infrastructure

> **Updated:** August 2026 — Dual execution engine (AgentRuntime + LangGraph), SileroVAD ONNX (no PyTorch), 32-tool registry, long-term memory toggle, DevLogger structured run logs, smart overlay minimize, cancellation/pause architecture, token tracking, Android Chaquopy path, Mobile Control Dashboard Server with auto-boot lifecycle and connection telemetry, **Native Audio Pipeline (Gemini Live/OpenAI Realtime), Multi-Agent Supervisor, Browser Automation (Playwright), Google OAuth (Calendar/Gmail), Two-Phase Morning Briefing, Content Panel, Session Memory (consumed after use), Parallel Search**.

---

## 1. Architecture Overview

```
FastAPI (main.py)
├── WebSocket endpoint: /ws          (api/websocket.py)
├── HTTP endpoints: /health, /port, /models (main.py)
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
| `/models` | GET | Proxies model discovery for Ollama, OpenAI, and OpenRouter |

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
| `cancel_execution` | Cancel tasks, stop speech playback |
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

> **Current Registry:** 32 tools. **Target (after generalization):** 60+ tools spanning desktop, system, web, calendar, gmail, browser, music, social, file, code, and monitoring domains.

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

### Planned Tool Categories (Generalization Roadmap)

**Google Integration (4 tools, read-only OAuth2):**
- `calendar_read` — upcoming events, free/busy (`calendar.readonly`)
- `gmail_read` — unread subjects/snippets, search (`gmail.readonly`)
- `calendar_search` — find events by query
- `gmail_search` — find emails by query

**Browser Automation (15+ tools, Playwright backend):**
- Navigation: `browser_go_to`, `browser_back`, `browser_forward`, `browser_reload`, `browser_get_url`
- Interaction: `browser_click`, `browser_type`, `browser_press`, `browser_scroll`, `browser_fill_form`, `browser_smart_click`
- Extraction: `browser_get_text`, `browser_screenshot`
- Tab Management: `browser_new_tab`, `browser_close_tab`, `browser_switch_tab`, `browser_list_tabs`
- Session: `browser_close`, `browser_close_all`
- **Security**: Runs in sandboxed browser context; no access to user profiles by default

**Music / YouTube (3 tools):**
- `youtube_search` — search and play YouTube videos
- `youtube_control` — play/pause/next/previous/volume/seek
- `music_play` — local music file playback (MP3, FLAC via system player)

**Social Media Posting (6+ tools):**
- `twitter_post` — post tweet / reply / delete
- `linkedin_post` — post to LinkedIn
- `telegram_send` — send to channel/group/DM
- `whatsapp_send` — send via WhatsApp Web automation
- `discord_send` — send via webhook or bot
- `email_send` — send via SMTP

**System Monitoring & Control (7 tools):**
- `system_status` — CPU, RAM, disk, GPU, network, battery
- `weather_report` — current + forecast (OpenWeatherMap / wttr.in)
- `flight_finder` — flight search (Duffel/Amadeus / scraping)
- `reminder_set` / `reminder_cancel` — persisted via APScheduler
- `monitor_control` — brightness, resolution, multi-monitor layout
- `agent_shutdown` — graceful agent shutdown

**File Processing (1 tool):**
- `file_processor` — read/summarize PDF, DOCX, XLSX, CSV, images (OCR); extract text/tables/metadata; convert formats

**Code / Developer (2 tools):**
- `dev_agent` — multi-file project builder (spawns `claude-code` subprocess)
- `code_helper` — write/edit/explain/run/build code snippets

---

### Tool Registry Expansion Strategy

To support 60+ tools without token bloat:

1. **RAG-Based Dynamic Tool Injection** (Tier 1.8): Embed all tool descriptions → at plan time, retrieve top 6-8 most relevant tools by cosine similarity
2. **Multi-Agent Supervisor** (Tier 2.11): Sub-agents only see their domain-specific tool subset (ShellAgent, DesktopUIAgent, WebAgent, CalendarAgent, MusicAgent, SocialAgent, BrowserAgent)
3. **Tool Groups in System Prompt**: Tools organized into logical groups; LLM first selects group, then specific tool

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

## 8. Native Audio Pipeline (Speed Feature)

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Native Audio Loop                        │
│  ┌─────────────┐    ┌──────────────────┐    ┌─────────────┐ │
│  │ Microphone  │───▶│  Native Audio    │───▶│  Speaker    │ │
│  │  (16kHz)    │    │  Streaming API   │    │  (16/24kHz) │ │
│  └─────────────┘    │  (Gemini Live /  │    └─────────────┘ │
│                     │   OpenAI Realtime)│                 │
│                     └──────────────────┘                 │
│                          ▲                               │
│                          │ Function Calling               │
│                     ┌────┴────┐                          │
│                     │  Tools  │                          │
│                     └─────────┘                          │
└─────────────────────────────────────────────────────────────┘
```

### Implementation Options

| Pipeline | Latency | Offline | Provider | Status |
|----------|---------|---------|----------|--------|
| **Current: STT→LLM→TTS** | ~2-3s | ✅ Yes | Any | Active |
| **Gemini Live API** | <500ms | ❌ Cloud | Google | Planned (Tier 1.1) |
| **OpenAI Realtime API** | <500ms | ❌ Cloud | OpenAI | Planned (Tier 1.1) |
| **Local Native (Future)** | ~1s | ✅ Yes | Local VLM | Research |

### VoicePipeline Extensions for Native Audio

```python
class VoicePipeline:
    # ... existing fields ...
    native_audio_mode: str = "offline"  # "offline" | "gemini-live" | "openai-realtime"
    native_audio_session: Any = None
    native_audio_connected: bool = False
    
    async def initialize_native_audio(self, mode: str):
        """Initialize native audio streaming session."""
        if mode == "gemini-live":
            # Connect to Gemini Live API via WebSocket
            # Enable function calling for all tools
            pass
        elif mode == "openai-realtime":
            # Connect to OpenAI Realtime API via WebRTC
            pass
    
    async def native_audio_loop(self):
        """Main loop for native audio streaming."""
        # 1. Capture audio chunks from microphone
        # 2. Stream to provider WebSocket/WebRTC
        # 3. Receive audio chunks + function calls
        # 4. Execute function calls → stream results back
        # 5. Play received audio chunks immediately
        pass
```

### Fallback Strategy

- **Auto mode**: Try Gemini Live → OpenAI Realtime → Offline pipeline
- **Settings**: User can force specific pipeline in Settings → Voice → Native Audio Pipeline
- **Seamless switch**: Can switch pipelines mid-session without losing context

---

## 9. Voice Pipeline (`voice/`) — Current Offline Implementation

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

Uses `mss` to capture the entire virtual desktop space (union of all displays via monitor 0) to support multi-monitor setups, ensuring complete screenshot context for OCR and vision models. To assist the AI's visual understanding, Sarthi programmatically draws a red target indicator showing the current/last mouse pointer coordinate. Under Wayland (where global mouse position querying is blocked by security boundaries), Sarthi retrieves the pointer position from the active window session context to maintain reliable cross-platform cursor visualization.

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
    # Native Audio Pipeline (Mark-L speed)
    native_audio_pipeline: str = "auto"  # "auto" | "gemini-live" | "openai-realtime" | "offline"
    # UI
    active_theme: str = "theme-green-black"
    show_content_panel: bool = True
    content_panel_position: str = "right"  # "right" | "bottom-drawer"
    enable_3d_visualizer: bool = False
    # Personalization
    user_name: str = ""
    user_skills: list[str] = ["general", "desktop_automation", "developer", "home_user"]
    long_term_memory_enabled: bool = True
    custom_prompt: str = ""
    # Session Memory (Mark-L style: consumed after use)
    session_memory_enabled: bool = True
    session_memory_turns: int = 40  # turns to summarize
    session_memory_model: str = "gemini-2.5-flash"  # fast model for summarization
    # Sound (stored in localStorage on frontend; backend receives via update_settings)
    sound_enabled: bool = True
    sound_volume: int = 60
    # Google OAuth (read-only)
    google_oauth_enabled: bool = False
    google_client_id: str | None = None
    google_client_secret: str | None = None
    google_redirect_uri: str = "http://localhost:8765/oauth2callback"
    google_scopes: list[str] = ["https://www.googleapis.com/auth/calendar.readonly", "https://www.googleapis.com/auth/gmail.readonly"]
    # Parallel Search
    parallel_search_enabled: bool = True
    search_engines: list[str] = ["duckduckgo", "gemini", "brave"]
    # Background Monitoring
    background_monitoring_enabled: bool = False
    monitoring_interval_minutes: int = 30
    proactive_enabled: bool = False
    proactive_cooldown_minutes: int = 20
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

-- Session Memory (Mark-L style: consumed after use)
CREATE TABLE session_memories (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL,
    summary TEXT NOT NULL,        -- 1-2 sentence summary of last N turns
    turns_covered INTEGER,        -- number of turns this summary covers
    model_used TEXT,              -- model used for summarization
    created_at REAL NOT NULL,
    consumed BOOLEAN DEFAULT FALSE -- consumed after use, never re-summarized
);
```

### Sliding Window

Only the last **20 messages per thread** are sent to the LLM. Older messages remain in the DB for history loading but are excluded from the active context.

### Session Memory (Mark-L Style: Consumed After Use)

Replaces the simple sliding window with a more efficient approach inspired by Mark-L:

```python
class SessionMemoryManager:
    def __init__(self, db, settings):
        self.db = db
        self.settings = settings
        self.turns_since_summary = 0
        
    async def maybe_summarize(self, thread_id: str, new_messages: list):
        """Check if we should create a new session summary."""
        self.turns_since_summary += len(new_messages)
        
        if self.turns_since_summary >= self.settings.session_memory_turns:
            await self.create_session_summary(thread_id)
            self.turns_since_summary = 0
    
    async def create_session_summary(self, thread_id: str):
        """Summarize last N turns using fast flash model."""
        # 1. Fetch last N messages from DB
        messages = await self.db.get_recent_messages(thread_id, self.settings.session_memory_turns)
        
        # 2. Format for summarization
        conversation = "\n".join([f"{m['role']}: {m['content']}" for m in messages])
        
        # 3. Call fast model (gemini-2.5-flash or local equivalent)
        summary = await self.summarize_with_flash_model(conversation)
        
        # 4. Store in session_memories table with consumed=FALSE
        await self.db.store_session_memory(
            thread_id=thread_id,
            summary=summary,
            turns_covered=self.settings.session_memory_turns,
            model_used=self.settings.session_memory_model
        )
        
        # 5. Mark previous summary as consumed
        await self.db.mark_previous_consumed(thread_id)
    
    async def get_active_summary(self, thread_id: str) -> str | None:
        """Get the latest unconsumed summary for context injection."""
        return await self.db.get_latest_unconsumed_summary(thread_id)
    
    async def summarize_with_flash_model(self, text: str) -> str:
        """Use fast model to create 1-2 sentence summary."""
        prompt = f"Summarize this conversation in 1-2 sentences, focusing on key facts and decisions:\n{text}"
        # Call fast model API
        return await call_fast_model(prompt)
```

**Key Properties (Mark-L Pattern):**
- **Consumed after use**: Once a summary is injected into context, it's marked `consumed=TRUE` and never re-summarized
- **Never repeats**: Each summary covers only new turns since the last summary
- **Fast model**: Uses `gemini-2.5-flash` or equivalent for near-instant summarization
- **Replaces context compaction**: More efficient than rolling LLM summaries

---

## 12. State Machine (`state_machine.py`)

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
qrcode>=8.2                                   # Mobile Remote pairing QR generator
cryptography>=50.0                            # Symmetric AES-GCM decryption
pillow>=12.3                                  # QR image format rendering
# LangGraph orchestration (USE_LANGGRAPH=true)
langgraph>=0.4
langchain-core>=0.3
langgraph-checkpoint-sqlite; sys_platform != "android"
sentence-transformers>=3.0
onnxruntime                                   # SileroVAD (no PyTorch needed)
```

---

## 18. Mobile Control Dashboard Server

The Python runtime supports real-time remote execution control from a phone browser over local Wi-Fi:
- **Server Instance**: Encapsulated in `dashboard/server.py`. Runs a separate Uvicorn instance on port `8765` binding to `0.0.0.0` (accessible from any client device on the same local network).
- **Auto-Boot Lifecycle**: Instead of requiring manual toggles, the server is automatically booted when the desktop overlay requests pairing details via the `get_mobile_pairing` WebSocket event.
- **Connection Telemetry**: Client WebSocket connections monitor client User-Agent and remote host IP details. These metrics are compiled into `mobile_status` sub-payloads inside the `system_metrics` event (pushed to the desktop overlay every 2 seconds), allowing the desktop overlay to display list of active connected devices in real-time.
- **Security & Encryption**: Operates end-to-end symmetric encryption using **AES-256-GCM**. Commands sent from the phone client are encrypted with a key derived from the temporary 6-digit PIN and decrypted on the sidecar before forwarding to the active desktop execution loop.
- **Thread Lifecycle & Clean Shutdown**: The server runs programmatically via `uvicorn.Server` inside a managed Python daemon thread. When toggled off or during parent process shutdown (via the main FastAPI app `@app.on_event("shutdown")` hook or python `atexit` handlers), it sets `should_exit = True` on the uvicorn server instance to cleanly shut down its internal event loop and immediately release port `8765`, preventing port conflicts upon restart.

---

> **Python version: 3.12 exactly.** `faster-whisper`, `kokoro`, `numpy`, `blis` require pre-compiled wheels only available for Python 3.10–3.12.
