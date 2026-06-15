# OpenSarthi — Android App

> OpenSarthi on Android: voice-driven AI agent in your pocket.

The Android app is a **Capacitor** wrapper around the same React UI used on desktop, with the Python runtime embedded directly in the APK via **Chaquopy**. No server needed — everything runs on-device.

---

## Features

- 🗣️ **Native STT** — continuous listening via Android `SpeechRecognizer` with auto-restart
- 🔊 **Native TTS** — `TextToSpeech` with pause-during-listening to avoid feedback
- 💬 **Markdown rendering** — code blocks, headers, bold, lists rendered properly
- 📋 **Copy & Listen** — tap Copy or Listen on any assistant response
- 📖 **Thread history** — swipe-open drawer with all past conversations
- ✏️ **Onboarding** — first-run wizard for skills, persona, and API key setup
- 👤 **Customizer** — edit skills and persona at any time
- ⚙️ **Settings** — provider, model, API key, voice, theme
- 🔑 **Wake word** — configurable wake word triggers voice input hands-free
- 🌟 **Splash screen** — animated startup with app icon

---

## Build Instructions

### Prerequisites

- Node.js ≥ 18 + pnpm
- Android SDK (API 34+), JDK 17
- Connected Android device (API 29+) or emulator

### Full build

```bash
# 1. Install deps (from repo root)
pnpm install

# 2. Build React UI
cd apps/android
npm run build

# 3. Sync to Android native project
npx cap sync android

# 4. Install on device
cd android
./gradlew installDebug --no-daemon
```

See [`docs/05_android_implementation.md`](../../docs/05_android_implementation.md) for deep-dive on Capacitor, Chaquopy, voice pipeline, and the PiP roadmap.

---

## Architecture

```
React UI (WebView) ──WebSocket──► Python FastAPI (port 8765, via Chaquopy)
                                       │
                               AndroidVoiceBridge.kt
                               ├── SpeechRecognizer (STT)
                               └── TextToSpeech (TTS)
```

---

## Key Files

| File | Purpose |
|------|---------|
| `src/App.tsx` | Root: onboarding, settings, history wiring |
| `src/components/mobile/MobileAssistant.tsx` | Main chat UI |
| `src/components/mobile/MarkdownRenderer.tsx` | Response markdown parser |
| `src/components/mobile/SplashScreen.tsx` | Animated startup |
| `src/components/mobile/OnboardingView.tsx` | First-run wizard |
| `src/components/mobile/HistoryView.tsx` | Past threads drawer |
| `src/components/mobile/SettingsView.tsx` | Settings sheet |
| `android/app/src/main/java/.../AndroidVoiceBridge.kt` | Native STT + TTS bridge |
| `android/app/src/main/java/.../RuntimeService.kt` | Foreground service for Python |
| `android/app/src/main/java/.../MainActivity.kt` | Capacitor entry point |
