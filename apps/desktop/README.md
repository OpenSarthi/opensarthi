# OpenSarthi — Desktop Frontend

The Tauri v2 + React 19 desktop shell for OpenSarthi. Provides the HUD, theming, voice controls, onboarding, settings, chat history, JSON task import, and a real-time WebSocket connection to the Python AI runtime.

---

## 🖥️ Tech Stack

| Layer | Technology |
|-------|-----------|
| **Desktop Framework** | Tauri v2 |
| **UI Framework** | React 19 + TypeScript |
| **Bundler** | Vite 6 |
| **Animation** | Framer Motion |
| **State Management** | Zustand |
| **Styling** | Vanilla CSS with custom design tokens |
| **Icons** | Lucide React |
| **WebSocket** | Native browser WebSocket with reconnect logic |

---

## 🗂️ Component Tree

```
App.tsx  (Root — owns modal state: settings, history, customizer)
│
├── OnboardingView           (cold-start wizard OR edit-mode popup)
├── AssistantOverlay         (main HUD — always visible)
│   ├── ParticleBackground   (animated canvas layer)
│   ├── TaskList             (left panel — agentic task cards + JSON import)
│   ├── MessageList          (centre panel — chat bubbles + markdown)
│   ├── ActionLog            (right panel — live tool call log + token stats)
│   ├── VoiceButton          (mic toggle with animated waveform)
│   └── TranscriptView       (live STT transcript overlay)
├── PermissionDialog         (tool permission approval popup)
├── InputDialog              (user input request popup)
├── SettingsView             (provider → model → API key cascading flow)
└── HistoryView              (past threads list with token usage restore)
```

---

## 🖥️ HUD Layout

The main window uses a three-panel grid with draggable resize handles:

```
┌────────────────┬───────────────────────────┬────────────────┐
│  AGENT TASKS   │    CHAT / MAIN VIEW       │  LIVE PLAN &   │
│                │                           │    ACTIVITY    │
│  Task cards    │  Messages + voice input   │  Tool log +    │
│  + JSON import │  + transcript overlay     │  token stats   │
├────────────────┴───────────────────────────┴────────────────┤
│  Provider · Model · Token Usage · Session Total · Version   │
└─────────────────────────────────────────────────────────────┘
```

| Panel | Default Width | Content |
|-------|--------------|---------|
| Left | 260px | `TaskList` — agentic task cards + `+` JSON import button |
| Centre | flex-1 | Chat messages + `VoiceButton` + transcript overlay |
| Right | 240px | `ActionLog` — live tool call log + cumulative token stats |

---

## 🎯 Onboarding & Personalisation (`OnboardingView.tsx`)

### Cold-Start Mode

Shown full-screen on first launch (when `onboardingCompleted` is `false` in `localStorage`).

- **Step 1 — Skills:** 12 skill category toggles + "Select All" shortcut
- **Step 2 — Persona:** Name input + custom instructions textarea (500 char limit)
- **Step 3 — Agent Settings:** Setup AI Provider (Google, OpenAI, Anthropic, Groq, OpenRouter, Ollama), model select, and API key configuration.
- **Skip button:** Applies all defaults (all skills, no name, empty prompt, default Google Gemini config)
- On complete → `App.tsx` calls `setPersonalization()` + sends `update_settings` to backend to persist preferences

**12 Skill Categories:**

| ID | Label |
|----|-------|
| `general` | General Assistant |
| `desktop_automation` | Desktop Automation |
| `developer` | Developer & Coding |
| `system_admin` | System Admin |
| `media` | Media & Music |
| `writing` | Writing & Content |
| `research` | Research & Analysis |
| `web` | Web & Browser |
| `files` | Files & Data |
| `privacy` | Privacy Mode |
| `home_user` | Home User |
| `gaming` | Gaming & Fun |

### Edit / Customise Mode

Opened via the **Wrench (Customise) button** in the top-right HUD bar. Renders as a **straight-bracket HUD panel modal popup** over the active app — the main UI stays visible behind it:

- Pre-populates all fields from current store values
- Uses active theme color variables dynamically (accent, border, font-mono)
- Unified single-view layout: Profile & Instructions section + Agent Capabilities grid
- `X` close button (top-right) + CANCEL / SAVE CHANGES footer
- On save: updates store + syncs to backend via `update_settings` WebSocket message

---

## 🔝 Top-Right Control Buttons

Four control buttons are displayed in the HUD top bar. When the window is **maximized**, each button expands to show a text label alongside the icon:

| Button | Icon | Label (maximized) | Action |
|--------|------|------------------|--------|
| Customise | Wrench | "Customise" | Opens persona/skill edit modal |
| Past Threads | History | "Past Threads" | Opens `HistoryView` |
| New Thread | MessageSquarePlus | "New Thread" | Clears session + resets tokens |
| Settings | Settings (cog) | "Settings" | Opens `SettingsView` |

Maximization is detected via Tauri's `getCurrentWindow().onResized()` listener and stored in `isMaximized` React state.

---

## 📋 JSON Task Import (`TaskList.tsx`)

The `+` button in the Agent Tasks panel header opens a JSON import modal in the center of the viewport:

1. Paste a raw JSON step array
2. Live syntax validation — green/red border feedback with clear syntax error highlighting
3. Step preview list — shows `tool` name + `description` for each step
4. **RUN NOW** sends `run_json_plan` via WebSocket → backend executes immediately, bypassing LLM planning entirely
5. Inserts an immediate user message bubble to show plan execution starting

**Step format:**
```json
[
  { "tool": "open_app", "args": { "app": "firefox" }, "description": "Launch Firefox" },
  { "tool": "wait_for_window", "args": { "title": "Firefox", "timeout": 10 }, "description": "Wait for Firefox" }
]
```

---

## ⚙️ Settings (`SettingsView.tsx`)

Cascading three-step flow:

```
1. Select Provider  →  2. Select / Enter Model  →  3. Enter API Key  →  Save
```

| Provider | Example Models |
|----------|---------------|
| Google | `gemini-2.5-flash`, `gemini-2.0-flash` |
| OpenAI | `gpt-4o`, `gpt-4o-mini` |
| Anthropic | `claude-opus-4-5`, `claude-sonnet-4-5` |
| Groq | `llama-3.3-70b-versatile`, `mixtral-8x7b-32768` |
| OpenRouter | Free-form text input |
| Ollama | Free-form text input (local) |

- Saving with an empty API key retains the previously saved key (no accidental wipe)
- All keys stored in `~/.config/opensarthi/.env` on the backend

---

## 🗄️ Zustand Store (`assistantStore.ts`)

Single Zustand store. `onboardingCompleted` is also persisted to `localStorage`.

### Key State

```typescript
// Voice & Connection
voiceState: 'idle' | 'listening' | 'processing' | 'speaking' | 'error'
isConnected: boolean
currentTranscript: string | null

// Chat & Plans
messages: Message[]
threads: Thread[]
currentPlan: Plan | null   // {id, goal, steps[], recovery_hint}
taskPaused: boolean

// LLM Config
activeProvider: string
activeLocalModel: string
activeCloudModel: string
// ...API keys per provider

// Token Tracking
tokenUsage: {
  requestTokens / responseTokens / totalTokens       // current thread
  sessionRequestTokens / sessionResponseTokens / sessionTotalTokens  // session
}

// Personalization
userName: string
userSkills: string[]
customPrompt: string
onboardingCompleted: boolean
```

### Key Actions

| Action | Effect |
|--------|--------|
| `setPersonalization(name, skills, prompt)` | Updates personalization fields |
| `setOnboardingCompleted(bool)` | Shows/hides onboarding screen |
| `addMessage(msg)` | Appends to messages array |
| `setPlan(plan)` | Sets current agentic plan |
| `updateTokenUsage(usage)` | Accumulates token counts |
| `restoreThreadTokens(usage)` | Restores per-thread tokens on history load |
| `resetSessionTokens()` | Clears session counters on new thread |

---

## 🔌 WebSocket Hook (`useWebSocket.ts`)

Auto-connects to the Python runtime on the dynamically negotiated port. Routes all incoming messages to store actions.

| Message Type | Action |
|-------------|--------|
| `assistant_response` | Appends message, calls `updateTokenUsage` |
| `plan_created` | Calls `setPlan` |
| `tool_started` / `tool_completed` / `tool_error` | Updates step status in plan |
| `tool_action` | Appends to ActionLog |
| `tool_terminated` | Marks step as terminated |
| `voice_state` | Sets `voiceState` |
| `session_state` | Sets `isConnected` |
| `settings_sync` | Syncs all provider/model/key/personalization fields |
| `history_response` | Populates `threads` list |
| `thread_loaded` | Restores messages + calls `restoreThreadTokens` |
| `task_paused` / `task_resumed` | Sets `taskPaused` flag |

---

## 🎨 Theme System

6 themes defined in `styles/themes.css` as CSS custom property sets, applied to `document.body.className`:

| Theme ID | Palette |
|---------|---------|
| `glass-red-black` | Red accent, dark glass |
| `forest-green-black` | Green accent, dark glass |
| `deep-purple-black` | Purple accent (default), dark glass |
| `cyber-sky-white` | Cyan accent, light mode |
| `sakura-pink-white` | Pink accent, light mode |
| `simple-dark` | Gray/white accent, flat black theme |

Key CSS variables across all themes:

```css
--accent            /* main accent color */
--accent-glow       /* rgba glow version of accent */
--bg-primary        /* window background */
--bg-secondary      /* panel backgrounds */
--text-primary      /* main text */
--text-secondary    /* muted/label text */
--border            /* panel borders */
--font-mono         /* monospace font for HUD labels */
--font-sans         /* sans-serif for UI text */
```

---

## 📂 Directory Structure

```
apps/desktop/
├── src/
│   ├── main.tsx                        # Vite entry point
│   ├── App.tsx                         # Root: modal state, onboarding gate
│   ├── components/
│   │   ├── assistant/
│   │   │   ├── AssistantOverlay.tsx    # Main HUD (3-panel + controls)
│   │   │   ├── TaskList.tsx            # Task panel + JSON import modal
│   │   │   ├── VoiceButton.tsx         # Mic toggle + waveform
│   │   │   ├── Waveform.tsx            # Audio visualizer
│   │   │   ├── ParticleBackground.tsx  # Animated canvas
│   │   │   └── TranscriptView.tsx      # Live STT overlay
│   │   ├── onboarding/
│   │   │   └── OnboardingView.tsx      # Cold-start wizard + edit modal
│   │   ├── execution/
│   │   │   └── ActionLog.tsx           # Live tool call log (right panel)
│   │   ├── permissions/
│   │   │   ├── PermissionDialog.tsx    # Tool approval popups
│   │   │   └── InputDialog.tsx         # Agent input request popup
│   │   └── settings/
│   │       ├── SettingsView.tsx        # Provider → Model → Key settings
│   │       └── HistoryView.tsx         # Thread list + token restore
│   ├── hooks/
│   │   ├── useWebSocket.ts             # WS connection + message routing
│   │   └── useTauriEvent.ts            # Tauri IPC event listener
│   ├── stores/
│   │   └── assistantStore.ts           # Zustand: all app state
│   ├── lib/
│   │   ├── ws.ts                       # WS client singleton (wsClient)
│   │   ├── schemas.ts                  # Zod: WSMessageTypeSchema
│   │   └── constants.ts                # TAURI_EVENTS, etc.
│   └── styles/
│       ├── globals.css                 # Base styles, resets
│       └── themes.css                  # 5 theme token sets
│
├── src-tauri/
│   ├── src/
│   │   ├── lib.rs                      # App entry, window setup, sidecar launch
│   │   ├── sidecar.rs                  # Python process spawn, PORT: reader
│   │   ├── tray.rs                     # System tray icon + menu
│   │   └── ipc.rs                      # Tauri invoke command handlers
│   ├── binaries/
│   │   └── opensarthi-runtime-x86_64-unknown-linux-gnu  # Bootstrap script
│   ├── resources/
│   │   └── uv                          # Bundled uv binary (portable Python manager)
│   ├── mock_pkg_config/
│   │   └── pkgconf                     # gdk-pixbuf path override for AppImage
│   ├── capabilities/                   # Tauri v2 permission scoping
│   └── tauri.conf.json
│
├── package.json
├── vite.config.ts
└── tsconfig.json
```

---

## 🔧 Rust Core (`src-tauri/src/`)

| File | Responsibility |
|------|---------------|
| `lib.rs` | App bootstrap, window setup, sidecar spawn, system tray init |
| `sidecar.rs` | Spawn bootstrap script, read `PORT:xxxx` from stdout, relay stderr as logs |
| `tray.rs` | System tray icon, right-click menu (Show/Hide, Quit) |
| `ipc.rs` | `invoke()` commands exposed to frontend |

### Sidecar Bootstrap Flow

The bundled `opensarthi-runtime-x86_64-unknown-linux-gnu` script runs on launch:

1. Check for venv Python at `~/.config/opensarthi/.venv/bin/python3`
2. If missing: use bundled `uv` to install Python 3.12 and create venv
3. Validate key imports (`uvicorn`, `fastapi`, `speech_recognition`)
4. Run `python main.py` → prints `PORT:<n>` → Tauri reads it → frontend connects

---

## 🏗️ Building

### Development

```bash
# From the repo root
pnpm dev
```

Starts Vite HMR + Rust debug binary + Python sidecar and opens the window.

### Production AppImage

```bash
PATH="$(pwd)/apps/desktop/src-tauri/mock_pkg_config:$PATH" \
NO_STRIP=true \
APPIMAGE_EXTRACT_AND_RUN=1 \
pnpm tauri build -b appimage
```

Output: `src-tauri/target/release/bundle/appimage/OpenSarthi_0.1.0_amd64.AppImage`

> **Why `mock_pkg_config`?** The linuxdeploy GTK plugin runs `pkg-config --variable=gdk_pixbuf_binarydir` which returns an incorrect path on Arch Linux. The mock wrapper creates the expected directories and falls through to real `pkgconf` for all other queries.

> **Why `APPIMAGE_EXTRACT_AND_RUN`?** `linuxdeploy` itself is an AppImage needing FUSE to mount. This flag extracts and runs it directly, bypassing the FUSE requirement.

---

## 🔢 Versioning

Version must be kept in sync across three files:

| File | Field |
|------|-------|
| `apps/desktop/package.json` | `"version": "0.1.0"` |
| `apps/desktop/src-tauri/tauri.conf.json` | `"version": "0.1.0"` |
| `apps/desktop/src-tauri/Cargo.toml` | `version = "0.1.0"` |

The HUD footer reads `package.json` at compile time:
```typescript
import pkg from "../../../package.json";
// displays: OPENSARTHI v0.1.0
```

---

## 🚧 UI Backlog / Unimplemented Features

Several backend runtime features are fully implemented and emitting WebSocket events, but currently lack frontend UI components or interactions:

1. **Markdown Rendering for CHAT**: The backend routes `CHAT` requests to a conversational LLM that returns beautifully formatted Markdown and code blocks. However, `AssistantOverlay.tsx` currently strips all Markdown tags and renders raw text. *Needs: `react-markdown` integration in `MessageList`.*
2. **Intent Classification Indicator**: The backend emits `intent_classified` (`CHAT`, `TASK`, `CLARIFY`) which the frontend captures in `lastClassification`. However, this is not displayed in the UI (e.g., an icon or badge indicating whether the agent is "Thinking... (Task)" vs "Thinking... (Chat)").
3. **Live Shell Console View**: The backend emits `shell_output` lines during the execution of shell commands. The frontend captures these via `appendShellOutputLine`, but there is no terminal/console UI to actually view this streaming output.
4. **Pause/Resume & Cancel Controls**: The backend supports `pause_execution`, `resume_execution`, and `request_cancel`. However, there are no UI buttons exposed to the user to pause, resume, or abort an active agentic task.
5. **Manual TTS Toggles**: The backend supports a `manual: true/false` flag for `speak_text`, but the frontend currently doesn't expose a way for users to manually trigger TTS readings for past messages.

---

## 📚 See Also

- [`../../README.md`](../../README.md) — Monorepo overview, setup, architecture
- [`../../runtime/README.md`](../../runtime/README.md) — Python sidecar internals
- [`../../docs/01_frontend_and_desktop_shell.md`](../../docs/01_frontend_and_desktop_shell.md) — Deep-dive: components, store, WS handlers
- [`../../docs/03_agentic_flow.md`](../../docs/03_agentic_flow.md) — Agentic execution flowcharts
- [`../../docs/04_websocket_protocol.md`](../../docs/04_websocket_protocol.md) — Full WS message type reference
