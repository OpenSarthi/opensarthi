# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

OpenSarthi is an autonomous, cross-platform, voice-first AI agent with desktop automation, mobile control, and system integration capabilities.

- **Desktop Client**: Tauri v2 + React 19 + TypeScript + Vite 6 overlay HUD (Linux/Windows/macOS)
- **Android App**: Capacitor + React 19 with Python embedded in-process via Chaquopy 14.0 (port 8765)
- **Python AI Runtime Sidecar**: FastAPI + PydanticAI + LangGraph (Python 3.12) handling AI orchestration, tool execution (71 registered tools), 4-tier voice pipeline, long-term semantic memory, and WebSocket/OAuth communication

---

## Common Development Commands

### Root Level (`/opensarthi`)
```bash
pnpm install                    # Install all workspace dependencies
pnpm dev                        # Start Tauri dev mode (launches desktop UI + Python sidecar)
pnpm build                      # Build desktop application
pnpm lint                       # Lint desktop TypeScript source
pnpm typecheck                  # Type-check desktop TypeScript
pnpm runtime:dev                # Run Python runtime standalone
pnpm runtime:install            # Install Python runtime dependencies
```

### Python AI Runtime (`/opensarthi/runtime`)
```bash
python3.12 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# Run server (default: LangGraph engine enabled)
python main.py                  # Auto-negotiated port (prints PORT:<num>), OAuth loopback on 8765
USE_LANGGRAPH=false python main.py  # Run legacy stateful executor loop

# Testing
python -m unittest discover tests                     # Run all test suites
python -m unittest tests/test_registry.py             # Run single test file
python -m unittest tests.test_registry.TestRegistry.test_all_tools_have_schemas  # Run single test method
```

### Desktop App (`/opensarthi/apps/desktop`)
```bash
pnpm dev                        # Tauri dev mode with Vite HMR
pnpm typecheck                  # tsc --noEmit
pnpm lint                       # ESLint on src/
pnpm build:vite                 # Type-check + Vite production bundle

# Production AppImage build (handles Arch Linux pkg-config & AppImage FUSE quirks)
PATH="$(pwd)/src-tauri/mock_pkg_config:$PATH" \
NO_STRIP=true \
APPIMAGE_EXTRACT_AND_RUN=1 \
pnpm tauri build -b appimage
```

### Android App (`/opensarthi/apps/android`)
```bash
npm run build                   # Type-check + Vite build
npx cap sync android            # Sync web assets to native Android project
cd android && ./gradlew installDebug --no-daemon     # Build & install debug APK on connected device
cd android && ./gradlew assembleRelease --no-daemon   # Build release APK (requires -Xmx4096m heap)

# Full one-liner rebuild & deploy:
npm run build && npx cap sync android && cd android && ./gradlew installDebug --no-daemon
```

---

## High-Level Architecture

```
┌────────────────────────────────────────────────────────────┐
│              Tauri v2 Desktop Shell (Frontend)             │
│        React 19 + TypeScript + Zustand + Framer Motion     │
│       3-Panel HUD · Smart Overlay · 10 Themes · Audio Cues  │
└─────────────────────────────┬──────────────────────────────┘
                              │ WebSocket (ws://127.0.0.1:<port>/ws)
┌─────────────────────────────▼──────────────────────────────┐
│                  Python Runtime (Sidecar)                  │
│       FastAPI + PydanticAI + LangGraph (Python 3.12)       │
│                                                            │
│ ┌────────────────────────────────────────────────────────┐ │
│ │  Execution Engines (Dual):                             │ │
│ │  • LangGraph StateGraph (Default, USE_LANGGRAPH=true)  │ │
│ │  • AgentRuntime (Legacy loop, USE_LANGGRAPH=false)     │ │
│ └────────────────────────────────────────────────────────┘ │
│ ┌────────────────────────────────────────────────────────┐ │
│ │  Multi-Agent Supervisor:                               │ │
│ │  Classifies task domain & scopes 71 tools into:        │ │
│ │  WEB · CALENDAR · MAIL · BROWSER · MUSIC · SOCIAL ·    │ │
│ │  CODE · DESKTOP_UI · SHELL · MONITORING · GENERAL      │ │
│ └────────────────────────────────────────────────────────┘ │
│ ┌──────────────────────┬─────────────────────────────────┐ │
│ │ Sub-Agents:          │ Memory & Storage:               │ │
│ │ • HealerAgent        │ • Long-term Semantic SQLite     │ │
│ │ • ReviewerAgent      │   (all-MiniLM-L6-v2 embeddings) │ │
│ │ • BehavioralObserver │ • Session Memory Summarizer     │ │
│ │ • Classifier         │ • Checkpoints (SqliteSaver)     │ │
│ └──────────────────────┴─────────────────────────────────┘ │
│ ┌──────────────────────┬─────────────────────────────────┐ │
│ │ Voice Pipeline:      │ 71-Tool Registry:               │ │
│ │ • Edge-TTS (6 voices)│ • Desktop Automation (8)        │ │
│ │ • Kokoro-82M ONNX    │ • Playwright Browser (20)       │ │
│ │ • SileroVAD (ONNX)   │ • Google Workspace OAuth (4)    │ │
│ │ • FasterWhisper STT  │ • Social / Music / System (39)  │ │
│ └──────────────────────┴─────────────────────────────────┘ │
└────────────────────────────────────────────────────────────┘
```

### Dual Execution & Platform Model
- **Desktop**: Tauri spawns the Python sidecar as an external process, reading `PORT:<num>` from stdout. OAuth loopback listener runs on `http://127.0.0.1:8765/oauth2callback`.
- **Android**: Chaquopy embeds Python inside the APK in a foreground `RuntimeService` on port `8765`. `OPENSARTHI_PLATFORM=android` is set before imports to patch accessibility tools and native STT/TTS bridges.

### Core Execution Engines
1. **LangGraph StateGraph (`runtime/graph/`) — Default (`use_langgraph: bool = True`)**:
   - 9 active nodes: `classify`, `context_retrieve`, `observe`, `plan`, `execute_step`, `verify`, `heal`, `respond`, `review`, `behavioral_observe`.
   - Checkpointing: `MemorySaver` (ephemeral) or `SqliteSaver` at `~/.config/opensarthi/checkpoints.db`.
   - Self-healing safety cap: max 2 heal retries per step before full replan (max 5 full replans).
2. **AgentRuntime (`runtime/agent_runtime.py`) — Legacy (`use_langgraph: bool = False`)**:
   - Linear loop with topological step sorting for parallel execution groups (`asyncio.gather`).

### Multi-Agent Supervisor & Tool Scoping
- When `use_supervisor: bool = True` (default), the Supervisor classifies the goal into a `ToolDomain` and provides only that domain's tools plus `GENERAL` tools to the planner.
- Dynamic system prompts adapt based on user skills (e.g., removing JSON tool format when `desktop_automation` is disabled).

### 71-Tool Registry (`runtime/tools/registry.py`)
- **Desktop UI (8)**: `click`, `type_text`, `press_key`, `open_app`, `focus_window`, `click_element`, `observe_desktop`, `scroll`
- **System & Shell (1)**: `shell` (safety pattern filters, sudo password input request, bubblewrap sandbox profile support)
- **Wait Utilities (2)**: `wait_for_window`, `wait_for_text` (OCR polling)
- **Memory & Notes (5)**: `remember`, `recall`, `forget_memory`, `save_note`, `get_notes`
- **Self-Improvement & Settings (2)**: `self_fix` (code rewrite + compile test + rollback), `update_settings` (voice/text config changes)
- **Productivity & System (18)**: `web_search` (multi-engine DuckDuckGo/Gemini/Brave), `get_weather`, `weather_report`, `flight_finder`, timers, `list_files`, `open_path`, `read_file`, `set_volume`, `get_battery`, `toggle_wifi`, `system_status`, `reminder_set`, `reminder_cancel`, `monitor_control`, `agent_shutdown`
- **Terminal-First URL Opening (1)**: `open_url` via `xdg-open` / browser binary with accessibility flags (preferred over GUI click/typing)
- **Browser Automation (20 Playwright tools)**: `browser_go_to`, `browser_click`, `browser_type`, `browser_snapshot` (DOM/accessibility tree), `browser_screenshot`, `browser_scroll`, `browser_fill_form`, tab management, etc.
- **Google Workspace OAuth Read-Only (4)**: `calendar_read`, `calendar_search`, `gmail_read`, `gmail_search`
- **Music & YouTube (3)**: `youtube_search`, `youtube_control`, `music_play`
- **Social Media (6)**: `twitter_post`, `linkedin_post`, `telegram_send`, `whatsapp_send`, `discord_send`, `email_send`

### Voice & Multimodal Pipeline
- **4-Tier TTS Fallback**: Layer 0: Microsoft Edge-TTS (6 personas: `JARVIS`, `NOVA`, `ATLAS`, `ARIA`, `LUNA`, `SARTHI`) → Layer 1: Kokoro-82M ONNX offline neural → Layer 2: gTTS → Layer 3/4: System speech-dispatcher / eSpeak.
- **Speech Sanitization**: Strips XML tags (`<next_action>...</next_action>`) from response text before passing to TTS.
- **VAD & STT**: SileroVAD ONNX Runtime (CPU only, no PyTorch) + FasterWhisperSTT (local offline transcription) + OpenWakeWord ("hey sarthi", "hello sarthi").
- **Native Streaming Audio**: Sub-500ms Gemini Live / OpenAI Realtime PCM streaming over WebSocket.
- **Multimodal Desktop Observer**: Screenshots downscaled to 1280px PNG and cached (2s TTL). Injected as `ImageUrl` for vision-capable models (`send_screenshots_to_llm = True`).

### Desktop HUD & Smart Overlay (`apps/desktop/`)
- **3-Panel Layout**: `TaskList` (threads/tabs + JSON import) | `MessageList` (chat/streaming/voice) | `ActionLog` (live tool timeline/tokens).
- **Smart Overlay Mode**: Automatically collapses HUD to a 280×560 side strip (snapped right/left) or 320×440 floating window during screen-interaction actions (`window_control: minimize_hint`), auto-restoring upon task completion.
- **Styling Invariant**: Solid opaque theme backgrounds (`var(--bg-secondary)`) must be used on rounded layouts. `backdrop-filter: blur(...)` is strictly forbidden due to Linux WebKit rounded corner rendering artifacts.

---

## Important File Locations & Conventions

| File | Description |
|------|-------------|
| `runtime/config.py` | `Settings` schema (pydantic-settings), reads `~/.config/opensarthi/.env` |
| `runtime/tools/registry.py` | 71 registered tools, `get_tools_by_domain()`, `validate_registry()` |
| `runtime/planner/agent.py` | Global singleton PydanticAI `Agent`, `build_system_prompt()`, `build_structured_context()` |
| `runtime/graph/` | LangGraph `OpenSarthiState`, 9 async nodes, conditional edges, graph builder |
| `runtime/api/websocket.py` | WebSocket message dispatchers, connection sessions, settings synchronization |
| `runtime/api/routes.py` | HTTP endpoints (`/health`, `/models`, `/validate_key`, `/oauth/google/*`, `/integrations/*`) |
| `runtime/voice/pipeline.py` | PyAudio + SileroVAD + FasterWhisper + Edge-TTS/Kokoro orchestration |
| `runtime/memory/long_term.py`| SQLite semantic memory (`all-MiniLM-L6-v2` with module-level model caching) |
| `apps/desktop/src/stores/assistantStore.ts` | Central Zustand store (chat, threads, plan, tokens, settings, themes) |
| `apps/desktop/src/hooks/useWebSocket.ts` | Frontend WebSocket connection, auto-reconnect, message routing |
| `apps/desktop/src/hooks/useWindowOverlay.ts` | Smart overlay window resizing & edge snapping |
| `docs/04_websocket_protocol.md` | Canonical WebSocket protocol specification |
| `SKILLS.md` | Developer invariants, contracts, and detailed architectural notes |

---

## Environment & State Storage

- **Configuration File**:
  - Linux: `~/.config/opensarthi/.env`
  - Windows: `%LOCALAPPDATA%\opensarthi\.env`
  - Dev fallback: `runtime/.env`
- **Database (`db.py`)**: `~/.config/opensarthi/opensarthi.db` (messages, threads, tokens, notes, semantic vectors)
- **Checkpoints DB**: `~/.config/opensarthi/checkpoints.db` (LangGraph `SqliteSaver`)
- **Google OAuth Tokens**: `~/.config/opensarthi/google_tokens.json` (auto-refreshed, persistent across restarts)
- **Execution Run Logs**: `runtime/logs/agent_runs/run_<timestamp>_<id>/` (`DevLogger` captures context, raw LLM outputs, tool calls)

---

## Critical Invariants & Rules

1. **Python Version**: Strictly **Python 3.12**. ML dependencies (`faster-whisper`, `kokoro`, `onnxruntime`, `blis`) require pre-compiled wheels for 3.12. Python 3.13+ will fail.
2. **Tool Implementation**: All tools must inherit from `BaseTool` in `runtime/tools/base.py`, declare `name`, `description`, `risk_level`, and `domain`, and return `ToolResult.ok()` or `ToolResult.fail()`.
3. **No Direct Unchecked Shell Execution**: Never execute raw LLM strings via `os.system()` or `subprocess.run()`. All commands must pass through `ShellTool` with blocked safety pattern filters and risk gating.
4. **Singleton Planner Agent**: The PydanticAI `Agent` in `runtime/planner/agent.py` is a global singleton. Do not instantiate new `Agent` objects per request; pass dynamic `model` and `deps` to `run()`.
5. **No Blur Filters in Tauri WebViews**: Never use `backdrop-filter: blur(...)` in desktop CSS. Use solid CSS variable colors (`var(--bg-secondary)`) to prevent corner artifacts in WebKit/Tauri.
6. **TTS Text Sanitization**: Before passing text to speech synthesis, remove technical XML blocks (`<next_action>...</next_action>`).
7. **Version Synchronization**: When updating versions, maintain parity across:
   - `apps/desktop/package.json`
   - `apps/desktop/src-tauri/tauri.conf.json`
   - `apps/desktop/src-tauri/Cargo.toml`
