# OpenSarthi — Python AI Runtime

The intelligence layer of OpenSarthi. Runs as a **headless sidecar process** spawned by the Tauri shell. Built with **FastAPI + PydanticAI + LangGraph**, it handles all AI orchestration, tool execution, voice processing, real-time WebSocket communication, memory, and persistent storage.

**Key Capabilities:**
- **71-Tool Registry** — Desktop automation (8 tools), browser automation (20 Playwright tools), Google OAuth, music, social media, system monitoring, shell, memory
- **6 Voice Personas** — `JARVIS`, `NOVA`, `ATLAS`, `ARIA`, `LUNA`, `SARTHI` powered by offline Kokoro-82M TTS + gTTS fallback with automatic XML/tool tag sanitization
- **Integrations Hub** — Google Workspace (Calendar + Gmail OAuth on port 8765 loopback) and Socials (Twitter, Telegram, Discord, SMTP, LinkedIn)
- **Snapshot Caching** — Observer captures cached for 2s TTL, eliminating duplicate OCR and screenshot calls during step replanning
- **Multi-Agent Supervisor** — Classifies task domain and scopes the planner to that domain's tools (default: on, toggle via UI)
- **Terminal-First Browser Opening** — `open_url` hands the URL to `xdg-open` / browser binary; no GUI click path needed
- **Browser DOM/Snapshot** — Playwright accessibility tree (`browser_snapshot`) for reliable element targeting
- **Multimodal Screenshots to LLM** — Desktop screenshots downscaled to 1280px PNG and injected as `ImageUrl` for vision-capable models
- **Two-Phase Morning Briefing** — Phase 1: instant greeting (<1s, no tools); Phase 2: full briefing + Content Panel
- **Instant Vision Acknowledgment** — Immediate "looking" state while screen analysis runs in background
- **Parallel Search** — Multi-engine (DuckDuckGo, Gemini, Brave) first-wins pattern
- **Session Memory** — Consumed after use (1-2 sentence summary via flash model)
- **Google OAuth (Read-Only)** — calendar.readonly + gmail.readonly for briefing & search data with local port 8765 loopback callback listener
- **Content Panel Data Types** — briefing, screen_analysis, browser_result, code_output, file_preview, system_status, music, map

---

## 🧠 Core Architecture

```
Tauri Shell  ──WebSocket──►  FastAPI / api/websocket.py
                                     │
              ┌──────────────────────┼──────────────────────────────────┐
              ▼                      ▼                                  ▼
  AgentRuntime / LangGraph    voice/pipeline.py               config.py / db.py
  (dual execution paths)      (Kokoro-82M + gTTS +            (settings + SQLite)
         │                     SileroVAD + FasterWhisper)
         ├── graph/graph.py     (LangGraph, USE_LANGGRAPH=true)
         └── agent_runtime.py  (Legacy loop, default)
               │
       ┌───────┴────────┐
       ▼                ▼
 planner/agent.py    tools/registry.py
 (PydanticAI)        (71 tools registered)
       │
       ▼
┌──────┴────────────────────────────────────────┐
│          Multi-Agent Supervisor               │
│  WebAgent | CalendarAgent | MailAgent |       │
│  CodeAgent | BrowserAgent | MusicAgent |      │
│  SocialAgent                                   │
└───────────────────────────────────────────────┘
       │
       ▼
 LLM Provider (Gemini · GPT-4o · Claude · Groq · OpenRouter · Ollama · Custom OpenAI / OmniRoute)
        │
        ├─ gemini-2.5-flash-native-audio-preview (Native Audio)
        └─ gpt-4o-realtime-preview (Native Audio)
```

### Startup & Port Negotiation

`main.py` binds to an OS-assigned free port and prints `PORT:<number>` to stdout. The Tauri Rust layer (`sidecar.rs`) reads this, stores the port, and the frontend WebSocket client connects automatically. Additionally, a loopback callback server is started on port `8765` during lifespan to capture OAuth2 redirect callbacks (`/oauth2callback`).

FastAPI is configured with `CORSMiddleware` (`allow_origins=["*"]`) so that requests from both local Tauri dev webview (`http://localhost:1420`) and production shell (`tauri://localhost`) can communicate with the runtime HTTP endpoints.

### HTTP Endpoints (`api/routes.py`)

| Endpoint | Method | Description |
|---|---|---|
| `/health` | GET | Runtime health check. |
| `/models` | GET | Model discovery proxy for cloud providers (Groq, OpenAI, Anthropic, Google, OpenRouter) and local endpoints (Ollama, Custom OpenAI / OmniRoute). |
| `/validate_key` | GET | Validates API key and base URL by hitting provider model endpoints and returning discovered models list. |
| `/oauth/google/start` | GET | Initiates Google OAuth 2.0 flow in browser for Calendar + Gmail read-only scopes. Accepts dynamic `client_id` / `client_secret` params. |
| `/oauth/google/callback` | GET | Handles Google OAuth redirect callback and stores user refresh token. |
| `/integrations/status` | GET | Returns connection status for Google, Twitter, Telegram, Discord, SMTP, and LinkedIn. |
| `/integrations/revoke` | POST | Revokes stored tokens for an integration. |
| `/integrations/social` | POST | Saves social & messaging credentials to config and synchronizes runtime environment. |

> **Google OAuth Token Persistence**: After successful authorization, the OAuth refresh token is stored at `~/.config/opensarthi/google_tokens.json` (constant `TOKEN_FILE` in `runtime/tools/google_tools.py`). The client credentials (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`) are persisted in `~/.config/opensarthi/.env`. Both files survive restarts — no re-authorization needed until the token is revoked or expires.

In packaged production builds (AppImage):
1. A compiled Rust bootstrap runner executes first.
2. Checks `~/.config/opensarthi/.venv` for a valid Python 3.12 venv.
3. If missing or broken: uses bundled `uv` to fetch Python 3.12, creates the venv, installs `requirements.txt`.
4. Validates key imports (`fastapi`, `pydantic_ai`, `langgraph`, `sentence_transformers`, etc.) before launching `main.py`.

### Native Audio Pipeline Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│                     Native Audio Pipeline                          │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│  Frontend (React/Tauri)                                            │
│    │                                                               │
│    ├── native_audio_start ──────────────────────────────────────┐  │
│    │                                                            │  │
│    ▼                                                            │  │
│  Python Runtime (FastAPI)                                        │  │
│    │                                                            │  │
│    ├── NativeAudioManager (voice/native_audio.py)                │  │
│    │     ├── Provider: Gemini Live / OpenAI Realtime             │  │
│    │     ├── WebSocket connection to provider                   │  │
│    │     ├── Audio input: 16kHz PCM chunks (Opus/PCM)           │  │
│    │     ├── Audio output: 24kHz PCM chunks                     │  │
│    │     ├── Function calling → Tool Registry (71 tools)        │  │
│    │     └── Voice Activity Detection (server-side)             │  │
│    │                                                            │  │
│    ├── native_audio_chunk ◀────────────────────────────────────┘  │
│    │       (bidirectional streaming)                              │  │
│    │                                                            │  │
│    └── native_audio_stop ──────────────────────────────────────►  │
│                                                                    │
│  Android (Phone Audio Relay)                                      │
│    │                                                               │
│    ├── MediaRecorder → PCM chunks → WebSocket → Python           │  │
│    └── AudioTrack ← PCM chunks ← WebSocket ← Python              │  │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

### Tool Registry (71 Tools)

**Core 50 Tools** (`tools/registry.py` — desktop, system, wait, memory, notes, self-improvement, settings, productivity, media):

Desktop Automation (8 tools: `click`, `type_text`, `press_key`, `open_app`, `focus_window`, `click_element`, `observe_desktop`, `scroll`), System (1), Wait (2), Memory (3), Notes (2), Self-Improvement (1), Settings (1), Productivity (11), Media (1), plus generalization helpers.

**Generalization Tools (21) by Category:**

| Category | Tools |
|----------|-------|
| **Browser Automation (Playwright, 20)** | `browser_go_to`, `browser_back`, `browser_forward`, `browser_reload`, `browser_get_url`, `browser_click`, `browser_type`, `browser_press`, `browser_scroll`, `browser_fill_form`, `browser_smart_click`, `browser_get_text`, `browser_snapshot`, `browser_screenshot`, `browser_new_tab`, `browser_close_tab`, `browser_switch_tab`, `browser_list_tabs`, `browser_close`, `browser_close_all` |
| **Terminal-First URL Opening** | `open_url` — system default handler / browser binary with URL arg (preferred over GUI open+type path) |
| **Calendar (Google OAuth)** | `calendar_read`, `calendar_search` |
| **Mail (Google OAuth)** | `gmail_read`, `gmail_search` |
| **Music / YouTube** | `youtube_search`, `youtube_control`, `music_play` |
| **Social Media** | `twitter_post`, `linkedin_post`, `telegram_send`, `whatsapp_send`, `discord_send`, `email_send` |
| **System Monitoring & Control** | `system_status`, `weather_report`, `flight_finder`, `reminder_set`, `reminder_cancel`, `monitor_control`, `agent_shutdown` |

**Domain Routing:** tools carry a `ToolDomain` (`WEB`, `CALENDAR`, `MAIL`, `BROWSER`, `MUSIC`, `SOCIAL`, `CODE`, `DESKTOP_UI`, `SHELL`, `MONITORING`, `GENERAL`). When the Supervisor is on, `get_tools_by_domain()` returns the task domain's tools + all `GENERAL` tools, so the planner never sees out-of-scope tools.

### Session Memory Manager

```
┌────────────────────────────────────────────────────────────┐
│                   Session Memory Manager                   │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  Trigger: Every N turns (configurable, default 40)        │
│                                                            │
│  1. Collect last N conversation turns                     │
│  2. Send to flash model (gemini-2.5-flash) with prompt:   │
│     "Summarize this conversation in 1-2 sentences.        │
│      Focus on: user goals, decisions made, key facts."    │
│  3. Store summary in `session_memories` table:            │
│     - thread_id, summary, turn_range, timestamp, model    │
│  4. Mark prior turns as "consumed"                        │
│  5. On context build: inject only unconsumed turns +      │
│     session summaries (not full history)                  │
│                                                            │
│  Benefit: Context stays small, relevant, and efficient    │
│  (Mark-L pattern: session memory consumed after use)      │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

### Two-Phase Morning Briefing Flow

```
┌────────────────────────────────────────────────────────────┐
│              Two-Phase Morning Briefing                    │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  PHASE 1 (Instant — <1 second)                            │
│  ───────────────────────────────────────────────────────  │
│  • Trigger: "good morning" / scheduled time / wake word   │
│  • LLM generates greeting ONLY (no tools)                 │
│  • Response: briefing_phase1 → "Good morning! I'm        │
│    compiling your briefing..."                            │
│  • User hears response immediately                        │
│                                                            │
│  PHASE 2 (Background — parallel fetch)                    │
│  ───────────────────────────────────────────────────────  │
│  • CalendarAgent → calendar_list_events (today)           │
│  • Weather tool → get_weather (location)                  │
│  • WebAgent → web_search (top headlines)                  │
│  • Memory → recall relevant preferences                   │
│  • MailAgent → gmail_list_messages (unread count)         │
│  • All run in PARALLEL (asyncio.gather)                   │
│  • When complete: briefing_phase2 + content_update        │
│    (Content Panel: briefing type with calendar, weather,  │
│     news, memories, mail count)                           │
│                                                            │
│  Mark-L Pattern: Instant greeting + background enrichment │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

### Instant Vision Acknowledgment

```
User: "What's on my screen?"
          │
          ▼
    ┌─────────────┐
    │ voice_state │──► "looking" (IMMEDIATE, <100ms)
    └─────────────┘
          │
          ▼
    ┌─────────────────────────────────────┐
    │ Background: DesktopObserver.snapshot()│
    │ • mss screenshot → base64           │
    │ • LLM vision analysis               │
    │ • Extract UI elements               │
    └─────────────────────────────────────┘
          │
          ▼
    ┌─────────────┐
    │ screen_analy│──► Full analysis + Content Panel
    │    sis      │
    └─────────────┘
```

### Parallel Search (First-Wins)

```
User: "Search for X"
          │
          ▼
    ┌──────────────────────────────────────┐
    │ asyncio.gather(                      │
    │   duckduckgo_search("X"),            │
    │   gemini_search("X"),                │
    │   brave_search("X")                  │
    │ )                                    │
    └──────────────────────────────────────┘
          │
          ▼
    First result to complete → immediate response
    Other results → discarded or used for verification
```

## ✅ Feature Reference

### 1. Dual Execution Engine: AgentRuntime + LangGraph

OpenSarthi ships two parallel execution engines sharing the same tools, memory, and planner.

| Engine | Activate | Best For |
|--------|----------|----------|
| **LangGraph Graph** (default) | `USE_LANGGRAPH=true` (default) | Stateful multi-step tasks, crash recovery, advanced routing |
| **AgentRuntime** (legacy) | `USE_LANGGRAPH=false` | Simpler tasks, lower memory overhead |

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
| **Google** | `gemini-3.6-flash` | `GEMINI_API_KEY` |
| **OpenAI** | `gpt-4o` | `OPENAI_API_KEY` |
| **Anthropic** | `claude-sonnet-5` | `ANTHROPIC_API_KEY` |
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
    └── TTS Engine (4-Tier Fallback):
            ├── Layer 0: Edge-TTS (Crisp male/female neural voices: JARVIS, NOVA, ATLAS, ARIA, LUNA, SARTHI)
            ├── Layer 1: Kokoro-82M ONNX offline neural TTS
            ├── Layer 2: gTTS (Google Translate cloud TTS fallback)
            └── Layer 3: espeak / native system TTS
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

### 5. Tool Registry (71 Tools)

All tools registered in `tools/registry.py` with `validate_registry()` at import.

#### Core 50 Tools

| Category | Tools |
|----------|-------|
| **Desktop Automation (8)** | `click`, `type_text`, `press_key`, `open_app`, `focus_window`, `click_element`, `observe_desktop`, `scroll` |
| **System** | `shell` (bubblewrap-sandboxed on Linux) |
| **Wait Utilities** | `wait_for_window`, `wait_for_text` (OCR polling via pytesseract) |
| **Memory** | `remember`, `recall`, `forget_memory` |
| **Notes** | `save_note`, `get_notes` |
| **Self-Improvement** | `self_fix` (AI-powered runtime self-modification with rollback) |
| **Conversational Settings** | `update_settings` — change any setting by voice/text |
| **Productivity** | `web_search`, `get_weather`, `set_timer`, `list_timers`, `cancel_timer`, `list_files`, `open_path`, `read_file`, `set_volume`, `get_battery`, `toggle_wifi` |
| **Media** | `media_control` (play/pause/next/previous) |

#### Browser Automation (21 tools, Playwright backend)

**Navigation:** `browser_go_to`, `browser_back`, `browser_forward`, `browser_reload`, `browser_get_url`

**Interaction:** `browser_click`, `browser_type`, `browser_press`, `browser_scroll`, `browser_fill_form`, `browser_smart_click`

**Extraction:** `browser_get_text`, `browser_snapshot` (accessibility/DOM tree), `browser_screenshot`

**Tab Management:** `browser_new_tab`, `browser_close_tab`, `browser_switch_tab`, `browser_list_tabs`

**Session:** `browser_close`, `browser_close_all`

**Security:** Runs in sandboxed headless Chromium (Playwright); no access to user profiles; `--no-sandbox` gated to root-only; URL scheme restricted to `http`/`https`.

**Terminal-First URL Opening:** `open_url` — hands the URL to `xdg-open` or a known browser binary (`google-chrome`, `chromium`, `brave`, etc.) with `--force-renderer-accessibility`. **Preferred** over `open_app` + GUI typing for "open X page" requests.

#### Google Integration (4 tools, read-only OAuth2)

| Tool | Scope | Purpose |
|------|-------|---------|
| `calendar_read` | `calendar.readonly` | Upcoming events, free/busy |
| `calendar_search` | `calendar.readonly` | Search events by query |
| `gmail_read` | `gmail.readonly` | Unread subjects/snippets, search |
| `gmail_search` | `gmail.readonly` | Search emails by query |

#### Music / YouTube (3 tools)

`youtube_search` — search and play YouTube videos.
`youtube_control` — play/pause/next/previous/volume/seek.
`music_play` — local music file playback (MP3, FLAC via system player).

#### Social Media Posting (6 tools)

`twitter_post`, `linkedin_post`, `telegram_send`, `whatsapp_send`, `discord_send`, `email_send`

#### System Monitoring & Control (7 tools)

`system_status`, `weather_report`, `flight_finder`, `reminder_set`, `reminder_cancel`, `monitor_control`, `agent_shutdown`

#### Domain Routing

Every tool carries a `ToolDomain`. When the Supervisor is enabled (`use_supervisor: true`, default), `get_tools_by_domain()` scopes the planner to that domain's tools + `GENERAL`. The planner never sees out-of-scope tools. See Section 3 (Multi-Agent Supervisor).

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
    cloud_model: str = "gemini-3.6-flash"
    ai_provider: str = "google"
    gemini_api_key: str | None = None
    openai_api_key: str | None = None
    anthropic_api_key: str | None = None
    groq_api_key: str | None = None
    openrouter_api_key: str | None = None
    custom_openai_base_url: str | None = None
    custom_openai_api_key: str | None = None
    custom_openai_provider_name: str | None = None
    voice_accent: str = "ie"
    voice_speed: float = 1.35
    continuous_listening: bool = False
    active_theme: str = "theme-green-black"
    user_name: str = ""
    user_skills: list[str] = ["general", "desktop_automation", "developer", "home_user"]
    long_term_memory_enabled: bool = True
    custom_prompt: str = ""
    # Execution engine selection
    use_langgraph: bool = True        # Use LangGraph stateful graph (default) vs legacy AgentRuntime
    use_supervisor: bool = True       # Multi-Agent Supervisor: classify task domain, scope tools (toggle via UI)
    send_screenshots_to_llm: bool = True  # Send downscaled desktop screenshot to planner for vision-capable models
    use_native_voice: bool = False    # Gemini Live / OpenAI Realtime streaming audio (Google provider only)
```

`save_settings_to_env()` persists all fields to `~/.config/opensarthi/.env` and emits `settings_sync` to the frontend.

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
- **Screenshots** via `mss` → downscaled to 1280px wide PNG, base64-encoded and stored in `DesktopSnapshot.screenshot_base64`. The downscaled PNG is also saved to a temp file for local inspection.
- **Active window** via AT-SPI (Wayland-compatible) or `xdotool`/`ydotool`
- **Window list** — all open windows with titles and geometry

**Multimodal Screenshots to LLM:** When `send_screenshots_to_llm` is true and the model supports vision (see `model_supports_vision()` in `llm/factory.py`), the planner injects the base64 screenshot as an `ImageUrl` content part alongside the text context. Ollama is never treated as vision-capable; cloud providers are detected by class name.

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
│   ├── base.py           # BaseTool abstract class, RiskLevel enum, ToolDomain enum
│   ├── desktop.py        # click, type_text, open_app, focus_window, click_element, observe_desktop
│   ├── system.py         # ShellTool (bubblewrap-sandboxed)
│   ├── wait_tools.py     # wait_for_window, wait_for_text
│   ├── memory.py         # remember, recall, forget_memory
│   ├── notes.py          # save_note, get_notes
│   ├── media.py          # MediaControlTool
│   ├── self_fix.py       # AI-powered self-modification + rollback
│   ├── settings_tool.py  # UpdateSettingsTool — conversational settings control
│   ├── productivity.py   # WebSearch, Weather, Timer, ListFiles, Volume, Battery, WiFi
│   ├── browser.py        # 20 Playwright headless browser tools (browser_go_to, browser_click, browser_snapshot, …)
│   ├── open_url.py       # Terminal-first browser opener (xdg-open / browser binary + URL)
│   ├── google_tools.py   # Google OAuth read-only: calendar_read, calendar_search, gmail_read, gmail_search
│   ├── music.py          # youtube_search, youtube_control, music_play
│   ├── social.py         # twitter_post, linkedin_post, telegram_send, whatsapp_send, discord_send, email_send
│   ├── system_monitor.py # system_status, weather_report, flight_finder, reminders, monitor_control, agent_shutdown
│   └── registry.py       # 71 tools registered, get_tools_by_domain(), validate_registry()
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

LangGraph is the **default**. To use the legacy AgentRuntime instead:
```bash
USE_LANGGRAPH=false python main.py
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

## 📱 Mobile Control Dashboard Server

The runtime hosts an auxiliary FastAPI server (`dashboard/server.py`) binding to port `8765` for remote smartphone control:
- **Authentication**: Generates a cryptographically secure 6-character PIN pairing code (`secrets.choice`).
- **WebSockets**: Serves `/ws?token=<pairing_pin>` to clients. When connected, metadata (browser user-agent, remote IP) is stored and pushed to the desktop overlay in the `system_metrics` websocket event.
- **Security**: Utilizes end-to-end symmetric encryption (AES-GCM-256) for command transmission over local Wi-Fi, preventing MITM injection.
- **Lifecycle Management**: Runs in a managed background thread via `uvicorn.Server`. Handles clean startup and exit (`should_exit` signals) to immediately release port `8765` upon toggle off or app shutdown, preventing port conflicts on restart.

---

## 🔮 Planned / In Progress

- [x] **Native Audio Pipeline** — Gemini Live / OpenAI Realtime streaming (sub-500ms latency)
- [x] **Two-Phase Morning Briefing** — Instant greeting + background parallel fetch
- [x] **Instant Vision Acknowledgment** — Immediate "looking" response
- [x] **Parallel Search** — Multi-engine first-wins pattern
- [x] **Session Memory Manager** — Consumed after use (1-2 sentence summaries)
- [x] **Multi-Agent Supervisor** — Domain classification, scoped tool routing, frontend toggle
- [x] **Content Panel** — 4th panel for rich content (8 content types)
- [x] **Phone Audio Relay** — Native audio on Android via Chaquopy bridge
- [x] **Google OAuth (Read-Only)** — `calendar.readonly` + `gmail.readonly` (4 tools)
- [x] **Web Search Tool** — DuckDuckGo scraping with ad-filtering
- [x] **Browser Automation (20 tools, Playwright)** — navigate, click, type, scroll, extract text, accessibility snapshot, screenshot, tab management
- [x] **Terminal-First URL Opening** — `open_url` via `xdg-open` / browser binary (preferred over GUI path)
- [x] **Music / YouTube Playback** — `youtube_search`, `youtube_control`, `music_play`
- [x] **Social Media Posting** — Twitter, LinkedIn, Telegram, WhatsApp, Discord, email
- [x] **System Monitoring** — CPU/RAM/disk/GPU/network, weather, flights, reminders, shutdown
- [x] **Multimodal Screenshots to LLM** — Desktop screenshot as `ImageUrl` in planner context (vision-capable models only)
- [ ] **ElevenLabs TTS** — replace gTTS for high-quality streaming voice
- [ ] **Security** — bubblewrap profile expansion, per-app rules
- [ ] **MCP Server Exposure** — expose OpenSarthi tools as Model Context Protocol server
- [ ] **Streaming Shell Output** — stream shell stdout live to UI console view
- [ ] **Code Agent (Claude Code subprocess)** — run, analyze, generate, edit, test, lint
- [ ] **Proactive 2.0 / Background Monitoring** — periodic checks, notifications
