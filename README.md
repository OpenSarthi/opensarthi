# OpenSarthi — AI Desktop & Mobile Agent

> A local-first, voice-driven AI agent that controls your Desktop and Android device — powered by any LLM provider.

[![Python 3.12](https://img.shields.io/badge/python-3.12-blue.svg)](https://python.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## What is OpenSarthi?

OpenSarthi is an **agentic AI assistant** that can:

- 🗣️ **Speak and listen** — full voice pipeline with wake word detection, STT, and TTS
- 🖥️ **Automate your desktop** — click, type, take screenshots, run shell commands, control apps
- 📱 **Run on Android** — same agent brain packaged as a native app via Capacitor + Chaquopy
- 🤖 **Work with any LLM** — Google Gemini, OpenAI, Anthropic, Groq, OpenRouter, or local Ollama
- 🧵 **Manage conversations** — multi-thread history, per-thread context, token tracking
- 🔧 **Extend with skills** — configurable capability profiles per user
- 🔀 **LangGraph Orchestration** — optional stateful graph with crash-recovery checkpointing (`USE_LANGGRAPH=true`)
- 💬 **Word-by-word streaming** — typing animation on both Desktop and Android chat responses

---

## Repository Layout

```
opensarthi/
├── apps/
│   ├── desktop/          # Tauri + React desktop app (Linux/Windows/macOS)
│   └── android/          # Capacitor + React Android app
├── runtime/              # Shared Python FastAPI backend (agent brain)
├── docs/                 # Technical documentation
├── SKILLS.md             # Available agent skills / capabilities
└── README.md             # This file
```

### `apps/desktop`
The desktop application built with **Tauri** (Rust) and **React**. Communicates with the runtime over a local WebSocket. Supports:
- Overlay HUD window always-on-top
- System tray integration
- Native file system and shell access
- Multi-tab conversation threads
- Word-by-word streaming chat responses

→ [Desktop README](apps/desktop/README.md)

### `apps/android`
The Android application built with **Capacitor** and **React**. The Python runtime is embedded directly in the APK via **Chaquopy**. Supports:
- Native Android STT via `SpeechRecognizer` with continuous listening
- Native TTS via `TextToSpeech` with pause/resume during speech
- Wake word detection via partial transcript monitoring
- Word-by-word streaming typing animation (identical to desktop)
- Onboarding, settings, thread history — full feature parity with desktop (minus MCP)

→ [Android README](apps/android/README.md)

### `runtime/`
The shared Python backend — a **FastAPI** server with WebSocket endpoint on port 8765. Contains:
- **Dual execution mode**: LangGraph stateful graph (`USE_LANGGRAPH=true`) or legacy `AgentRuntime`
- LLM provider adapters (Gemini, OpenAI, Anthropic, Groq, OpenRouter, Ollama)
- Voice pipeline (desktop: Vosk + pyttsx3 / Android: native SpeechRecognizer + TTS)
- Tool implementations (shell, file, browser, screen, app launcher, etc.)
- Thread persistence and token tracking
- Word-by-word streaming via `Session.stream_text()`

→ [Runtime README](runtime/README.md)

---

## Documentation

| Document | Description |
|----------|-------------|
| [01 — Frontend & Desktop Shell](docs/01_frontend_and_desktop_shell.md) | React UI architecture, Tauri integration, component structure |
| [02 — Backend Runtime & Infra](docs/02_backend_runtime_and_infra.md) | FastAPI server, tool registry, LLM adapters |
| [03 — Agentic Flow](docs/03_agentic_flow.md) | Planning, execution, self-healing, intent classification |
| [04 — WebSocket Protocol](docs/04_websocket_protocol.md) | Full message reference for frontend↔backend communication |
| [05 — Android Implementation](docs/05_android_implementation.md) | Capacitor, Chaquopy, build guide, voice bridge, PiP roadmap |

---

## Quick Start

### Desktop

```bash
pnpm install
cd apps/desktop
pnpm tauri dev
```

### Android

```bash
pnpm install
cd apps/android
npm run build
npx cap sync android
cd android && ./gradlew installDebug --no-daemon
```

See [Android Implementation Guide](docs/05_android_implementation.md) for full details.

---

## Supported LLM Providers

| Provider | Models | Notes |
|----------|--------|-------|
| Google Gemini | 2.5 Flash, 2.5 Pro, 2.0 Flash | Recommended default |
| OpenAI | GPT-4o, GPT-4o Mini, GPT-4 Turbo | |
| Anthropic | Claude Opus/Sonnet/Haiku | |
| Groq | Llama 3.3 70B, Llama 3.1 8B | Ultra-fast inference |
| OpenRouter | Any model via unified API | Access 100+ models |
| Ollama | llama3, phi3, mistral, custom | 100% local, no API key |

---

## Skills & Capabilities

→ See [SKILLS.md](SKILLS.md) for the full list of agent capabilities and how to configure them.

---

## License

MIT — see [LICENSE](LICENSE)
