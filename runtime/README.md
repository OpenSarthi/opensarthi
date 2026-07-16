# OpenSarthi — Python AI Runtime

The intelligence layer of OpenSarthi. Runs as a **headless sidecar process** spawned by the Tauri shell. Built with **FastAPI + PydanticAI + LangGraph**, it handles all AI orchestration, tool execution, voice processing, real-time WebSocket communication, memory, and persistent storage.

---

## 🧠 Core Architecture

```
Tauri Shell  ──WebSocket──►  FastAPI / api/websocket.py
                                     │
              ┌──────────────────────┼──────────────────────────────────┐
              ▼                      ▼                                  ▼
  AgentRuntime / LangGraph    voice/pipeline.py               config.py / db.py
  (dual execution paths)      (PyAudio + SileroVAD             (settings + SQLite)
         │                     + FasterWhisper + TTS)
         ├── graph/graph.py     (LangGraph, USE_LANGGRAPH=true)
         └── agent_runtime.py  (Legacy loop, default)
               │
       ┌───────┴────────┐
       ▼                ▼
 planner/agent.py    tools/registry.py
 (PydanticAI)        (32 tools registered)
       │
       ▼
 LLM Provider (Gemini · GPT-4o · Claude · Groq · OpenRouter · Ollama)
```

### Startup & Port Negotiation

`main.py` binds to an OS-assigned free port and prints `PORT:<number>` to stdout. The Tauri Rust layer (`sidecar.rs`) reads this, stores the port, and the frontend WebSocket client connects automatically.

In packaged production builds (AppImage):
1. A compiled Rust bootstrap runner executes first.
2. Checks `~/.config/opensarthi/.venv` for a valid Python 3.12 venv.
3. If missing or broken: uses bundled `uv` to fetch Python 3.12, creates the venv, installs `requirements.txt`.
4. Validates key imports (`fastapi`, `pydantic_ai`, `langgraph`, `sentence_transformers`, etc.) before launching `main.py`.

---

## ✅ Feature Reference

### 1. Dual Execution Engine: AgentRuntime + LangGraph

OpenSarthi ships two parallel execution engines sharing the same tools, memory, and planner.

| Engine | Activate | Best For |
|--------|----------|----------|
| **AgentRuntime** (default) | `USE_LANGGRAPH=false` | Simpler tasks, lower memory overhead |
| **LangGraph Graph** | `USE_LANGGRAPH=true` | Stateful multi-step tasks, crash recovery, advanced routing |

#### AgentRuntime (`agent_runtime.py`)

```
AgentRuntime.run(goal, model, history)
    │
    ├─ Desktop snapshot (observation.py)
    ├─ Memory auto-recall: top-8 semantic + all [PREFERENCE] entries
    ├─ build_structured_context() → assembles LLM prompt
    ├─ _agent_run() → asyncio.Task [CANCELLABLE]
    ├─ Parse JSON plan (Plan + PlanStep schemas)
    ├─ Topological sort for parallel step groups (decomposer.py)
    │
    └─ For each parallel step group:
         ├─ _check_pause() → await asyncio.Event if paused
         ├─ Emit tool_started via WebSocket
         ├─ _tool_execute() → asyncio.Task [CANCELLABLE]
         │     └─ tool.safe_execute(args, permission_manager=ws)
         ├─ On failure: HealerAgent.diagnose_and_fix()
         └─ Emit tool_completed / tool_error
```

#### LangGraph Execution Graph (`graph/`)

A compiled `StateGraph` with 8 nodes and conditional routing:

```
classify_node → route_by_classification
    │
    ├──► chat_node               (CHAT → conversational response)
    │
    └──► observe_node → plan_node → execute_step_node
                                          │
                                          ├── execute (next step)
                                          ├── heal_node → execute (retry)
                                          ├── heal_node → replan_node (cap exceeded)
                                          └── review_node → END (all done)
```

**OpenSarthiState fields:**

| Field | Type | Purpose |
|-------|------|---------|
| `goal` | `str` | Current user goal |
| `classification` | `str` | CHAT \| TASK \| CLARIFY |
| `plan_steps` | `list` | Current plan (PlanStep dicts) |
| `current_step_index` | `int` | Next step to execute |
| `completed_actions` | `list[str]` | Human-readable step log |
| `failed_actions` | `list[str]` | Error log for replanning |
| `cumulative_steps` | `list` | Full history for UI broadcast |
| `heal_attempts` | `dict[int,int]` | Heal count per step (cap: 2) |
| `retry_count` | `int` | Full replan count (max: 5) |
| `desktop_snapshot` | `dict` | Serialized DesktopSnapshot |
| `recalled_memories` | `list` | Top-8 semantic memory hits |
| `preferences` | `list` | All stored [PREFERENCE] entries |
| `is_cancelled` / `is_paused` | `bool` | Control signals |
| `total_request_tokens` | `int` | Accumulated input tokens |
| `total_response_tokens` | `int` | Accumulated output tokens |

**Checkpointing:** `MemorySaver` by default; `SqliteSaver` at `~/.config/opensarthi/checkpoints.db` when `langgraph-checkpoint-sqlite` is installed.

**Smart Overlay Minimize:** `plan_node` and `execute_step_node` detect screen-interaction tools (`click`, `type_text`, `open_app`, etc.) and emit `window_control → minimize_hint` so the HUD auto-shrinks during task execution.

---

### 2. Multi-Provider LLM with Skill-Aware Prompts

Providers configured in `config.py` (reads `~/.config/opensarthi/.env`):

| Provider | Default Model | Key Setting |
|----------|-------------|-------------|
| **Google** | `gemini-2.5-flash` | `GEMINI_API_KEY` |
| **OpenAI** | `gpt-4o` | `OPENAI_API_KEY` |
| **Anthropic** | `claude-opus-4-5` | `ANTHROPIC_API_KEY` |
| **Groq** | `llama-3.3-70b-versatile` | `GROQ_API_KEY` |
| **OpenRouter** | any via `openrouter.ai/api/v1` | `OPENROUTER_API_KEY` |
| **Ollama** | `qwen2.5-coder:3b` (local) | no key needed |

The system prompt is built **dynamically at runtime** by `build_system_prompt()`:
- If `desktop_automation` skill **not** selected → tool-call JSON format omitted entirely
- If `developer` skill selected → adds code/shell context hints
- `user_name` and `custom_prompt` prepended to the base identity

---

### 3. Agentic Intelligence Sub-Agents

Three autonomous sub-agents run fire-and-forget — they never block user responses:

| Agent | File | Trigger | Purpose |
|-------|------|---------|---------|
| **HealerAgent** | `agents/healer.py` | Sync, on step failure | Heuristic quick-fix OR LLM-diagnosed step correction |
| **ReviewerAgent** | `agents/reviewer.py` | Async, post-task | Extracts 1–3 lessons from execution log into long-term memory |
| **BehavioralObserver** | `agents/behavioral_observer.py` | Async, post-response | Detects implicit user preferences from conversation patterns |

**Self-Healing Safety Cap:**
- Each step allowed a maximum of **2 healing attempts** tracked in `heal_attempts: dict[int, int]`
- On the 3rd failure → full `replan_node` rewrites the plan
- Prevents infinite heal loops on fundamentally broken steps

**Memory Auto-Inject:** Before every LLM context build:
1. Top-8 semantically relevant memories (cosine search against the goal)
2. All stored `[PREFERENCE]` memories (always injected)

---

### 4. Voice Pipeline

Full multi-stage pipeline in `voice/pipeline.py`:

```
Microphone (PyAudio, 16kHz, 512-sample chunks)
    │
    ├── WakeWordDetector (openwakeword) — passive wake word listening
    │       └── Detects "hey sarthi" / custom phrases
    │
    ├── SileroVAD (ONNX Runtime) — speech activity detection
    │       ├── Model path: faster-whisper assets → openwakeword → ~/.config/opensarthi/models/
    │       └── Falls back to RMS energy threshold if ONNX unavailable
    │
    ├── FasterWhisperSTT (voice/stt.py) — local offline transcription
    │
    └── TTS: asyncio.subprocess → gtts/kokoro
            └── STT suspended during playback (echo prevention)
```

**Key behaviors:**
- Ambient calibration at startup with 1.8× energy threshold boost
- Echo protection: STT suspended while TTS is playing
- Dynamic energy threshold: damping 0.25, ratio 1.8 to reduce false triggers
- Continuous listening configurable via `CONTINUOUS_LISTENING` setting

**Silero VAD (ONNX):**
- Replaces PyTorch/torchaudio dependency entirely — no GPU required
- Maintains recurrent LSTM state (`h`, `c`, `context`) across 512-sample chunks
- Pure CPU inference via `onnxruntime`

---

### 5. Tool Registry (32 Tools)

All tools registered in `tools/registry.py`:

**Desktop Automation:** `click`, `type_text`, `press_key`, `open_app`, `focus_window`, `click_element`, `observe_desktop`

**System:** `shell` (bubblewrap-sandboxed on Linux)

**Wait Utilities:** `wait_for_window`, `wait_for_text` (OCR polling via pytesseract)

**Memory:** `remember`, `recall`, `forget_memory`

**Notes:** `save_note`, `get_notes`

**Self-Improvement:** `self_fix` (AI-powered runtime self-modification with rollback)

**Conversational Settings:** `update_settings` — change any setting by voice/text

**Productivity:** `web_search`, `get_weather`, `set_timer`, `list_timers`, `cancel_timer`, `list_files`, `open_path`, `read_file`, `set_volume`, `get_battery`, `toggle_wifi`

**Media:** `media_control` (play/pause/next/previous)

---

### 6. Conversational Settings Control (`tools/settings_tool.py`)

The `update_settings` tool lets the AI modify any setting via natural language:

```
"Change my theme to cyberpunk"       → active_theme
"Switch to GPT-4o using OpenAI"      → ai_provider + cloud_model
"Turn off continuous listening"       → continuous_listening
"Disable long-term memory"            → long_term_memory_enabled
```

Supported fields: `theme`, `provider`, `cloud_model`, `local_model`, `gemini_api_key`, `openai_api_key`, `anthropic_api_key`, `groq_api_key`, `openrouter_api_key`, `voice_accent`, `voice_speed`, `wake_words`, `wake_word_enabled`, `wake_word_threshold`, `continuous_listening`, `long_term_memory_enabled`

After saving, emits `settings_sync` so the frontend updates live. API key changes are `MODERATE` risk (permission dialog shown).

---

### 7. Long-Term Semantic Memory (`memory/`)

- **Store:** SQLite with vector embeddings (JSON array column)
- **Model:** `all-MiniLM-L6-v2` via `sentence-transformers`
- **Retrieval:** Cosine similarity search — top-K most relevant entries
- **Model caching:** `SentenceTransformer` cached at module level → prevents 12-second reload penalty per query
- **Toggle bypass:** When `long_term_memory_enabled = False`, model is never loaded
- **Graceful degradation:** Falls back to SQLite substring search if `sentence-transformers` is not installed

---

### 8. Settings & Configuration (`config.py`)

Settings path:
- **Linux:** `~/.config/opensarthi/.env`
- **Windows:** `%LOCALAPPDATA%\opensarthi\.env`
- **Dev fallback:** `runtime/.env`

Full settings schema:

```python
class Settings(BaseSettings):
    app_name: str = "OpenSarthi"
    wake_words: list[str] = ["hey sarthi", "hello sarthi"]
    wake_word_enabled: bool = True
    wake_word_threshold: float = 0.5
    local_model: str = "qwen2.5-coder:3b"
    cloud_model: str = "gemini-2.5-flash"
    ai_provider: str = "google"
    gemini_api_key: str | None = None
    openai_api_key: str | None = None
    anthropic_api_key: str | None = None
    groq_api_key: str | None = None
    openrouter_api_key: str | None = None
    voice_accent: str = "ie"
    voice_speed: float = 1.35
    continuous_listening: bool = False
    active_theme: str = "theme-green-black"
    user_name: str = ""
    user_skills: list[str] = ["general", "desktop_automation", "developer", "home_user"]
    long_term_memory_enabled: bool = True
    custom_prompt: str = ""
```

Empty API key inputs on `update_settings` are filtered out — no accidental key deletion.

Settings sync is triggered automatically on:
1. Client WebSocket connection → sends `settings_sync` event
2. `update_settings` WS message from frontend
3. `update_settings` tool call by the agent

---

### 9. Conversation History & Token Tracking (`db.py`)

SQLite at `~/.config/opensarthi/opensarthi.db`:

| Table | Purpose |
|-------|---------|
| `messages` | role/content/timestamp per thread_id |
| `threads` | Thread metadata |
| `thread_tokens` | Accumulated token usage per thread |
| `notes` | User-saved text notes |
| `long_term_memories` | Semantic memory store |

- 20-message sliding window to LLM
- Per-thread token counts stored and restored when loading history
- Handles both `request_tokens`/`response_tokens` and `input`/`output` field names from PydanticAI

---

### 10. Desktop Observation (`observation.py` + `observer/screen.py`)

`DesktopObserver.snapshot()` captures:
- **Screenshots** via `mss` → base64 JPEG, saved to temp file, path included in context
- **Active window** via AT-SPI (Wayland-compatible) or `xdotool`/`ydotool`
- **Window list** — all open windows with titles and geometry

On Wayland: `ydotool` is used for focus/input operations when `xdotool` is unavailable.

---

### 11. DevLogger (`dev_logger.py`)

Structured run logging to `runtime/logs/agent_runs/run_<timestamp>_<id>/`:
- `planning_context.txt` — full LLM context per planning attempt
- `llm_responses.txt` — raw LLM output per attempt
- `tool_calls.txt` — every tool call with args, status, and observation

---

## 📂 Directory Structure

```
runtime/
├── main.py               # FastAPI app, port negotiation, CORS
├── main_android.py       # Android entry point (port 8765, Chaquopy)
├── config.py             # pydantic-settings, save_settings_to_env()
├── db.py                 # SQLite: messages, threads, tokens, notes, memories
├── agent_runtime.py      # Legacy stateful executor (cancel/pause/plan/self-heal)
├── observation.py        # DesktopObserver: screenshot + window info
├── state_machine.py      # AgentState enum + AgentStateContext
├── sync_primitives.py    # wait_for_window, poll_until, platform-aware helpers
├── window_session.py     # Track foreground windows for smart overlay control
├── dev_logger.py         # Structured run logging to logs/agent_runs/
├── requirements.txt
│
├── graph/                # LangGraph orchestration (USE_LANGGRAPH=true)
│   ├── state.py          # OpenSarthiState: full typed state schema
│   ├── nodes.py          # All 8 async node implementations
│   ├── edges.py          # Conditional edge routing functions
│   └── graph.py          # StateGraph builder, get_compiled_graph(), run_graph()
│
├── api/
│   └── websocket.py      # All WS message handlers (user_message, cancel, etc.)
│
├── agents/
│   ├── classifier.py     # LLM intent classification (CHAT/TASK/CLARIFY)
│   ├── orchestrator.py   # Message routing + context summarization
│   ├── healer.py         # Self-Healing Agent
│   ├── reviewer.py       # Self-Improving Reviewer: post-task lesson extraction
│   └── behavioral_observer.py  # Preference learning from conversation patterns
│
├── planner/
│   ├── agent.py          # PydanticAI Agent, build_system_prompt(), build_structured_context()
│   ├── decomposer.py     # Topological sort for parallel step groups
│   └── schemas.py        # Plan, PlanStep, ToolResult Pydantic models
│
├── tools/
│   ├── base.py           # BaseTool abstract class, RiskLevel enum
│   ├── desktop.py        # click, type_text, open_app, focus_window, click_element, observe_desktop
│   ├── system.py         # ShellTool (bubblewrap-sandboxed)
│   ├── wait_tools.py     # wait_for_window, wait_for_text
│   ├── memory.py         # remember, recall, forget_memory
│   ├── notes.py          # save_note, get_notes
│   ├── media.py          # MediaControlTool
│   ├── self_fix.py       # AI-powered self-modification + rollback
│   ├── settings_tool.py  # UpdateSettingsTool — conversational settings control
│   ├── productivity.py   # WebSearch, Weather, Timer, ListFiles, Volume, Battery, WiFi
│   └── registry.py       # TOOL_REGISTRY (32 tools), get_schemas(), validate_registry()
│
├── memory/
│   ├── long_term.py      # Semantic SQLite memory (all-MiniLM-L6-v2, cached model)
│   ├── manager.py        # Unified MemoryManager
│   └── passive.py        # Passive memory extraction hook
│
├── voice/
│   ├── pipeline.py       # Full voice pipeline: PyAudio → VAD → STT → TTS
│   ├── stt.py            # FasterWhisperSTT (local offline)
│   ├── vad.py            # SileroVAD via ONNX Runtime (no PyTorch)
│   ├── wakeword.py       # OpenWakeWord detector
│   └── android_bridge.py # Android STT/TTS bridge
│
├── observer/
│   └── screen.py         # AT-SPI window query (Wayland-compatible)
│
├── providers/            # LinuxDesktopProvider (xdotool/ydotool)
├── llm/                  # LLM provider abstraction wrappers
├── mcp/                  # MCP stubs (planned)
├── security/             # bubblewrap profiles
└── tests/                # unittest + IsolatedAsyncioTestCase
```

---

## 🚀 Running Standalone (Dev)

```bash
cd runtime
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python main.py
# Output: PORT:38495  ← picked up by Tauri frontend
```

LangGraph mode:
```bash
USE_LANGGRAPH=true python main.py
```

---

## ⚠️ Python Version

**Use Python 3.12 exactly.**

- `faster-whisper`, `kokoro`, `numpy`, `blis` require pre-compiled wheels for 3.10/3.11/3.12
- Python 3.13+ will fail to compile ML packages from source

---

## 🧪 Running Tests

```bash
cd runtime
python -m unittest discover tests
```

---

## 🔮 Planned

- [ ] **ElevenLabs TTS** — replace gTTS for high-quality streaming voice
- [x] **Web Search Tool** — DuckDuckGo scraping with ad-filtering
- [ ] **Security** — bubblewrap profile expansion, per-app rules
- [ ] **MCP** — expose tools as Model Context Protocol server
- [ ] **Streaming Shell Output** — stream shell stdout live to UI console view
- [ ] **Morning Briefing** — daily context summary from memory + calendar
