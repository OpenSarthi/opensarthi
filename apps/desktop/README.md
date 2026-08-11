# OpenSarthi — Desktop Frontend

The Tauri v2 + React 19 desktop shell for OpenSarthi. Provides the AI HUD overlay, smart window minimize/restore, multi-tab threads, voice pipeline, settings, markdown response rendering, audio cues, JSON task import, and a real-time WebSocket connection to the Python AI runtime.

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
| **WebSocket** | Native browser WebSocket with auto-reconnect |
| **Markdown** | react-markdown + remark-gfm |

---

## 🗂️ Component Tree

```
App.tsx  (Root — owns modal state + tab management)
│
├── OnboardingView           (cold-start wizard OR edit-mode popup)
├── AssistantOverlay         (main HUD — full window mode)
│   ├── ParticleBackground   (animated canvas layer, state-aware)
│   ├── TaskList             (left panel — multi-tab threads + JSON import)
│   ├── MessageList          (centre — chat bubbles, markdown, streaming)
│   │   └── ResponseBubble   (per-message: markdown, code blocks, tables, URLs, typing animation)
│   ├── ActionLog            (right panel — live tool log + cumulative plan + token stats)
│   ├── VoiceButton          (mic toggle with waveform animation)
│   ├── TranscriptView       (live STT overlay)
│   └── OverlayIdleView      (compact strip shown when window is in overlay mode)
├── PermissionDialog         (tool permission approval popup)
├── InputDialog              (agent user-input request popup)
├── SettingsView             (tabbed settings: AI · Voice · UI · Memory)
└── HistoryView              (past threads list with token restore)
```

---

## 🖥️ HUD Layout

The main window uses a three-panel grid with draggable resize handles. Panel widths are persisted to `localStorage`.

```
┌────────────────┬───────────────────────────┬────────────────┐
│  AGENT TASKS   │    CHAT / MAIN VIEW       │  LIVE PLAN &   │
│                │                           │    ACTIVITY    │
│  Multi-tab     │  Messages + streaming     │  Tool log +    │
│  threads +     │  response + voice input   │  cumulative    │
│  JSON import   │  + transcript overlay     │  plan steps +  │
│                │                           │  token stats   │
├────────────────┴───────────────────────────┴────────────────┤
│  Provider · Model · Token Usage · Session Total · Version   │
└─────────────────────────────────────────────────────────────┘
```

| Panel | Default Width | Content |
|-------|-------------|---------|
| Left | 260px | `TaskList` — multi-tab thread list + JSON import button |
| Centre | flex-1 | Chat messages + `VoiceButton` + transcript overlay + streaming response |
| Right | 240px | `ActionLog` — live tool calls, cumulative plan steps, token stats |

---

## 🔄 Smart Overlay Mode

When the agent detects screen-interaction tasks (`click`, `type_text`, `open_app`, etc.), the window automatically collapses to a compact **280×560 overlay strip** positioned at the right screen edge. This stays visible above all other windows so the user can monitor task progress without obstructing the desktop.

### Overlay States

| State | Size | Position |
|-------|------|----------|
| **Snapped Right** | 280×560 | Right screen edge |
| **Snapped Left** | 280×560 | Left screen edge |
| **Floating** | 320×440 | User-dragged position |

### Overlay Behaviors

- **Auto-minimize on task start** — triggered by `window_control → minimize_hint` from backend
- **Auto-restore on task end** — triggered by `window_control → restore` from backend
- **User override** — clicking Expand during task sets `userExpandedDuringTask` flag; auto-collapse is suppressed
- **Edge snapping** — drag near screen edge to snap (300ms debounce)
- **Always-on-top** — set in overlay mode, cleared on restore
- **Wayland fix** — 150ms deferred `setAlwaysOnTop()` call to handle compositor resets

### `OverlayIdleView` (compact strip)

When in overlay mode and no task is running, shows:
- Voice state indicator (IDLE / LISTENING / PROCESSING / SPEAKING / ERROR)
- Last 8 chat messages with smart strip layout
- Expandable last assistant reply
- Text input + mic button
- Voice state color indicator

---

## 🎯 Onboarding & Personalisation (`OnboardingView.tsx`)

### Cold-Start Mode

Shown full-screen on first launch (`onboardingCompleted` = false in localStorage).

- **Step 1 — Skills:** 12 skill category toggles + "Select All" shortcut
- **Step 2 — Persona:** Name input + custom instructions (500 char limit)
- **Step 3 — Agent Settings:** Provider, model, API key configuration
- **Skip button:** Applies all defaults (all skills, no name, Google Gemini)
- On complete → calls `setPersonalization()` + sends `update_settings` to backend

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

Opened via the **Wrench (Customise) button** in the top-right HUD bar. Renders as a straight-bracket HUD panel modal over the active app:
- Pre-populates all fields from current store values
- Unified view: Profile & Instructions + Agent Capabilities grid
- CANCEL / SAVE CHANGES footer → syncs to backend via `update_settings`

---

## 🔝 Top-Right Control Buttons

Four control buttons in the HUD top bar. When **maximized**, each expands to show a text label:

| Button | Icon | Label (maximized) | Action |
|--------|------|------------------|--------|
| Customise | Wrench | "Customise" | Opens persona/skill edit modal |
| Past Threads | History | "Past Threads" | Opens `HistoryView` |
| New Thread | MessageSquarePlus | "New Thread" | Adds a new tab + resets tokens |
| Settings | Settings (cog) | "Settings" | Opens `SettingsView` |

A persistent **STOP** button appears in the top bar when a task is running. Clicking it sends `cancel_execution` to the backend.

---

## 📋 JSON Task Import

The `+` button in the Agent Tasks panel opens a JSON import modal:

1. Paste a raw JSON step array
2. Live syntax validation — green/red border + error display
3. Step preview list — shows `tool` name + `description`
4. **RUN NOW** → sends `run_json_plan` via WebSocket → backend runs immediately (no LLM planning)

**Step format:**
```json
[
  { "tool": "open_app", "args": { "app": "firefox" }, "description": "Launch Firefox" },
  { "tool": "wait_for_window", "args": { "title": "Firefox", "timeout": 10 }, "description": "Wait for Firefox" }
]
```

---

## ⚙️ Settings (`SettingsView.tsx`)

Settings are organized in four tabs:

### AI Settings Tab

- **Provider** dropdown: Ollama · Google · OpenAI · Anthropic · Groq · OpenRouter
- **Model** dropdown: pre-populated with curated models per provider; free-text for Ollama/OpenRouter
- Currently selected model displayed in the dropdown
- **API Key** field (masked, preserved if left blank)
- **"Save AI Details"** → saves only AI-related settings (provider, model, API key) without affecting voice/UI settings

| Provider | Curated Models |
|----------|---------------|
| Google | gemini-2.5-flash, gemini-2.5-pro, gemini-2.0-flash, gemini-1.5-pro |
| OpenAI | gpt-4o, gpt-4o-mini, gpt-4-turbo, gpt-3.5-turbo |
| Anthropic | claude-opus-4-5, claude-sonnet-4-5, claude-haiku-3-5 |
| Groq | llama-3.3-70b, llama-3.1-8b, Qwen3 32B, Llama 4 Scout |
| OpenRouter | gpt-4o, claude-opus-4, gemini-2.5-pro, deepseek-chat, mistral-large |
| Ollama | Free-form text |

### Voice & Wake Word Tab

- **Voice Accent** — TTS accent selection
- **Voice Speed** — multiplier slider
- **Continuous Listening** toggle
- **Wake Word Enabled** toggle
- **Wake Word Threshold** — sensitivity slider
- **Custom Wake Phrases** — comma-separated list

### UI & Sounds Tab

- **Theme** selection (8 themes)
- **Sound Effects** toggle + volume slider

### Memory Tab

- **Long-Term Memory** toggle — enables/disables semantic vector memory
  - When disabled: `SentenceTransformer` model never loads → faster startup & lower RAM
  - Toggle state sent to backend via `update_settings`

### Save Behavior

- **"Save AI Details"** → saves only AI-related settings, triggers `settings_sync`
- **"Save All Settings"** → saves everything (AI + voice + UI + memory), triggers `settings_sync`
- Opening settings again always reflects the currently active model and settings

---

## 💬 Response Rendering (`ResponseBubble.tsx`)

Responses are fully rendered with `react-markdown` + `remark-gfm`:

| Element | Rendering |
|---------|-----------|
| **Markdown headers** | Styled `h1`–`h4` with accent color |
| **Bold / italic** | Standard markdown rendering |
| **Code blocks** | Syntax-highlighted with copy button |
| **Inline code** | Styled monospace chip |
| **Tables** | Full HTML table with theme-aware borders |
| **Horizontal rules** | Styled separator line |
| **Bullet/ordered lists** | Properly indented lists |
| **URLs** | Clickable links — opens in system default browser via `shell:allow-open` |
| **Streaming** | Word-by-word streaming with animated typing cursor |

**Response modal features:**
- Expandable full-screen response modal with eye animation
- Multi-state eye animations: idle → typing → reading → done
- Typing loader bubble shown while response streams in
- "Read Aloud" button (TTS trigger)
- Copy button

---

## 🔊 Audio Cues (`useAudioCues.ts`)

All sounds are synthesized via the **Web Audio API** — no audio files needed. Cues respect `soundEnabled` and `soundVolume` settings.

| Cue Name | Trigger | Sound Design |
|----------|---------|-------------|
| `wake` | Wake word detected | Ascending double-glide (480→960 Hz) |
| `listen_start` | Mic opens | Soft double-ping (680/880 Hz) |
| `listen_stop` | Mic closes | Gentle down-glide (620→380 Hz) |
| `processing` | Query sent | Short triangle click (440 Hz) |
| `response_ready` | Response received | Warm chime (820→1080 Hz) |
| `speech_start` | TTS starts | Warm single tone (560 Hz) |
| `speech_end` | TTS finishes | Falling sign-off (540→360 Hz) |
| `error` | Error state | Two-tone sawtooth alarm |
| `task_done` | Task completed | Three-note ascending chime (C5→E5→G5) |

---

## 🗄️ Zustand Store (`assistantStore.ts`)

Single Zustand store. `onboardingCompleted` persisted to `localStorage`.

### Key State

```typescript
// Session
voiceState: 'idle' | 'listening' | 'processing' | 'speaking' | 'error'
isConnected: boolean
currentTranscript: string | null

// Multi-tab Threads
activeThreadId: string
tabs: ThreadTab[]  // each tab: id, title, messages, plan, tokens

// Execution
currentPlan: Plan | null
executingStepIndex: number | null
taskPaused: boolean
isOverlayMode: boolean
snapAlign: 'left' | 'right' | 'none'
userOverrodeMinimize: boolean

// LLM Config
activeProvider: string
activeLocalModel: string
activeCloudModel: string
geminiApiKey / openaiApiKey / anthropicApiKey / groqApiKey / openrouterApiKey: string
activeTheme: string

// Voice
voiceAccent: string
voiceSpeed: number
continuousListening: boolean
wakeWords: string[]
wakeWordEnabled: boolean
wakeWordThreshold: number

// Memory
longTermMemoryEnabled: boolean

// Token Tracking
tokenUsage: {
  requestTokens / responseTokens / totalTokens / sessionTotalTokens
}
globalSessionTokens: Record<string, number>  // per model key

// Personalization
userName: string
userSkills: string[]
customPrompt: string
onboardingCompleted: boolean

// Streaming & Shell
streamingResponse: string | null
shellOutputLines: string[]
lastClassification: string | null

// Sound
soundEnabled: boolean
soundVolume: number  // 0–100
```

### Key Actions

| Action | Effect |
|--------|--------|
| `addMessage(msg, thread_id?)` | Appends to active thread |
| `setPlan(plan, thread_id?)` | Sets current agentic plan |
| `updateStepStatus(index, update)` | Updates plan step status |
| `updateTokenUsage(usage, thread_id?)` | Accumulates token counts |
| `addTab(id?)` | Creates new thread tab |
| `removeTab(id)` | Removes thread tab |
| `loadThreadToTab(id, messages, tokens)` | Restores history to a tab |
| `setOverlayMode(val)` | Triggers window resize via `useWindowOverlay` |
| `setLongTermMemoryEnabled(bool)` | Updates memory toggle state |
| `setSoundSettings(enabled, volume)` | Updates audio cue settings |
| `appendStreamChunk(chunk)` | Appends to streaming response |
| `resetSessionTokens()` | Clears session counters on new thread |

---

## 🔌 WebSocket Hook (`useWebSocket.ts`)

Auto-connects to the Python runtime on the dynamically negotiated port. Routes all incoming messages to store actions.

| Message Type | Action |
|-------------|--------|
| `assistant_response` | Appends message, updates token usage |
| `stream_chunk` | Appends to streaming response buffer |
| `plan_created` | Sets plan in active tab |
| `tool_started` | Updates step status → running |
| `tool_completed` | Updates step status → success |
| `tool_error` | Updates step status → error |
| `tool_action` | Appends to ActionLog |
| `tool_terminated` | Marks step as terminated |
| `voice_state` | Sets `voiceState` |
| `session_state` | Sets `isConnected` |
| `settings_sync` | Syncs all provider/model/key/personalization/theme/memory fields |
| `history_response` | Populates threads list |
| `thread_loaded` | Restores messages + token counts to tab |
| `task_paused` / `task_resumed` | Sets `taskPaused` flag |
| `window_control` | `minimize_hint` → collapses to overlay, `restore` → expands |
| `permission_request` | Shows `PermissionDialog` |
| `input_request` | Shows `InputDialog` |
| `shell_output` | Appends to `shellOutputLines` |
| `intent_classified` | Sets `lastClassification` |

**Permanent permission grants:** Once a user grants permanent permission for a tool, it's cached in `permanentGrants` set inside the hook to avoid re-prompting.

---

## 🎨 Theme System

8 themes defined in `styles/themes.css` (applied to `document.body.className`):

| Theme ID | Palette |
|---------|---------|
| `theme-green-black` | Matrix Green accent, dark glass (default) |
| `theme-red-black` | Red accent, dark glass |
| `theme-purple-black` | Purple accent, dark glass |
| `theme-mono-dark` | Gray/white accent, flat black |
| `theme-blue-black` | Blue/cyan accent, dark glass |
| `theme-light-sakura` | Pink accent, light mode |
| `theme-light-slate` | Slate accent, light mode |
| `theme-light-clean` | Clean white, light mode |
| `theme-multicolor-dark` | Animated rainbow gradient, dark |
| `theme-multicolor-light` | Animated rainbow gradient, light |

Themes set can also be changed by voice: *"Change my theme to cyberpunk"* → triggers `update_settings` tool call.

---

## 📂 Directory Structure

```
apps/desktop/
├── src/
│   ├── main.tsx                        # Vite entry point
│   ├── App.tsx                         # Root: modal state, tab management, onboarding gate
│   ├── components/
│   │   ├── assistant/
│   │   │   ├── AssistantOverlay.tsx    # Main HUD (3-panel + controls + STOP button)
│   │   │   ├── OverlayIdleView.tsx     # Compact overlay strip (280×560)
│   │   │   ├── ResponseBubble.tsx      # Message rendering: markdown, code, URLs, streaming
│   │   │   ├── TaskList.tsx            # Multi-tab thread panel + JSON import modal
│   │   │   ├── JsonImportModal.tsx     # JSON task import UI
│   │   │   ├── ContextModal.tsx        # Context/response modal overlay
│   │   │   ├── VoiceButton.tsx         # Mic toggle + waveform animation
│   │   │   ├── Waveform.tsx            # Audio visualizer
│   │   │   ├── ParticleBackground.tsx  # Animated canvas (state-aware particles)
│   │   │   └── TranscriptView.tsx      # Live STT overlay
│   │   ├── onboarding/
│   │   │   └── OnboardingView.tsx      # Cold-start wizard + edit modal
│   │   ├── execution/
│   │   │   └── ActionLog.tsx           # Live tool log + cumulative plan steps (right panel)
│   │   ├── permissions/
│   │   │   ├── PermissionDialog.tsx    # Tool approval popup
│   │   │   └── InputDialog.tsx         # Agent input request popup
│   │   └── settings/
│   │       ├── SettingsView.tsx        # Tabbed settings: AI · Voice · UI · Memory
│   │       └── HistoryView.tsx         # Thread list + token restore
│   ├── hooks/
│   │   ├── useWebSocket.ts             # WS connection + all message routing
│   │   ├── useWindowOverlay.ts         # Smart overlay mode + edge snapping
│   │   ├── useAudioCues.ts             # Web Audio API synthesized sound cues
│   │   ├── useSpeechRecognition.ts     # Browser Web Speech API (optional fallback)
│   │   ├── usePermission.ts            # Permission gate hook
│   │   └── useTauriEvent.ts            # Tauri IPC event listener
│   ├── stores/
│   │   └── assistantStore.ts           # Zustand: all app state + actions
│   ├── lib/
│   │   ├── ws.ts                       # WS client singleton (wsClient)
│   │   ├── schemas.ts                  # Zod: Message, Plan, PlanStep, WSMessage types
│   │   └── constants.ts                # TAURI_EVENTS, etc.
│   └── styles/
│       ├── globals.css                 # Base styles, resets, overlay-mode rules
│       └── themes.css                  # 10 theme token sets
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
│   ├── capabilities/
│   │   └── main.json                   # Tauri v2 permission scoping
│   └── tauri.conf.json
│
├── package.json
├── vite.config.ts
└── tsconfig.json
```

---

## 🔧 Rust Core (`src-tauri/src/`)

| `lib.rs` | App bootstrap, window setup, sidecar spawn, system tray init, and window close-to-tray interception (`CloseRequested` event) |
| `sidecar.rs` | Spawn bootstrap script, read `PORT:xxxx` from stdout, relay stderr |
| `tray.rs` | System tray icon, menu (Show, Hide, Quit). Terminating the app completely is only performed via the 'Quit' menu item. |
| `ipc.rs` | `invoke()` commands exposed to frontend |

### Tauri Capabilities (`src-tauri/capabilities/main.json`)

```json
{
  "permissions": [
    "core:default",
    "shell:allow-spawn",
    "shell:allow-stdin-write",
    "shell:allow-open",
    "notification:default",
    "global-shortcut:allow-register",
    "clipboard-manager:allow-read",
    "clipboard-manager:allow-write",
    "dialog:allow-open",
    "dialog:allow-save"
  ]
}
```

`shell:allow-open` is required to open URLs in the system default browser from clickable links in responses.

---

## 🏗️ Building

### Development

```bash
# From the repo root
pnpm dev
```

Starts Vite HMR + Rust debug binary + Python sidecar.

### Production AppImage

```bash
PATH="$(pwd)/apps/desktop/src-tauri/mock_pkg_config:$PATH" \
NO_STRIP=true \
APPIMAGE_EXTRACT_AND_RUN=1 \
pnpm tauri build -b appimage
```

Output: `src-tauri/target/release/bundle/appimage/OpenSarthi_0.1.0_amd64.AppImage`

> **Why `mock_pkg_config`?** Linuxdeploy GTK plugin runs `pkg-config --variable=gdk_pixbuf_binarydir` which returns an incorrect path on Arch Linux. The mock wrapper creates expected directories and falls through to real `pkgconf` for all other queries.

> **Why `APPIMAGE_EXTRACT_AND_RUN`?** `linuxdeploy` itself is an AppImage needing FUSE. This flag extracts and runs it directly, bypassing the FUSE requirement.

---

## 🔢 Versioning

Version must be kept in sync across three files:

| File | Field |
|------|-------|
| `apps/desktop/package.json` | `"version": "0.1.0"` |
| `apps/desktop/src-tauri/tauri.conf.json` | `"version": "0.1.0"` |
| `apps/desktop/src-tauri/Cargo.toml` | `version = "0.1.0"` |

---

## 🚧 UI Backlog / Unimplemented Features

Backend runtime capabilities with no frontend UI yet:

1. **Intent Classification Indicator** — The backend classifies (`CHAT`, `TASK`, `CLARIFY`) but the UI doesn't display this (no "Thinking (Task)" badge).
2. **Live Shell Console View** — `ShellTool` streams stdout line-by-line, captured in `shellOutputLines`, but no terminal/console UI exists.
3. **Pause/Resume Controls** — Backend supports `pause_execution`/`resume_execution`, but no UI buttons expose this.
4. **Manual TTS Playback** — No "Read Aloud" button on past messages.

---

## 📚 See Also

- [`../../README.md`](../../README.md) — Monorepo overview, setup, architecture
- [`../../runtime/README.md`](../../runtime/README.md) — Python sidecar internals
- [`../../docs/01_frontend_and_desktop_shell.md`](../../docs/01_frontend_and_desktop_shell.md) — Deep-dive: components, store, WS handlers
- [`../../docs/03_agentic_flow.md`](../../docs/03_agentic_flow.md) — Agentic execution flowcharts
- [`../../docs/04_websocket_protocol.md`](../../docs/04_websocket_protocol.md) — Full WS message type reference
