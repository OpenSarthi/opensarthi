# OpenSarthi Android — Implementation Guide

> How the Android app works, how to build it, and how the Python runtime runs inside an APK.

---

## Table of Contents
1. [Architecture Overview](#architecture-overview)
2. [What is Capacitor?](#what-is-capacitor)
3. [What is Chaquopy?](#what-is-chaquopy)
4. [Project Structure](#project-structure)
5. [Build Guide](#build-guide)
6. [Runtime Packaging Flow](#runtime-packaging-flow)
7. [Voice Pipeline (STT / TTS)](#voice-pipeline-stt--tts)
8. [WebSocket Protocol](#websocket-protocol)
9. [Permissions](#permissions)
10. [Picture-in-Picture (Roadmap)](#picture-in-picture-roadmap)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│  Android App (APK)                                       │
│                                                          │
│  ┌──────────────────────┐   WebSocket ws://127.0.0.1    │
│  │  React UI (WebView)  │ ◄────────────────────────────┐│
│  │  Capacitor Bridge    │                              ││
│  └──────────────────────┘                              ││
│                                                         ││
│  ┌──────────────────────────────────────────────────┐  ││
│  │  RuntimeService (Foreground Service)             │  ││
│  │  ┌──────────────────────────────────────────┐   │  ││
│  │  │  Chaquopy — Python 3.12 in JVM           │   │  ││
│  │  │  └── main_android.py                     │   │  ││
│  │  │       └── FastAPI + WebSocket (8765)─────┼───┼──┘│
│  │  │  └── agent/, voice/, tools/              │   │   │
│  │  └──────────────────────────────────────────┘   │   │
│  └──────────────────────────────────────────────────┘   │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │  AndroidVoiceBridge.kt (Native Android)          │   │
│  │  ├── SpeechRecognizer  (STT, system, offline)    │   │
│  │  └── TextToSpeech      (TTS, system)             │   │
│  │  Calls Python via Chaquopy: _on_transcript()     │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

---

## What is Capacitor?

[Capacitor](https://capacitorjs.com/) is an open-source native runtime that wraps any web app (React, Vue, etc.) into a native Android/iOS app using a **WebView**. It replaces Cordova/PhoneGap.

**In OpenSarthi:**
- The React UI (`apps/android/src/`) is the web app
- `npx cap sync android` copies the built `dist/` into Android assets
- The WebView loads `index.html` which connects to the local Python WebSocket server

Key files:
| File | Purpose |
|------|---------|
| `capacitor.config.json` | WebView URL, app ID, splash config |
| `android/` | Full native Android Gradle project |
| `android/app/src/main/assets/public/` | Built React assets served to WebView |

---

## What is Chaquopy?

[Chaquopy](https://chaquo.com/chaquopy/) is a Python SDK for Android that embeds a real CPython interpreter inside an APK via Gradle plugin. It allows calling Python from Java/Kotlin and vice versa.

**In OpenSarthi:**
- `RuntimeService.kt` calls Python: `Python.getInstance().getModule("main_android").callAttr("main")`
- Python runs our FastAPI server on port 8765
- `AndroidVoiceBridge.kt` calls Python callbacks: `py.getModule("voice.android_bridge").callAttr("_on_transcript", text)`

### Adding Python packages via Chaquopy

In `android/app/build.gradle`:
```groovy
chaquopy {
    defaultConfig {
        pip {
            install "fastapi"
            install "uvicorn"
            install "httpx"
            // etc.
        }
    }
}
```

Packages that have native `.so` extensions must have ARM64 wheels available on PyPI or be pre-built.

---

## Project Structure

```
apps/android/
├── src/                          # React UI source
│   ├── App.tsx                   # Root — onboarding, settings, history
│   ├── components/mobile/
│   │   ├── MobileAssistant.tsx   # Main chat UI
│   │   ├── SettingsView.tsx      # Settings slide-up sheet
│   │   ├── OnboardingView.tsx    # First-run onboarding
│   │   ├── HistoryView.tsx       # Past threads drawer
│   │   ├── MarkdownRenderer.tsx  # Inline markdown parser
│   │   └── SplashScreen.tsx      # Animated startup screen
│   ├── stores/assistantStore.ts  # Zustand global state
│   └── lib/ws.ts                 # WebSocket client
├── android/                      # Native Android Gradle project
│   └── app/src/main/java/dev/opensarthi/android/
│       ├── MainActivity.kt       # Capacitor entry point
│       ├── RuntimeService.kt     # Foreground service running Python
│       ├── OpenSarthiApp.kt      # Application class (Chaquopy init)
│       └── AndroidVoiceBridge.kt # Native STT + TTS singleton
├── capacitor.config.json
├── package.json
└── vite.config.ts
```

---

## Build Guide

### Prerequisites

| Tool | Version |
|------|---------|
| Node.js | ≥ 18 |
| pnpm | ≥ 9 |
| Android SDK | API 34+ |
| JDK | 17 |
| Android device/emulator | API 29+ |

### Step 1 — Install frontend deps

```bash
# From repo root
pnpm install
```

### Step 2 — Build the React UI

```bash
cd apps/android
npm run build
```

This runs `tsc --noEmit && vite build` and produces `dist/`.

### Step 3 — Sync to native Android project

```bash
npx cap sync android
```

This copies `dist/` into `android/app/src/main/assets/public/` and updates Capacitor plugins.

### Step 4 — Build & install APK

```bash
cd android
./gradlew installDebug --no-daemon
```

Or open `android/` in Android Studio and click ▶ Run.

### Quick one-liner (all steps)

```bash
cd apps/android && npm run build && npx cap sync android && cd android && ./gradlew installDebug --no-daemon
```

---

## Runtime Packaging Flow

The Python runtime lives in `runtime/`. Chaquopy packages it as Python source inside the APK:

```
runtime/
├── main_android.py      # Entry point (FastAPI + WebSocket)
├── agent/               # Agent orchestration
├── voice/
│   ├── android_bridge.py  # Android STT/TTS bridge
│   └── pipeline.py        # Platform-aware voice pipeline
└── tools/               # Available tools (Android-safe subset)
```

At build time, Gradle picks up `runtime/` via the `sourceSets` config and bundles it as Python source. At runtime, Chaquopy compiles it to `.pyc` on first launch.

**Environment detection:**
```python
import os
IS_ANDROID = os.environ.get("OPENSARTHI_PLATFORM") == "android"
```

This flag disables desktop-only dependencies (`PyAudio`, `faster_whisper`, accessibility tools).

---

## Voice Pipeline (STT / TTS)

### How STT works on Android

1. User taps mic button → React sends `manual_voice_trigger` over WebSocket
2. Python voice manager calls `AndroidVoicePipeline.start_listening()`
3. Python calls Kotlin via Chaquopy: `AndroidVoiceBridge.getInstance().startListening()`
4. Kotlin fires `SpeechRecognizer.startListening()` with `ACTION_RECOGNIZE_SPEECH`
5. On result: Kotlin calls Python `_on_transcript(text)` via Chaquopy
6. **Critical:** `SpeechRecognizer` stops after each result — `AndroidVoiceBridge` auto-restarts it (`rearmRecognizer()`) for continuous / wake-word listening
7. Python puts transcript in `asyncio.Queue` → voice manager processes it

### How TTS works on Android

1. Python agent calls `pipeline.speak(text)`
2. Kotlin `TextToSpeech.speak()` is called on main thread
3. STT is paused during speech (no feedback loop)
4. `UtteranceProgressListener.onDone()` fires → Python `asyncio.Event` is set → blocking `speak()` returns
5. STT resumes after 300ms

### Wake Word Flow

Wake words are stored in `assistantStore` and checked in the React `useWakeWord` hook against live partial transcripts from the `transcript_update` WebSocket event.

---

## WebSocket Protocol

The React WebView and Python backend communicate via WebSocket at `ws://127.0.0.1:8765/ws`. All messages use the schema:

```json
{ "id": "uuid", "type": "message_type", "payload": {}, "timestamp": 1234567890 }
```

See [`docs/04_websocket_protocol.md`](../../docs/04_websocket_protocol.md) for the full message reference.

Android-specific messages:

| Type | Direction | Purpose |
|------|-----------|---------|
| `manual_voice_trigger` | Client→Server | User tapped mic — start STT |
| `speak_text` | Client→Server | Speak response text via TTS |
| `stop_speech` | Client→Server | Stop TTS immediately |
| `voice_state` | Server→Client | `listening` / `speaking` / `idle` |
| `transcript_update` | Server→Client | Partial/final STT text |

---

## Permissions

Declared in `AndroidManifest.xml`:

| Permission | Purpose |
|-----------|---------|
| `INTERNET` | LLM API calls + localhost WebSocket |
| `RECORD_AUDIO` | Android SpeechRecognizer |
| `FOREGROUND_SERVICE` | Keep Python runtime alive |
| `WAKE_LOCK` | Prevent CPU sleep during agent tasks |
| `VIBRATE` | Haptic feedback on voice activation |
| `BIND_ACCESSIBILITY_SERVICE` | Automation tools (optional, user must enable) |

---

## Picture-in-Picture (Roadmap)

> This is a future enhancement — not yet implemented.

**Goal:** When the agent starts a task, shrink OpenSarthi to a floating PiP window (like floating video players) so the user can see what the agent is doing in other apps.

**How it would work:**
1. Agent sends `task_started` event
2. Android app calls `Activity.enterPictureInPictureMode(PictureInPictureParams)` (API 26+)
3. A minimal floating UI shows task status + stop button
4. On task completion, agent sends `task_completed` → app exits PiP back to full screen

**Android API:** `PictureInPictureParams.Builder`, `onPictureInPictureModeChanged()` in `MainActivity`

**Comparison to desktop:** On Linux desktop, OpenSarthi uses X11/Wayland window managers to keep a floating HUD over other windows — same concept, different platform API.
