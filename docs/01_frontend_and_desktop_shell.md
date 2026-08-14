# OpenSarthi — Frontend & Desktop Shell

> **Updated:** August 2026 — Multi-tab threads, smart overlay mode + edge snapping, OverlayIdleView, audio cues engine, full markdown rendering, separate AI/all settings save, Long-Term Memory toggle, 8 themes, Settings Cog dropdown menu integrations, Custom Color Picker, dynamic connection uptime tracker, real-time client connection telemetry.

---

## 1. Architecture Overview

```
┌──────────────────────────────────────────┐
│            Tauri v2 Shell                │
│   React 19 + TypeScript + Vite 6         │
│   (WebView Frontend)                     │
└──────────────┬───────────────────────────┘
               │ Tauri IPC (invoke/events)
┌──────────────▼───────────────────────────┐
│          Rust Native Core                │
│  sidecar.rs │ tray.rs │ ipc.rs           │
└──────────────┬───────────────────────────┘
               │ WebSocket ws://127.0.0.1:PORT/ws
┌──────────────▼───────────────────────────┐
│       Python Runtime (Sidecar)           │
│  FastAPI + LangGraph + PydanticAI        │
└──────────────────────────────────────────┘
```

---

## 2. Tech Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| **Desktop Framework** | Tauri v2 | ~5MB binary, granular permissions, cross-platform |
| **UI Framework** | React 19 + TypeScript | Concurrent features, type-safe IPC |
| **Bundler** | Vite 6 | Fast HMR, native ESM |
| **Animation** | Framer Motion | Layout transitions, declarative animations |
| **State** | Zustand | Minimal boilerplate, outside-React access for WS handlers |
| **Styling** | Vanilla CSS + custom design tokens | Full control, 10 themes |
| **Icons** | Lucide React | Tree-shakeable, consistent |
| **Markdown** | react-markdown + remark-gfm | Tables, code blocks, GFM support |
| **WebSocket** | Native browser WebSocket | Auto-reconnect, no library overhead |

---

## 3. Component Architecture

### 3.1 Full Component Tree

```
App.tsx  (Root: modal state, tab management, onboarding gate)
│
├── OnboardingView           (cold-start wizard / edit-mode popup)
│
├── AssistantOverlay         (main HUD — full window mode)
│   ├── ParticleBackground   (animated canvas, state-aware particle density)
│   ├── TaskList             (left panel: multi-tab threads + JSON import)
│   │   └── JsonImportModal  (JSON step import UI)
│   ├── MessageList + ResponseBubble  (centre panel)
│   │   └── ResponseBubble   (per-message: markdown, code, tables, URLs, streaming, eye animations)
│   │       └── ContextModal (expandable full-screen response modal)
│   ├── ActionLog            (right panel: tool log + cumulative plan + token stats)
│   ├── VoiceButton          (mic toggle + Waveform animation)
│   ├── TranscriptView       (live STT overlay)
│   ├── RuntimeConsole.tsx   (Sidecar log terminal)
│   └── OverlayIdleView      (compact 280×560 strip in overlay mode)
│
├── PermissionDialog         (tool approval popup with permanent grant option)
├── InputDialog              (agent user-input request popup)
├── SettingsView             (4-tab settings: AI · Voice · UI · Memory)
└── HistoryView              (past threads + token restore)
```

### 3.2 HUD Layout

Three-panel grid with draggable resize handles. To provide a consistent user experience, panel widths do not scale or change automatically when resizing, maximizing, or minimizing the main window, ensuring user-defined widths are strictly preserved.

```
┌────────────────┬───────────────────────────┬────────────────┐
│  AGENT TASKS   │    CHAT / MAIN VIEW       │  LIVE PLAN &   │
│                │                           │    ACTIVITY    │
│  Multi-tab     │  Messages + streaming     │  Tool log +    │
│  thread list   │  responses + voice input  │  cumulative    │
│  + JSON import │  + transcript overlay     │  plan steps +  │
│                │                           │  token stats   │
├────────────────┴───────────────────────────┴────────────────┤
│  Provider · Model · Token Usage · Session Total · Version   │
└─────────────────────────────────────────────────────────────┘
```

| Panel | Default Width | Content |
|-------|-------------|---------|
| Left | 260px | `TaskList` — multi-tab thread management + JSON import |
| Centre | flex-1 | Chat messages + voice input + streaming response + transcript |
| Right | 240px | `ActionLog` — tool calls + plan steps + token stats |

---

## 4. Smart Overlay Mode (`useWindowOverlay.ts`)

When the agent starts a screen-interaction task, the window automatically shrinks to a **280×560 compact strip** pinned to the screen edge. This stays above all other windows (always-on-top) so the user can monitor progress.

### Overlay Modes

| Mode | Size | Behavior |
|------|------|---------|
| **Snapped Right** | 280×560 | Default position (right edge, vertically centered) |
| **Snapped Left** | 280×560 | When dragged to left edge |
| **Floating** | 320×440 | When in centre of screen |

### Transition Sequence (full → overlay)

1. Save current window size and position
2. `unmaximize()` if maximized (150ms WM delay)
3. `setAlwaysOnTop(true)`
4. `setDecorations(false)`
5. `setSize(280, 560)` → position at right edge
6. Deferred 150ms `setAlwaysOnTop(true)` + `setFocus()` for Wayland
7. Start `onMoved` edge-snapping listener (300ms debounce)

### Transition Sequence (overlay → full)

1. `setAlwaysOnTop(false)`
2. `setDecorations(true)`
3. Restore saved size and position
4. Re-maximize if was previously maximized
5. `setFocus()`

### User Override

If user clicks "Expand" while a task is running → `userExpandedDuringTask = true` → subsequent `minimize_hint` events are ignored for that task's duration.

### `OverlayIdleView` Component

Compact overlay strip UI shown when in overlay mode and no task is actively executing:
- Voice state indicator with color (green/amber/blue/red)
- Last 8 chat messages (compressed, markdown stripped)
- Expandable latest assistant reply
- Text input bar + mic button
- Connection status dot

---

## 5. Multi-Tab Thread Management

Each conversation thread runs in its own **tab** within `assistantStore.tabs: ThreadTab[]`.

```typescript
interface ThreadTab {
  id: string;
  title: string;          // auto-computed from first user message keywords
  messages: Message[];
  currentPlan: Plan | null;
  executingStepIndex: number | null;
  taskPaused: boolean;
  tokenUsage: TokenUsage;
}
```

**Tab title auto-computation:** Matches keywords in the first user message to labels like "System Update", "Install Package", "Launch App", "UI Automation", etc. Falls back to the first 3 words in caps.

**Actions:** `addTab()` | `removeTab(id)` | `setActiveThreadId(id)` | `loadThreadToTab(id, messages, tokens)`

---

## 6. Response Rendering (`ResponseBubble.tsx`)

Full markdown rendering via `react-markdown` + `remark-gfm`:

| Element | Rendering |
|---------|---------|
| Headers (`#`–`####`) | Styled with accent color gradient |
| Bold / italic | Standard |
| Code blocks (` ``` `) | Syntax-highlighted with copy button |
| Inline code | Styled monospace chip |
| Tables | Full HTML table with theme-aware borders |
| Horizontal rules | Styled separator |
| Bullet / ordered lists | Properly indented |
| URLs | Clickable links → `shell.open()` → system default browser |
| Streaming text | Word-by-word animation with blinking cursor |

### Eye Animations

The response bubble displays animated "AI eyes" that change state:

| Eye State | When |
|-----------|------|
| Idle / slow blink | Waiting for input |
| Rapid blink | Typing / streaming response |
| Wide open | Reading / processing |
| Glowing | Speaking (TTS active) |

### Response Modal (`ContextModal`)

Clicking a response opens a full-screen modal with:
- Full markdown render (no truncation)
- Copy button
- Read Aloud button (triggers TTS)
- Close button

### Typing Loader Bubble

While a response is streaming (between user message and first character), a pulsing "thinking" bubble is shown to prevent perceived latency.

---

## 7. Settings (`SettingsView.tsx`)

Settings organized in four tabs. Opening settings always reflects the currently active model/provider without resetting.

### Tab 1 — AI Settings

- **Provider** dropdown: Ollama · Google · OpenAI · Anthropic · Groq · OpenRouter
- **Model** selection: Pre-populated curated models with capability tags (⚡ fast, 🧠 reasoning, 💻 coding, 🛠 tools, 👁 vision, 💰 budget, 🦙 local). If a provider supports dynamic model fetching (Ollama, OpenAI, OpenRouter), a ↻ **Refresh** button is shown to dynamically fetch live models through the `/models` backend proxy.
- **API Key** field: masked; left blank = key unchanged on backend
- **"Save AI Details"** button: saves only provider/model/key, emits `settings_sync`

**Curated Model Lists & Dynamic Fetching:**

| Provider | Curated Models (Static Fallback) | Dynamic Discovery |
|----------|---------------------------------|-------------------|
| Google | gemini-2.5-flash, gemini-2.5-pro, gemini-2.5-flash-lite, gemini-2.0-flash, gemini-1.5-pro | No |
| OpenAI | gpt-5.6-sol, gpt-5.6-terra, gpt-5.6-luna, gpt-5.5, gpt-5.4-mini, gpt-5.4-nano, gpt-oss-120b/20b | Yes (Chat models) |
| Anthropic | claude-opus-4-1, claude-sonnet-4, claude-haiku-4, sonnet-latest, opus-latest | No |
| Groq | llama-3.3-70b-versatile, llama-3.1-8b-instant, llama-4-scout, qwen-27b, deepseek-r1-distill, gpt-oss-120b/20b, compound, compound-mini | No |
| OpenRouter | claude-sonnet-4, claude-opus-4.1, gpt-5.6-terra/luna, gemini-2.5-pro/flash, deepseek-v3, deepseek-r1, qwen3-coder, grok-4, kimi-k2, glm-5.2 | Yes (Full list) |
| Ollama | 12 Curated Suggestions (Gemma 3, Phi-4, Llama 3.2, Qwen 2.5, DeepSeek R1, Mistral, Qwen3, Llama 3.3) | Yes (Local tags) |

*Note: For Ollama, users can select from fetched local models, size suggestions, or type a custom model identifier using the free-form text input.*


### Tab 2 — Voice & Wake Word

| Setting | Control |
|---------|---------|
| Voice Accent | Dropdown |
| Voice Speed | Slider (0.5–2.0) |
| Continuous Listening | Animated Toggle |
| Wake Word Enabled | Animated Toggle |
| Wake Word Threshold | Slider (0.3–0.9) |
| Custom Wake Phrases | Comma-separated text input |

All toggles use custom animated Toggle switch components.

### Tab 3 — UI & Sounds

| Setting | Control |
|---------|---------|
| Sound Effects | Animated Toggle |
| Sound Volume | Slider (0–100) |

*(Note: Theme Selection, Custom Color Picker, Mobile Remote Control, and Desktop Shortcut options are located directly in the header Settings Cog Dropdown Menu)*

### Tab 4 — Memory

| Setting | Control |
|---------|---------|
| Long-Term Memory | Animated Toggle |

When disabled → `SentenceTransformer` model never loaded on backend → faster startup & lower RAM.

### Save Behavior

- **"Save AI Details"** → only AI fields (provider, model, API key)
- **"Save All Settings"** → everything (AI + voice + UI + memory)
- Both buttons emit `settings_sync` back from backend to update all UI state

---

## 8. Audio Cues Engine (`useAudioCues.ts`)

All sounds are **synthesized via Web Audio API** — no audio files needed. Respects `soundEnabled` and `soundVolume` store settings.

Exported as both:
- `playCue(name)` — standalone function callable from any context (WS handlers, etc.)
- `useAudioCues()` — React hook returning `{ playCue }`

| Cue | Trigger | Design |
|-----|---------|--------|
| `wake` | Wake word detected | Ascending double-glide 480→960 Hz |
| `listen_start` | Mic opens | Soft double-ping 680/880 Hz |
| `listen_stop` | Mic closes | Gentle down-glide 620→380 Hz |
| `processing` | Query sent | Short triangle click 440 Hz |
| `response_ready` | Response arrives | Warm chime 820→1080 Hz |
| `speech_start` | TTS begins | Warm single tone 560 Hz |
| `speech_end` | TTS finishes | Falling sign-off 540→360 Hz |
| `error` | Error state | Sawtooth two-tone alarm |
| `task_done` | Task completes | Three-note chime C5→E5→G5 |

Uses a shared, lazily-created `AudioContext` singleton reused across all cues.

---

## 9. Zustand Store (`assistantStore.ts`)

### State Shape

```typescript
// Session
voiceState: 'idle' | 'listening' | 'processing' | 'speaking' | 'error'
isConnected: boolean
currentTranscript: string | null

// Multi-tab Threads
activeThreadId: string
tabs: ThreadTab[]

// Active Tab (legacy mapped aliases)
messages: Message[]
currentPlan: Plan | null
executingStepIndex: number | null
taskPaused: boolean

// Overlay
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
tokenUsage: TokenUsage           // active thread
globalSessionTokens: Record<string, number>  // per model key, persisted localStorage

// Personalization
userName: string
userSkills: string[]
customPrompt: string
onboardingCompleted: boolean      // persisted localStorage

// Streaming & Shell Output
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
| `addMessage(msg, thread_id?)` | Appends to thread messages |
| `setPlan(plan, thread_id?)` | Sets plan in active/specified tab |
| `updateStepStatus(index, update)` | Updates plan step status |
| `addOrUpdateToolAction(tool, desc, status, result)` | Updates ActionLog entry |
| `updateTokenUsage(usage, thread_id?)` | Accumulates thread token counts |
| `setOverlayMode(val)` | Triggers window resize via `useWindowOverlay` |
| `setLongTermMemoryEnabled(bool)` | Updates memory toggle |
| `setSoundSettings(enabled, volume)` | Updates audio cue settings |
| `appendStreamChunk(chunk)` | Appends to streaming response |
| `addTab(id?)` | Creates new thread tab |
| `removeTab(id)` | Removes thread tab |
| `loadThreadToTab(id, messages, tokens)` | Restores history to tab |
| `setPersonalization(name, skills, prompt)` | Updates personalization |
| `resetSessionTokens()` | Clears session counters |

---

## 10. WebSocket Hook (`useWebSocket.ts`)

Auto-connects to the Python runtime on the dynamically negotiated port. Handles reconnection automatically.

### Message Routing Table

| Message Type | Action |
|-------------|--------|
| `assistant_response` | `addMessage()` + `updateTokenUsage()` + `playCue("response_ready")` |
| `stream_chunk` | `appendStreamChunk(chunk)` |
| `plan_created` | `setPlan()` |
| `tool_started` | `updateStepStatus(index, {status: "running"})` + `setExecutingStep(index)` |
| `tool_completed` | `updateStepStatus(index, {status: "success", result})` |
| `tool_error` | `updateStepStatus(index, {status: "error", error})` |
| `tool_action` | `addOrUpdateToolAction()` |
| `tool_terminated` | `updateStepStatus(index, {status: "terminated"})` |
| `intent_classified` | `setLastClassification(classification)` |
| `voice_state` | `setVoiceState()` + appropriate `playCue()` |
| `session_state` | `setConnected()` |
| `settings_sync` | Updates all provider/model/key/theme/memory/personalization fields |
| `history_response` | `setThreads()` |
| `thread_loaded` | `loadThreadToTab()` |
| `task_paused` | `setTaskPaused(true)` |
| `task_resumed` | `setTaskPaused(false)` |
| `window_control` | `setOverlayMode()` based on action |
| `permission_request` | Shows `PermissionDialog` |
| `input_request` | Shows `InputDialog` |
| `shell_output` | `appendShellOutputLine()` |
| `transcript_update` | `setTranscript()` |

**Permanent permission grants:** Once a user grants permanent permission for a tool, it's stored in a `permanentGrants: Set<string>` in the hook closure. Future requests for the same tool auto-approve without showing a dialog.

---

## 11. Hooks Reference

| Hook | File | Purpose |
|------|------|---------|
| `useWebSocket` | `hooks/useWebSocket.ts` | WS connection + full message routing |
| `useWindowOverlay` | `hooks/useWindowOverlay.ts` | Smart overlay mode, edge snapping, size/position management |
| `useAudioCues` | `hooks/useAudioCues.ts` | Web Audio API synthesized sound cues |
| `useSpeechRecognition` | `hooks/useSpeechRecognition.ts` | Browser Web Speech API (optional fallback STT) |
| `usePermission` | `hooks/usePermission.ts` | Permission gate for tool approval dialogs |
| `useTauriEvent` | `hooks/useTauriEvent.ts` | Tauri IPC event listener wrapper |

---

## 12. Theme System

Theme selection has been relocated to the header **Settings Cog Dropdown Menu -> Themes sub-menu** to keep SettingsView modal layouts cleaner and more focused.

8 active themes remain in `styles/themes.css` (with `theme-mono-dark` and `theme-light-clean` removed as deprecated), applied via `document.body.className`:

| Theme ID | Palette | Mode |
|---------|---------|------|
| `theme-green-black` | Matrix Green (default) | Dark |
| `theme-red-black` | Red accent | Dark |
| `theme-purple-black` | Purple accent | Dark |
| `theme-blue-black` | Cyan/blue accent | Dark |
| `theme-light-sakura` | Pink accent | Light |
| `theme-light-slate` | Slate accent | Light |
| `theme-multicolor-dark` | Animated rainbow gradient | Dark |
| `theme-multicolor-light` | Animated rainbow gradient | Light |

### Custom Color Override

Located within the Themes sub-menu, clicking the **Custom Color Override** option opens a sidebar popover containing a premium conic-gradient annulus color wheel.
- **Interaction**: Dragging the handle calculates mouse coordinates relative to the wheel's center to determine the HSL angle (0–360° Hue).
- **Real-Time Previewing**: CSS variables are injected dynamically on `document.documentElement` during drag so the UI colors animate and update in real-time.
- **Controls**: Includes `SAVE` (commit selected accent color to `localStorage` store), `DISCARD` (revert colors to their pre-opened states), and `DEFAULT` (restore theme native color mappings).

Themes can also be changed by voice: *"Switch to cyberpunk theme"* → agent calls `update_settings` tool.

**Core CSS variables shared across all themes:**
```css
--accent             /* main accent color */
--accent-glow        /* rgba glow version */
--bg-primary         /* window background */
--bg-secondary       /* panel backgrounds */
--text-primary       /* main text */
--text-secondary     /* muted/label text */
--border             /* panel borders */
--font-mono          /* monospace for HUD labels */
--font-sans          /* sans-serif for UI text */
```

---

## 13. Tauri Configuration

### Capabilities (`src-tauri/capabilities/main.json`)

```json
{
  "identifier": "main-window",
  "windows": ["main"],
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

`shell:allow-open` is required for clickable URLs in response bubbles — opens URLs in the system default browser.

### Window Configuration

Default window: 1100×700, resizable, transparent, no decorations. `alwaysOnTop` is managed dynamically by `useWindowOverlay.ts`.

---

## 14. Directory Structure

```
apps/desktop/
├── src/
│   ├── main.tsx                        # Vite entry point
│   ├── App.tsx                         # Root: modal state, tab management, onboarding gate
│   ├── components/
│   │   ├── assistant/
│   │   │   ├── AssistantOverlay.tsx    # Main HUD (3-panel + controls + STOP button)
│   │   │   ├── OverlayIdleView.tsx     # Compact overlay strip (280×560)
│   │   │   ├── ResponseBubble.tsx      # Markdown render, URLs, streaming, eye animations
│   │   │   ├── TaskList.tsx            # Multi-tab thread panel + JSON import
│   │   │   ├── JsonImportModal.tsx     # JSON step import UI
│   │   │   ├── ContextModal.tsx        # Full-screen response modal
│   │   │   ├── VoiceButton.tsx         # Mic toggle + waveform animation
│   │   │   ├── Waveform.tsx            # Audio visualizer canvas
│   │   │   ├── ParticleBackground.tsx  # Animated canvas background
│   │   │   └── TranscriptView.tsx      # Live STT transcript overlay
│   │   ├── onboarding/
│   │   │   └── OnboardingView.tsx      # 3-step cold-start wizard + edit modal
│   │   ├── execution/
│   │   │   └── ActionLog.tsx           # Live tool log + cumulative plan (right panel)
│   │   ├── permissions/
│   │   │   ├── PermissionDialog.tsx    # Tool approval with permanent grant option
│   │   │   └── InputDialog.tsx         # Agent user-input popup
│   │   └── settings/
│   │       ├── SettingsView.tsx        # 4-tab settings (AI · Voice · UI · Memory)
│   │       └── HistoryView.tsx         # Thread list + token restore
│   ├── hooks/
│   │   ├── useWebSocket.ts             # WS connection + all message routing
│   │   ├── useWindowOverlay.ts         # Smart overlay mode + edge snapping
│   │   ├── useAudioCues.ts             # Web Audio API synthesized cues
│   │   ├── useSpeechRecognition.ts     # Browser Web Speech API fallback
│   │   ├── usePermission.ts            # Permission gate hook
│   │   └── useTauriEvent.ts            # Tauri IPC event listener
│   ├── stores/
│   │   └── assistantStore.ts           # Zustand: all app state + actions
│   ├── lib/
│   │   ├── ws.ts                       # WS client singleton
│   │   ├── schemas.ts                  # Zod: Message, Plan, PlanStep, WSMessage types
│   │   └── constants.ts                # TAURI_EVENTS, etc.
│   └── styles/
│       ├── globals.css                 # Base styles, overlay-mode rules, animations
│       └── themes.css                  # 10 theme token sets
│
├── src-tauri/
│   ├── src/
│   │   ├── lib.rs                      # App entry, window setup, sidecar launch
│   │   ├── sidecar.rs                  # Python spawn, PORT: reader, stderr relay
│   │   ├── tray.rs                     # System tray icon + menu
│   │   └── ipc.rs                      # Tauri invoke command handlers
│   ├── binaries/
│   │   └── opensarthi-runtime-x86_64-unknown-linux-gnu  # Bootstrap launcher
│   ├── resources/
│   │   └── uv                          # Bundled uv binary
│   ├── capabilities/
│   │   └── main.json                   # Tauri v2 permission scoping
│   └── tauri.conf.json
│
├── package.json
├── vite.config.ts
└── tsconfig.json
```

---

## 15. Live Sidecar Log Terminal & Modular Console Overlay

To expose real-time backend startup and execution sequences to developers (especially during Python virtualenv creation and pip installations), stdout/stderr outputs from the Python runtime are piped and displayed inside a full-width bottom logcat.

### Log Piping Flow
1. **Rust Sidecar (`sidecar.rs`)**: Emits native Tauri events `runtime:stdout` and `runtime:stderr` as chunks are read from the spawned child process.
2. **App Entry (`App.tsx`)**: Listens to Tauri events and accumulates incoming lines in a `useRef` queue buffer.
3. **Throttled Batching**: To prevent React rendering queues from freezing during high-throughput console output (such as `pip` installations), log lines are flushed in a single batch to the Zustand store every **120ms**.
4. **Zustand Store (`assistantStore.ts`)**: Clips the logs array to the last **150 lines** to maintain a lightweight DOM footprint.

### Component Design (`RuntimeConsole.tsx`)
- **Visual Presentation**: Slide-up cyberpunk dashboard positioned absolutely at the bottom edge. Styled with an opaque background (`#08080a`) and aligned to `left: -12px, right: -12px, bottom: -12px` to offset layout padding.
- **Draggable Height**: A thin neon handle at the top edge allows row-resize adjustments (bounds constrained between `120px` and `65%` of screen height).
- **Auto-Toggle Transition**: Automatically slides open during startup (`!isConnected`) to show bootstrap logs, and auto-collapses upon successful connection. It can be manually toggled via the `[LOGS]` button in the top bar.
- **Onboarding Guard**: Completely hidden when onboarding is active (`!onboardingCompleted`) to avoid overlaying onboarding cards.
- **Copy logs**: Header bar includes a `[ COPY LOGS ]` button providing instant clipboard access.

### WebKitGTK Stacking Fixes
To resolve native scrollbar overlay clipping bugs in WebKitGTK under Linux (where scrollbars bleed on top of overlays):
- **Popup/Modal Blur**: Adding `.blurred-layout` hides scrollbars on all underlying elements inside the app container.
- **Console Open Class**: Toggles `.console-open` on the document body when the bottom console is open. Associated CSS hides the scrollbars of background layout panels while keeping them fully scrollable via mouse wheel.

### Desktop Native Integration & Webview Reload Resilience
To mimic a production-grade native application and ensure the webview remains connected across page refreshes:
- **Default Browser Menu Prevention**: Disables the default webview right-click context menu (which exposes browser-like reload, back, and forward controls) globally.
- **State Preservation Across Reload**: On mount, the frontend queries `get_runtime_port` via Tauri IPC. If the Python sidecar is already active (e.g., after a webview reload), the frontend retrieves the port and connects immediately, rather than waiting for the startup `runtime:port-ready` event.
- **Onboarding Race Condition Mitigation**: Stores completed onboarding configurations inside a `pendingOnboarding` cache in the Zustand store. When the first `settings_sync` packet is received from the server, these cached settings are automatically merged and synchronized with the backend, preventing startup synchronization race conditions from wiping newly typed API keys and preferences.
- **Window Close to Tray**: Intercepts `tauri::WindowEvent::CloseRequested` in Rust (`lib.rs`). Calls `api.prevent_close()` and `window.hide()` to keep the application active in the system tray when clicking the close button. The application is only fully terminated when the user selects 'Quit' from the tray menu.

### Real-Time Task Panel Sync

The **Agent Tasks** (left panel) and **Live Plan & Activity** (right panel) display live step updates during task execution. Two robustness fixes ensure correct real-time behavior:

- **Robust running-task identification (`ActionLog.tsx`)**: The running user message is found using a backward scan (`lastUserMsgIdx`) — identical to the approach in `TaskList.tsx` — instead of the fragile `messages.length - 1` index which breaks when non-user messages (e.g. voice errors) exist after the latest user prompt.
- **Auto-select on mount (`TaskList.tsx`)**: The `useEffect` that auto-selects the in-progress task depends on `currentPlan` (the plan object reference) rather than the `hasActivePlan` boolean. This ensures it fires when the full-screen layout mounts mid-task (e.g. user expands from overlay mode), correctly selecting the active task and rendering live step status immediately.

In **overlay mode**, the compact strip shows the ActionLog directly with `currentPlan` as its plan prop, so step status changes are reflected in the progress bar and tool log in real time via reactive Zustand subscriptions.

---

## 16. UI Backlog

Backend features with no frontend UI yet:

| Feature | Backend Event | Status |
|---------|--------------|--------|
| Intent badge in UI | `intent_classified` | Store captured; no badge shown |
| Pause/Resume buttons | `pause_execution`/`resume_execution` | Backend works; no UI buttons |
| Read Aloud on past messages | `speak_text` manual flag | TTS works on new responses; no button on history |
