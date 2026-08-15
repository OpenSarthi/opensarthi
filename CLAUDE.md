# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

OpenSarthi is a cross-platform AI agent with voice interaction, desktop automation, and mobile support. It consists of:

- **Tauri v2 + React 19** desktop app (Linux/Windows/macOS)
- **Capacitor + React 19** Android app with embedded Python runtime via Chaquopy
- **FastAPI + LangGraph** Python sidecar (the "runtime") handling all AI orchestration, tool execution, voice processing, memory, and WebSocket communication

## Repository Structure

```
opensarthi/
├── apps/
│   ├── desktop/          # Tauri + React desktop overlay client
│   └── android/          # Capacitor + React Android app wrapper
├── runtime/              # FastAPI + LangGraph Python sidecar (agent brain)
├── docs/                 # Architectural & protocol design specifications
├── SKILLS.md             # Developer guidelines & capabilities source-of-truth
├── pnpm-workspace.yaml   # pnpm workspace config
└── package.json          # Root package.json with workspace scripts
```

## Common Development Commands

### Root Level (from `/opensarthi`)
```bash
pnpm install                    # Install all workspace dependencies
pnpm dev                        # Start Tauri dev (desktop)
pnpm build                      # Build desktop app
pnpm lint                       # Lint desktop TypeScript
pnpm typecheck                  # Type-check desktop TypeScript
pnpm tauri                      # Run Tauri CLI commands
pnpm runtime:dev                # Run Python runtime standalone
pnpm runtime:install            # Install Python dependencies
```

### Desktop App (from `/opensarthi/apps/desktop`)
```bash
pnpm dev                        # Tauri dev mode
pnpm build                      # Build AppImage (tauri build -b appimage)
pnpm build:vite                 # Type-check + Vite build only
pnpm lint                       # ESLint on src/
pnpm typecheck                  # tsc --noEmit
```

### Android App (from `/opensarthi/apps/android`)
```bash
npm run build                   # Type-check + Vite build
npx cap sync android            # Sync to native Android project
cd android && ./gradlew installDebug --no-daemon  # Build & install APK
# Quick one-liner:
npm run build && npx cap sync android && cd android && ./gradlew installDebug --no-daemon
```

### Python Runtime (from `/opensarthi/runtime`)
```bash
python3.12 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python main.py                  # Starts FastAPI on auto-negotiated port (prints PORT:<num>)
USE_LANGGRAPH=true python main.py  # Run with LangGraph engine
python -m unittest discover tests  # Run tests
```

### Testing
```bash
# Python runtime tests
cd runtime && python -m unittest discover tests

# Frontend type-check
cd apps/desktop && pnpm typecheck
cd apps/android && npm run build  # includes tsc --noEmit
```

## High-Level Architecture

### Dual Execution Model
- **Desktop**: Tauri spawns Python sidecar as separate process → communicates via WebSocket
- **Android**: Chaquopy embeds Python inside APK → FastAPI runs on localhost:8765 in-process

### Runtime Core Components

**Entry Points:**
- `main.py` — Desktop entry, binds to OS-assigned port, prints `PORT:<num>`
- `main_android.py` — Android entry, fixed port 8765

**Execution Engines (dual):**
- `agent_runtime.py` — Legacy stateful executor (default, `USE_LANGGRAPH=false`)
- `graph/` — LangGraph state machine (`USE_LANGGRAPH=true`)

**Agentic Intelligence (fire-and-forget sub-agents):**
- `agents/healer.py` — HealerAgent: heuristic/quick-fix on step failure
- `agents/reviewer.py` — ReviewerAgent: post-task lesson extraction → long-term memory
- `agents/behavioral_observer.py` — BehavioralObserver: implicit preference learning

**Memory System:**
- `memory/long_term.py` — Semantic SQLite with `all-MiniLM-L6-v2` embeddings (cached)
- `memory/manager.py` — Unified MemoryManager
- `memory/passive.py` — Passive extraction hook
- `db.py` — SQLite: messages, threads, tokens, notes, long_term_memories

**Voice Pipeline (`voice/`):**
- `pipeline.py` — Full pipeline: PyAudio → SileroVAD(ONNX) → FasterWhisper STT → TTS
- `stt.py` — FasterWhisperSTT (local offline)
- `vad.py` — SileroVAD via ONNX Runtime (no PyTorch)
- `wakeword.py` — OpenWakeWord detector
- `android_bridge.py` — Android STT/TTS bridge via Chaquopy

**Tool Registry (`tools/registry.py`):** 32 tools registered
- Desktop: click, type_text, press_key, open_app, focus_window, click_element, observe_desktop
- System: shell (bubblewrap-sandboxed on Linux)
- Wait: wait_for_window, wait_for_text (OCR polling)
- Memory: remember, recall, forget_memory
- Notes: save_note, get_notes
- Self-Improvement: self_fix (AI rewrite + compile verify + rollback)
- Settings: update_settings (conversational settings control)
- Productivity: web_search, get_weather, timers, files, volume, battery, wifi
- Media: media_control

**LangGraph Graph (`graph/`):**
- `state.py` — OpenSarthiState (full typed state schema)
- `nodes.py` — 8 async node implementations
- `edges.py` — Conditional edge routing
- `graph.py` — StateGraph builder, checkpointer (MemorySaver / SqliteSaver)

**API (`api/websocket.py`):** All WebSocket message handlers

### Planned Architecture (Mark-L Parity Features)

The roadmap adds:
- **Native Audio Pipeline** — Gemini Live / OpenAI Realtime streaming (sub-500ms)
- **Multi-Agent Supervisor** — WebAgent, CalendarAgent, MailAgent, CodeAgent, BrowserAgent, MusicAgent, SocialAgent
- **Two-Phase Morning Briefing** — Instant greeting + background parallel fetch
- **Instant Vision Acknowledgment** — Immediate "looking" state
- **Parallel Search** — Multi-engine first-wins pattern
- **Session Memory** — Consumed after use (1-2 sentence summaries)
- **Content Panel** — 4th UI panel for rich content (8 types)
- **Google OAuth Read-Only** — calendar.readonly + gmail.readonly
- **42+ New Tools** — Browser automation (15+ actions), command execution, music, social media, code agent

## Key Files to Understand

| File | Purpose |
|------|---------|
| `runtime/config.py` | All settings schema (pydantic-settings), reads `~/.config/opensarthi/.env` |
| `runtime/tools/registry.py` | TOOL_REGISTRY with all 32 tools, schemas, validation |
| `runtime/planner/agent.py` | PydanticAI planner, dynamic system prompt, structured context |
| `runtime/graph/state.py` | OpenSarthiState — full LangGraph state schema |
| `runtime/api/websocket.py` | WebSocket protocol handlers (all message types) |
| `docs/04_websocket_protocol.md` | Canonical WebSocket message reference |
| `runtime/voice/pipeline.py` | Voice pipeline orchestration |
| `SKILLS.md` | Developer guidelines & invariants |

## Important Invariants (from SKILLS.md)

- **Dual Process Invariant**: Desktop = Tauri + Python separate (WebSocket); Android = Python in-process via Chaquopy
- **Safety Gating**: Modifying/deleting/shell operations require user authorization unless `SAFE`
- **Typing Animations**: Word-by-word streaming via `stream_chunk` WebSocket messages
- **Speed-First Architecture**: Native audio (<500ms), two-phase briefing, instant vision ack, parallel search, session memory consumed after use
- **Read-Only OAuth**: Google Calendar.readonly + Gmail.readonly for briefing data

## Python Version

**Use Python 3.12 exactly.** ML packages (faster-whisper, kokoro, numpy, blis) require pre-compiled wheels for 3.12. Python 3.13+ will fail.

## Environment Configuration

Settings location:
- Linux: `~/.config/opensarthi/.env`
- Windows: `%LOCALAPPDATA%\opensarthi\.env`
- Dev fallback: `runtime/.env`

Key settings: `GEMINI_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `ai_provider`, `cloud_model`, `local_model`, `voice_accent`, `voice_speed`, `wake_words`, `continuous_listening`, `long_term_memory_enabled`

## Testing Notes

- Python tests use `unittest` + `IsolatedAsyncioTestCase`
- Run from `runtime/` directory: `python -m unittest discover tests`
- Frontend: `pnpm typecheck` in each app directory