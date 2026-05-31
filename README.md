# OpenSarthi

> **An AI-native Desktop Agent & Assistant for Desktop**

OpenSarthi is an autonomous, voice-first AI desktop agent built for Desktop. It acts as a generalized computer-use primitive — executing system-level tasks, controlling apps, interacting with the screen, sandboxing shell commands, and responding to natural voice input. It is not just a chatbot; it is a full agentic runtime integrated directly into your desktop.

---

## 🏗️ Architecture Overview

OpenSarthi is a monorepo with two tightly coupled layers that communicate over a local WebSocket connection:

```
┌─────────────────────────────────────────────────────────┐
│               Tauri v2 Desktop Shell                    │
│        React 19 + TypeScript + Vite 6 (WebView)        │
│  Themes · HUD · Voice · Chat · Tasks · Onboarding      │
└────────────────────────┬────────────────────────────────┘
                         │  WebSocket (localhost, dynamic port)
┌────────────────────────▼────────────────────────────────┐
│              Python Runtime Sidecar                     │
│          FastAPI + PydanticAI + uvicorn                 │
│  Agent · Planner · Tools · Voice · Memory · Providers  │
└─────────────────────────────────────────────────────────┘
```

| Layer | Technology |
|-------|-----------|
| **Desktop Shell** | Tauri v2, React 19, TypeScript, Vite 6 |
| **Rust Core** | sidecar.rs, tray.rs, ipc.rs |
| **AI Runtime** | Python 3.12, FastAPI, PydanticAI ≥ 0.2 |
| **LLM Providers** | Google Gemini, OpenAI, Anthropic, Groq, OpenRouter, Ollama |
| **Voice Pipeline** | SpeechRecognition + Google STT, OpenWakeWord, faster-whisper (Whisper), Kokoro TTS |
| **Storage** | SQLite (aiosqlite) for chat history + token tracking |
| **Packaging** | AppImage (Tauri bundle) + `uv` for portable Python management |

---

## ✅ What's Built & Working

### Desktop Shell (Frontend)

- **Cyberpunk HUD UI** — three-panel layout: Agent Tasks (left), Chat (center), Live Plan & Activity (right)
- **6 Premium Themes** — Glass Red-Black, Forest Green-Black, Deep Purple-Black, Cyber Sky-White, Sakura Pink-White, and Simple Dark (Black-Gray-White)
- **Real-time Token Counter** — live `request / response / session total` tokens per thread, restored on history load
- **First-Launch Onboarding** — step-by-step cold-start wizard: Step 1 (Skills & Capabilities selection), Step 2 (Name & Custom instructions), and Step 3 (Agent Settings for Provider, Model, and API Key)
- **Customise Popup** — re-editable persona & skills via Wrench button; styled as a glassmorphic straight-bracket HUD panel modal matching the theme
- **Model Context Protocol (MCP) Configuration** — dedicated settings view to toggle local tool exposure and manage external MCP server URLs
- **JSON Task Import** — center overlay dialog with live JSON syntax validation, error traces, step previews, and direct LLM-bypass runner
- **Multi-thread Chat History** — persistent threads; each thread restores its own token usage on load
- **New Thread** — clears session context and resets token counter
- **Voice Button** — microphone toggle with animated waveform and state indicators
- **Window-Aware Controls** — top-right buttons expand with labels when window is maximized

### AI Runtime (Backend Sidecar)

- **Multi-Provider LLM** — Gemini, GPT-4o, Claude, Groq, OpenRouter, Ollama (local)
- **Skill-Aware Dynamic Prompts** — system prompt is built at runtime from user-selected skills; disables tool-call format entirely when desktop automation is not selected (reduces token cost)
- **Immediate Stop/Pause** — `request_cancel()` cancels in-flight LLM inference and tool execution via `asyncio.Task.cancel()` — no waiting for completion
- **JSON Plan Execution** — `run_plan_directly()` bypasses LLM planning, runs a validated step array immediately
- **Context-Aware Conversations** — SQLite-persisted message history with a 20-message sliding window
- **Token Usage per Thread** — stored per thread_id; frontend restores on history load
- **Voice Pipeline** — dual STT: Google SpeechRecognition + local Whisper; wake word detection via OpenWakeWord; Kokoro TTS output
- **Production-Safe Config** — settings at `~/.config/opensarthi/.env` (Linux) or `%LOCALAPPDATA%\opensarthi\.env` (Windows), database at the same folder

### Distribution & Portable Bootstrapping Flow (Linux / Windows)

- **Self-Contained Executable** — The React frontend is compiled into Tauri static assets, and the native Rust layer handles window and sidecar lifecycle.
- **Python-Free Target System** — The target machine does not need Python installed. When the user executes the packaged AppImage/executable:
  1. The Tauri Rust shell launches and spawns the bundled Rust sidecar bootstrap runner.
  2. The bootstrap runner checks for an isolated virtual environment at `~/.config/opensarthi/venv` (Linux) or `%LOCALAPPDATA%\opensarthi\venv` (Windows).
  3. If missing: it uses the bundled `uv` binary to download a standalone portable Python 3.12 interpreter, creates the venv, and installs `requirements.txt` dependencies locally.
  4. Once validated, it spawns the FastAPI Uvicorn server on a dynamically allocated port.
  5. The Tauri frontend connects over WebSockets via dynamic port negotiation, ensuring zero port conflicts.

---

## 📦 Building the AppImage / Executables

```bash
# From the repo root
PATH="$(pwd)/apps/desktop/src-tauri/mock_pkg_config:$PATH" \
NO_STRIP=true \
APPIMAGE_EXTRACT_AND_RUN=1 \
pnpm tauri build -b appimage
```

Output: `apps/desktop/src-tauri/target/release/bundle/appimage/OpenSarthi_0.1.0_amd64.AppImage`

> **Note:** The `mock_pkg_config` override is needed because the linuxdeploy GTK plugin uses `pkg-config --variable=gdk_pixbuf_binarydir` which returns incorrect paths on Arch Linux.

---

## 🛠️ Development Setup

### Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Node.js | 20+ | via nvm or system |
| pnpm | 9+ | `npm i -g pnpm` |
| Rust / Cargo | stable | `rustup update stable` |
| Python | **3.12** | Required for ML wheels |

> ⚠️ **Python 3.14+ is NOT supported.** Pre-compiled wheels for `faster-whisper`, `kokoro`, and `numpy` are not available for alpha Python releases.

### Setup

```bash
# 1. Install JS dependencies
pnpm install

# 2. Set up the Python runtime venv (Python 3.12 required)
cd runtime
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cd ..

# 3. Run in development mode
pnpm dev
```

---

## 📁 Repository Structure

```
opensarthi/
├── apps/
│   └── desktop/                     # Tauri v2 + React 19 frontend
│       ├── src/
│       │   ├── App.tsx              # Root: onboarding gate + modal state
│       │   ├── components/
│       │   │   ├── assistant/       # AssistantOverlay, TaskList (+ JSON import)
│       │   │   ├── onboarding/      # OnboardingView (cold-start + edit mode)
│       │   │   ├── execution/       # ActionLog
│       │   │   ├── permissions/     # PermissionDialog, InputDialog
│       │   │   └── settings/        # SettingsView, HistoryView
│       │   ├── hooks/
│       │   │   ├── useWebSocket.ts  # WS client, message routing, settings sync
│       │   │   └── useTauriEvent.ts # Tauri IPC events
│       │   ├── stores/
│       │   │   └── assistantStore.ts # Zustand: messages, tokens, personalization
│       │   └── styles/              # Global CSS + 5 theme token sets
│       └── src-tauri/
│           ├── src/
│           │   ├── lib.rs           # App entry, sidecar launch
│           │   ├── sidecar.rs       # Python process management & port detection
│           │   ├── tray.rs          # System tray
│           │   └── ipc.rs           # Tauri IPC commands
│           ├── binaries/
│           │   └── opensarthi-runtime-x86_64-unknown-linux-gnu  # Bootstrap
│           └── resources/
│               └── uv               # Bundled uv binary
│
├── runtime/                         # Python AI sidecar
│   ├── main.py                      # FastAPI app + port negotiation
│   ├── config.py                    # pydantic-settings (user_name, skills, etc.)
│   ├── db.py                        # SQLite: messages + thread token storage
│   ├── agent_runtime.py             # Stateful executor: cancel/pause/run/plan
│   ├── observation.py               # Desktop snapshot (screenshot + window info)
│   ├── state_machine.py             # AgentState enum + context
│   ├── sync_primitives.py           # Async helpers
│   ├── api/
│   │   └── websocket.py             # WS router, all message handlers
│   ├── planner/
│   │   ├── agent.py                 # PydanticAI agent + dynamic skill prompt
│   │   └── schemas.py               # Plan, PlanStep, ToolResult pydantic models
│   ├── tools/
│   │   ├── desktop.py               # click, type, open_app, screenshot, etc.
│   │   ├── system.py                # shell (bubblewrap sandboxed)
│   │   ├── wait_tools.py            # wait_for_window, wait_for_text
│   │   └── registry.py              # Tool registry
│   ├── providers/                   # X11/Wayland desktop providers
│   ├── voice/
│   │   ├── stt.py                   # Dual STT: Google + Whisper
│   │   └── pipeline.py              # Wake word, VAD, echo protection
│   ├── memory/                      # LanceDB vector store (stub)
│   ├── observer/                    # Screenshot + OCR pipeline (stub)
│   ├── security/                    # bubblewrap sandboxing (stub)
│   ├── llm/                         # LLM provider wrappers (stub)
│   └── mcp/                         # Model Context Protocol stubs
│
├── docs/                            # Technical documentation
│   ├── 01_frontend_and_desktop_shell.md
│   ├── 02_backend_runtime_and_infra.md
│   ├── 03_agentic_flow.md
│   └── 04_websocket_protocol.md
│
├── package.json                     # pnpm workspace root
├── pnpm-workspace.yaml
└── README.md
```

---

## 🔄 High-Level Agent Flow

```
User Input (voice or text)
        │
        ▼
  WebSocket message ──► websocket.py handler
        │
        ├─ Is it a chat? ──► agent.run() → streaming assistant_response
        │
        └─ Is it a task? ──► AgentRuntime.run()
                                 │
                                 ├─ build_structured_context()
                                 ├─ LLM generates JSON plan
                                 ├─ For each step: tool.safe_execute()
                                 ├─ Observe desktop after each step
                                 ├─ Replan if step fails (max 3 attempts)
                                 └─ Return formatted summary → frontend
```

See [`docs/03_agentic_flow.md`](./docs/03_agentic_flow.md) for detailed flowcharts.

---

## 🔮 Roadmap

- [ ] **Multi-turn Barge-In** — voice interrupt during active TTS playback
- [ ] **Local Model Preloading** — pre-fetch Ollama weights on sidecar launch
- [ ] **Wayland Window Tracking** — enhance `ydotool` for KDE/GNOME Wayland
- [ ] **MCP Server** — expose OpenSarthi tools as Model Context Protocol server
- [ ] **Memory Module** — LanceDB vector search for long-term context recall
- [ ] **Observer Pipeline** — screenshot + OCR for real-time screen understanding
- [ ] **API Key Keyring** — migrate from plaintext `.env` to `libsecret`

---

## 🔒 Security Model

- **Tauri v2 Capabilities** — frontend strictly scoped via granular permission files
- **bubblewrap Sandboxing** — shell commands run in `bwrap` with isolated filesystem
- **User Consent Dialogs** — any destructive action requires explicit user approval
- **Config Isolation** — all user data lives in `~/.config/opensarthi/`

---

## 📚 Further Reading

- [`runtime/README.md`](./runtime/README.md) — Python sidecar internals, voice pipeline, agent architecture
- [`docs/01_frontend_and_desktop_shell.md`](./docs/01_frontend_and_desktop_shell.md) — Frontend components, theming, build process
- [`docs/02_backend_runtime_and_infra.md`](./docs/02_backend_runtime_and_infra.md) — Runtime internals, providers, voice
- [`docs/03_agentic_flow.md`](./docs/03_agentic_flow.md) — Agentic loop flowcharts and decision logic
- [`docs/04_websocket_protocol.md`](./docs/04_websocket_protocol.md) — WebSocket message type reference
