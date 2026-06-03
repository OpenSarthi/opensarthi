# OpenSarthi Desktop Agent & Assistant
# Part 1: Frontend Shell, Desktop Core & UI/UX

---

> [!NOTE]
> This document describes the architecture, layout, and IPC protocol design of OpenSarthi, updated to match the latest implementation.

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────┐
│            Tauri v2 Shell               │
│   React 19 + TypeScript + Vite          │
│   (WebView Frontend)                    │
└──────────────┬──────────────────────────┘
               │ Tauri IPC (invoke/events)
┌──────────────▼──────────────────────────┐
│          Rust Native Core               │
│  Audio Capture │ Tray │ System Hooks    │
│  Screenshot    │ IPC Bridge │ Sidecar   │
└──────────────┬──────────────────────────┘
               │ WebSocket + HTTP (localhost)
┌──────────────▼──────────────────────────┐
│       Python Runtime (Sidecar)          │
│  (Covered in Part 2)                    │
└─────────────────────────────────────────┘
```

**Key decisions:**
- Tauri v2 (not v1) — granular permissions, mobile-ready IPC, system tray improvements
- Python runtime runs as a **sidecar process**, not embedded
- Frontend ↔ Rust via Tauri IPC; Frontend ↔ Python via local HTTP/WebSocket

---

## 2. Tech Stack — Frontend & Desktop Shell

### 2.1 Desktop Shell

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| **Framework** | **Tauri v2** | Lightweight (~5MB binary), Rust-powered, granular permissions, cross-platform |
| **Bundler** | **Vite 6+** | Fast HMR, native ESM, excellent Tauri integration |
| **UI Framework** | **React 19** | Ecosystem maturity, concurrent features, component model |
| **Language** | **TypeScript 5.5+** | Type safety across IPC boundaries |

### 2.2 Styling & UI Components

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| **CSS Framework** | **TailwindCSS v4** | Utility-first, tree-shaken, fast iteration |
| **Component Library** | **shadcn/ui** | Unstyled primitives, full ownership, accessible |
| **Animation** | **Framer Motion** | Declarative animations, layout transitions, gesture support |
| **Icons** | **Lucide React** | Consistent, lightweight, tree-shakeable |
| **Fonts** | **Inter** (via Google Fonts or local) | Clean, variable-weight, optimized for UI |

### 2.3 State & Communication

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| **State Management** | **Zustand** | Minimal boilerplate, outside-React access (for IPC handlers) |
| **Server State** | **TanStack Query v5** | Caching, retry, deduplication for Python API calls |
| **IPC (Rust)** | **Tauri invoke + events** | Type-safe, permission-scoped, built-in |
| **IPC (Python)** | **WebSocket + REST** | Robust, debuggable, language-agnostic |
| **Schema Validation** | **Zod** | Runtime validation of IPC payloads |

---

## 3. Rust Native Core

The Rust core handles **performance-critical, OS-level operations** that cannot run in Python or the WebView.

### 3.1 Responsibilities & Crates

| Responsibility | Rust Crate | Notes |
|---------------|-----------|-------|
| **Microphone Capture** | `cpal` (not rodio) | Low-level input streams; rodio is playback-only |
| **Audio Playback** | `rodio` | For TTS audio output |
| **System Tray** | Tauri v2 built-in `tray-icon` | Dynamic icon/menu, click handlers |
| **Screenshots** | `xcap` or platform API | Cross-platform screen capture |
| **Notifications** | `tauri-plugin-notification` | Native OS notifications |
| **Global Hotkeys** | `tauri-plugin-global-shortcut` | Wake-key activation (keyboard alternative to wake word) |
| **Sidecar Management** | `tauri-plugin-shell` | Spawn/monitor Python process |
| **Clipboard** | `tauri-plugin-clipboard-manager` | Read/write system clipboard |
| **File Dialogs** | `tauri-plugin-dialog` | Native open/save dialogs |
| **Auto-start** | `tauri-plugin-autostart` | Launch on login |
| **Logging** | `tracing` + `tracing-subscriber` | Structured logs, spans |

### 3.2 Audio Pipeline (Rust-side)

```
Microphone (cpal)
    → Ring Buffer (crossbeam channel)
    → Wake Word Check (forward to Python via IPC)
    → If triggered: stream audio to Python STT
    → TTS response audio → rodio playback
```

> [!NOTE]
> Wake word detection and STT run in **Python** (OpenWakeWord / Faster Whisper). Rust captures raw audio and streams it via IPC. This avoids duplicating ML runtimes in Rust.

### 3.3 Sidecar Architecture

The Python runtime is bundled as a **PyInstaller binary** and managed via Tauri's shell plugin:

1. Tauri spawns the Python sidecar on app launch
2. Python starts a **FastAPI** server on `127.0.0.1:<dynamic-port>`
3. Python prints the port to stdout → Rust reads it
4. Frontend connects via WebSocket to that port
5. Tauri monitors the sidecar process; restarts on crash

**Port negotiation flow:**
```
Tauri (Rust) → spawn sidecar binary
Python sidecar → find free port → bind FastAPI → print "PORT:8421" to stdout
Tauri (Rust) → read stdout → store port → emit event to frontend
Frontend → connect WebSocket to ws://127.0.0.1:8421/ws
```

---

## 4. IPC Protocol Design

### 4.1 Frontend ↔ Rust (Tauri IPC)

Used for: tray control, audio control, screenshots, native dialogs, hotkeys.

```typescript
// Example: Tauri invoke (type-safe)
const screenshot = await invoke<Uint8Array>('capture_screen', { region: null });
const audioState = await invoke<boolean>('toggle_microphone');
```

### 4.2 Frontend ↔ Python (WebSocket)

Used for: AI interactions, tool execution status, transcript updates.

**Message Schema (JSON):**
```typescript
interface WSMessage {
  id: string;           // UUID for request correlation
  type: WSMessageType;
  payload: unknown;
  timestamp: number;
}

type WSMessageType =
  // Incoming Messages (Client -> Server)
  | 'run_json_plan'        // Request to execute pre-built JSON plan directly
  | 'user_message'         // User text/voice prompt
  | 'session_state'        // Voice session active/inactive toggle
  | 'voice_state'          // Manual/automatic voice listening states
  | 'new_chat'             // Trigger a new chat thread
  | 'cancel_execution'     // Request cancellation of active agent task
  | 'pause_execution'      // Request pausing of active execution
  | 'resume_execution'     // Request resuming of paused execution
  | 'permission_response'  // User response to permission dialog
  | 'input_response'       // User response providing text input (like sudo password)
  | 'get_history'          // Query chat history list
  | 'delete_thread'        // Delete a specific chat thread

  // Outgoing Messages (Server -> Client)
  | 'agent_state'          // Agent state broadcast (e.g. idle, planning, executing)
  | 'tool_action'          // Real-time tool action execution state update
  | 'permission_request'   // Request approval for dangerous operations
  | 'input_request'        // Request arbitrary input from the user (e.g. sudo password)
  | 'speech_started'       // Event signifying TTS playback started
  | 'speech_completed'     // Event signifying TTS playback completed
  | 'assistant_response'   // Final completion response with token usage
  | 'plan_created'         // Plan steps outline event
  | 'tool_terminated'      // Triggered when plan steps are aborted/cancelled
  | 'task_paused'          // Confirmation of paused state
  | 'task_resumed'         // Confirmation of resumed state
  | 'history_response'     // Historical conversation list payload
  | 'error';               // Error reporting event
```

### 4.3 Rust ↔ Python (Audio Streaming)

For real-time audio: use a **Unix domain socket** (not WebSocket) for lower latency.

```
Rust (cpal) → raw PCM chunks → Unix socket → Python (Faster Whisper)
Python (Piper TTS) → synthesized PCM → Unix socket → Rust (rodio)
```

---

## 5. Frontend Architecture

### 5.1 Directory Structure

```
apps/desktop/
├── src/
│   ├── main.tsx                    # Entry point
│   ├── App.tsx                     # Root layout + routing
│   │
│   ├── components/
│   │   ├── ui/                     # shadcn/ui primitives
│   │   ├── assistant/
│   │   │   ├── AssistantOverlay.tsx # Main floating window
│   │   │   ├── VoiceButton.tsx     # Mic toggle with waveform
│   │   │   ├── Waveform.tsx        # Audio visualizer
│   │   │   ├── TranscriptView.tsx  # Live STT transcript
│   │   │   └── ResponseBubble.tsx  # AI response display
│   │   ├── execution/
│   │   │   ├── ActionLog.tsx       # Tool execution timeline
│   │   │   ├── ScreenPreview.tsx   # Screenshot display
│   │   │   └── PlanViewer.tsx      # Current plan steps
│   │   ├── permissions/
│   │   │   └── PermissionDialog.tsx # Confirm dangerous actions
│   │   └── settings/
│   │       ├── SettingsPanel.tsx
│   │       ├── ModelSettings.tsx
│   │       ├── VoiceSettings.tsx
│   │       └── PermissionSettings.tsx
│   │
│   ├── stores/
│   │   ├── assistantStore.ts       # Conversation, session state
│   │   ├── audioStore.ts           # Mic state, volume, waveform data
│   │   ├── executionStore.ts       # Current plan, tool status
│   │   └── settingsStore.ts        # User preferences
│   │
│   ├── hooks/
│   │   ├── useWebSocket.ts         # WebSocket connection + reconnect
│   │   ├── useTauriEvent.ts        # Tauri event listener wrapper
│   │   ├── useAudio.ts             # Audio control via Tauri invoke
│   │   └── usePermission.ts        # Permission dialog flow
│   │
│   ├── lib/
│   │   ├── ipc.ts                  # Typed Tauri invoke wrappers
│   │   ├── ws.ts                   # WebSocket client
│   │   ├── schemas.ts              # Zod schemas for IPC payloads
│   │   └── constants.ts
│   │
│   └── styles/
│       └── globals.css             # Tailwind base + custom tokens
│
├── index.html
├── vite.config.ts
├── tailwind.config.ts
├── tsconfig.json
└── package.json
```

### 5.2 Zustand Store Design

```typescript
// assistantStore.ts — core shape
interface AssistantState {
  sessionActive: boolean;
  messages: Message[];
  currentTranscript: string | null;
  currentPlan: PlanStep[] | null;
  executingToolIndex: number | null;
  isProcessing: boolean;

  // Actions
  startSession: () => void;
  endSession: () => void;
  addMessage: (msg: Message) => void;
  updateTranscript: (text: string) => void;
  setPlan: (plan: PlanStep[]) => void;
  updateToolStatus: (index: number, status: ToolStatus) => void;
}
```

---

## 6. UI/UX Design

### 6.1 MVP UI Components

#### Floating Assistant Window
- **Always-on-top** overlay (toggleable)
- **Compact mode**: small circular voice button with pulsing animation
- **Expanded mode**: transcript + action log + response
- **Resizable/draggable** via Tauri window APIs
- **Glassmorphism** backdrop with blur

#### Voice Button States
| State | Visual |
|-------|--------|
| Idle | Subtle pulse animation, muted color |
| Listening | Active waveform, accent glow |
| Processing | Spinner/loading dots |
| Speaking | Waveform (TTS output) |
| Error | Red flash, retry icon |

#### Action Log Timeline
- Vertical timeline showing each tool execution step
- Color-coded: pending (gray), running (blue pulse), success (green), error (red)
- Expandable to show tool arguments and observations
- Auto-scrolls to current step

#### Permission Dialogs
- Modal overlay with clear description of the action
- Shows: command/action, risk level, affected resources
- Buttons: **Allow Once**, **Allow Always**, **Deny**
- Auto-deny after 30s timeout

### 6.2 Design Tokens & Themes

OpenSarthi supports 6 premium themes (Red-Black, Green-Black, Purple-Black, Cyber-Sky, Sakura-Pink, and Simple Dark). Visual elements are entirely configured via HSL/RGBA CSS custom properties matching the active theme:

```css
/* Example design tokens */
:root {
  --bg-primary: hsl(220, 20%, 8%);
  --bg-secondary: hsl(220, 18%, 12%);
  --bg-glass: hsla(220, 20%, 15%, 0.6);
  --text-primary: hsl(0, 0%, 95%);
  --text-secondary: hsl(220, 10%, 60%);
  --accent: hsl(250, 80%, 65%);        /* Purple-blue default */
  --accent-glow: hsla(250, 80%, 65%, 0.3);
  --success: hsl(150, 60%, 50%);
  --warning: hsl(40, 90%, 55%);
  --danger: hsl(0, 70%, 55%);
  --border: hsla(220, 15%, 30%, 0.5);
}
```

Modals like the **Customise Persona & Skills** modal and **MCP Settings** modal use the straight-bracket HUD styling (`.hud-panel`) to maintain consistency with the rest of the workspace panels. All four corner ticks render dynamically based on the active theme's `--border` and `--accent` parameters, ensuring unified aesthetics.

---

### 6.3 Future UI (Post-MVP)

| Feature | Description |
|---------|-------------|
| **Desktop Overlays** | Highlight elements the agent is interacting with (bounding boxes on screen) |
| **Workflow Editor** | Visual drag-and-drop workflow builder |
| **Reasoning Graph** | Live visualization of the planning loop |
| **Memory Inspector** | Browse/search/delete stored memories |
| **Quick Actions Palette** | Cmd+K style launcher for common commands |

---

### 6.4 UI Backlog / Unimplemented Backend Features

The Python backend runtime currently supports several capabilities that emit WebSocket events, but these lack corresponding UI components or handlers in the React frontend:

| Missing UI Feature | Backend Event / Property | Description |
|--------------------|--------------------------|-------------|
| **Markdown Rendering** | `assistant_response` | The backend `CHAT` handler sends properly formatted Markdown and code blocks, but `AssistantOverlay.tsx` strips Markdown rendering it as plain text. Requires a `react-markdown` integration. |
| **Intent Indicators** | `intent_classified` | The backend dynamically classifies tasks (`CHAT`, `TASK`, `CLARIFY`), but the UI does not visually distinguish these intents (e.g., no "Thinking (Task)" badge). |
| **Live Shell Output Console** | `shell_output` | The `ShellTool` streams stdout line-by-line. The frontend stores this, but lacks a terminal/console window to actually view the stream. |
| **Pause/Cancel Controls** | `pause_execution`, `request_cancel` | The backend planner can be paused or aborted mid-execution, but the UI lacks corresponding "Pause", "Resume", or "Cancel Plan" buttons. |
| **Manual TTS Playback** | `manual` flag in `speak_text` | The backend supports reading text manually without triggering continuous listening, but the UI lacks a "Read Aloud" button on past messages. |

---

## 7. Monorepo Structure

```
ai-desktop-agent/
│
├── apps/
│   └── desktop/                    # Tauri v2 + React app
│       ├── src/                    # React frontend (see §5.1)
│       ├── src-tauri/              # Rust core
│       │   ├── src/
│       │   │   ├── main.rs
│       │   │   ├── audio.rs        # cpal mic capture
│       │   │   ├── tray.rs         # System tray setup
│       │   │   ├── sidecar.rs      # Python process management
│       │   │   ├── screenshot.rs   # Screen capture
│       │   │   ├── ipc.rs          # IPC commands & events
│       │   │   └── hotkeys.rs      # Global shortcuts
│       │   ├── Cargo.toml
│       │   ├── tauri.conf.json
│       │   └── capabilities/       # Tauri v2 permission caps
│       ├── package.json
│       └── vite.config.ts
│
├── runtime/                        # Python runtime (see Part 2)
│
├── shared/
│   └── schemas/                    # Shared JSON schemas (IPC contracts)
│       ├── messages.schema.json
│       └── tools.schema.json
│
├── scripts/
│   ├── dev.sh                      # Start Tauri + Python in dev mode
│   ├── build.sh                    # Full production build
│   ├── bundle-sidecar.sh           # PyInstaller packaging
│   └── lint.sh
│
├── docs/
│   ├── architecture.md
│   ├── ipc-protocol.md
│   └── contributing.md
│
├── .github/
│   └── workflows/
│       └── ci.yml
│
├── package.json                    # Root workspace (pnpm)
├── pnpm-workspace.yaml
└── README.md
```

**Package manager:** `pnpm` (workspaces, fast, disk-efficient)

---

## 8. Tauri v2 Configuration Highlights

### 8.1 Capabilities (Permission Scoping)

```json
// src-tauri/capabilities/main.json
{
  "identifier": "main-window",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "shell:allow-spawn",
    "shell:allow-stdin-write",
    "notification:default",
    "global-shortcut:allow-register",
    "clipboard-manager:allow-read",
    "clipboard-manager:allow-write",
    "dialog:allow-open",
    "dialog:allow-save"
  ]
}
```

### 8.2 Window Configuration

```json
{
  "windows": [
    {
      "label": "main",
      "title": "AI Desktop Agent",
      "width": 420,
      "height": 680,
      "resizable": true,
      "alwaysOnTop": true,
      "transparent": true,
      "decorations": false,
      "skipTaskbar": false
    }
  ]
}
```

---

## 9. Development Workflow

### 9.1 Dev Environment Setup

```bash
# Prerequisites
rustup update stable          # Rust toolchain
pnpm install                  # Node dependencies
python -m venv .venv          # Python venv (for runtime/)
pip install -r runtime/requirements.txt

# Development
pnpm dev                      # Starts Tauri dev + Python sidecar
```

### 9.2 Frontend Dev Priorities (Build Order)

| Priority | Task | Depends On |
|----------|------|------------|
| **P0** | Tauri v2 shell bootstrapping (Vite + React) | — |
| **P0** | System tray with show/hide toggle | P0 shell |
| **P1** | WebSocket client + connection management | Python runtime |
| **P1** | Zustand stores (assistant, audio, execution) | — |
| **P2** | Voice button + waveform visualizer | Rust audio module |
| **P2** | Transcript view (live STT display) | WebSocket |
| **P3** | Action log timeline | WebSocket tool events |
| **P3** | Permission dialog system | WebSocket permission events |
| **P4** | Settings panel | — |
| **P5** | Desktop overlays / highlight system | Automation layer |

---

## 10. Key Recommendations & Deviations from Original Spec

| Original Proposal | Recommendation | Why |
|-------------------|---------------|-----|
| WebSocket only for IPC | **WebSocket + REST + Unix socket** | REST for request/response (settings, config); WS for streaming (transcripts, events); Unix socket for audio (lowest latency) |
| Unspecified bundler | **Vite 6+** | Fastest HMR, native ESM, Tauri-recommended |
| Unspecified package manager | **pnpm** | Workspace support, fast, disk-efficient |
| Separate `core/rust-core/` dir | **Colocated in `apps/desktop/src-tauri/`** | Tauri v2 convention; avoids complex Cargo workspace linking for the shell |
| TailwindCSS (unversioned) | **TailwindCSS v4** | New engine, CSS-first config, faster |
| No schema validation mentioned | **Zod + JSON Schema** | Critical for type-safe IPC across 3 languages |
| No query/cache layer | **TanStack Query v5** | Deduplication, caching, retry for Python API calls |

---

## 11. Window Overlay & Snapping Transition

To improve user experience on single-monitor setups during automation, OpenSarthi features a dynamic, translucent window overlay mode that collapses during active execution:

### 11.1 Transition Behavior
- **Auto-Collapse**: When an agent task begins execution, the main window stores its current size, position, and maximization state, then transitions into a compact overlay window (`340x560` logical pixels) set to `alwaysOnTop = true` and `decorations = false` (transparent borderless glass).
- **Auto-Restore**: Once the task is completed, paused, or canceled, the window automatically restores its original position, dimensions, and maximization state, returning focus to the chat HUD.
- **Manual Control**: An expand icon button is available in the compact view header to manually restore full window dimensions at any point.

### 11.2 Native Dragging & Edge Snapping
- **Native OS Dragging**: Dragging is initiated via Tauri's `appWindow.startDragging()`, letting the native OS handle the drag-and-drop mechanics smoothly.
- **Edge Snapping**: Position changes are tracked via the `onMoved` event listener. When dragging stops (debounced by 300ms) within a `100px` threshold of the left or right monitor boundaries, the window automatically snaps/docks to the corresponding edge (`x = 8` or `x = monitorWidth - windowWidth - 8`).

---

> [!TIP]
> **Next:** See **Part 2** for the Python runtime, AI orchestration, automation layer, voice pipeline, security model, memory system, and backend development priorities.
