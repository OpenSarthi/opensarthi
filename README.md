# OpenSarthi

**An AI-native Desktop Operating Layer & Assistant**

OpenSarthi is an autonomous, voice-first AI desktop agent initially focused on Linux desktop automation. Rather than functioning as just another chatbot window, OpenSarthi acts as a generalized computer-use primitive, capable of executing system-level tasks, app control, screen interaction, and shell automation natively on your machine.

---

## 🏗️ Architecture Overview

OpenSarthi is built as a monorepo utilizing a modern, secure, two-part architecture:

1. **The Desktop Shell (Frontend):** 
   A blazing-fast desktop overlay built with **Tauri v2, React 19, and TypeScript**. It provides the native windowing, system tray, granular OS permissions, and a beautiful customizable glassmorphism UI.
2. **The AI Brain (Backend Sidecar):**
   A robust, local-first **Python (FastAPI + PydanticAI)** runtime that handles LLM orchestration, task planning, tool execution (via `xdotool`/`ydotool`), shell sandboxing (`bubblewrap`), and the real-time voice pipeline.

---

## 🚀 Key Improvements & Completed Features

We have successfully engineered and stabilized several premium desktop capabilities:

* **Leetcode-style Draggable Panel Layout**: Full drag-and-resize support for Left, Middle, and Right grid panels with high-tech vertical splitting bars.
* **Premium Themed Glowing Splitters**: Vertical splitters light up in dynamic, fluid glass glows matching your active theme color on hover and drag.
* **Voice Pipeline Silence Handshake & Echo Protection**: 
  - Automatically suspends voice listening capture while the assistant is actively speaking (`is_speaking = True`), terminating microphone loopback/echo feedback.
  - Removed transcription time limits (`phrase_time_limit = None`) to support infinite length, natural spoken prompts.
  - Implemented an **8-second Smart Silence Timeout** to automatically put the listener to sleep if no voice activity is detected.
* **5 Harmonious Premium Themes**:
  - `Glass Red-Black` (Default High-Tech)
  - `Forest Green-Black` (Cyberpunk Green)
  - `Deep Purple-Black` (Midnight Tech)
  - `Cyber Sky-White` (Modern Minimalist Light)
  - `Sakura Pink-White` (Warm Soft Light)
* **Silent Settings Updates**: Refactored settings save handlers to run quietly, removing duplicate notifications and text history logs from the chat overlay.
* **Production-Safe Settings & SQLite Databases**:
  - Migrated configuration files to standard home config pathways (`~/.config/opensarthi/.env`) to bypass read-only crashes inside compiled package environments like AppImage mounts.
  - Relocated the conversation database to a secure, writeable home directory location (`~/.config/opensarthi/opensarthi.db`), eliminating critical SQLite write-lock and directory permissions failures.
  - Integrated an automatic, zero-data-loss database migration mechanism that automatically copies any existing local development chat history on first run!
* **API Key Retention Security**: Saving settings with an empty key input will retain the previously saved API key securely, avoiding accidental wipeouts.

---

## 📦 Build Process

We have fully automated and configured the production bundle compilation to create standalone Linux executables.

### Building the Production AppImage

Because modern Linux packaging environments can fail to recognize/strip newer WebKit2GTK symbol formats, the build command leverages a custom, sandboxed mock pkg-config and disables symbol stripping during Tauri compilation:

```bash
PATH="/mnt/kartik/ai_desktop_agent_assistant/opensarthi/apps/desktop/src-tauri/mock_pkg_config:$PATH" \
NO_STRIP=true \
APPIMAGE_EXTRACT_AND_RUN=1 \
pnpm --filter desktop run build
```

This will automatically:
1. Run `tsc` typechecks on the React shell.
2. Build the optimized production static bundle via `vite build`.
3. Compile the native Rust core under the release profile.
4. Bundle everything (including the Python sidecar binary and assets) into a single, fully-executable AppImage:
   `apps/desktop/src-tauri/target/release/bundle/appimage/OpenSarthi_0.1.0_amd64.AppImage`

---

## 🛠️ Development Setup

### Prerequisites
* **Node.js & pnpm**: For compiling the Tauri frontend.
* **Rust / Cargo**: Required by Tauri for the native bindings.
* **Python 3.12**: Highly recommended. (Using newer/alpha versions like Python 3.14 may cause installation failures for machine learning libraries like `faster-whisper` and `kokoro` due to missing pre-compiled wheels).

### Setup

1. **Install Frontend Dependencies:**
   ```bash
   pnpm install
   ```

2. **Install Backend Dependencies:**
   ```bash
   cd runtime
   python3.12 -m venv .venv
   source .venv/bin/activate
   pip install -r requirements.txt
   ```

### Running for Development

To run the application in development mode:

```bash
# In the root directory
pnpm dev
```

---

## 🔮 What's Left (Roadmap)

- [ ] **Multi-turn Interrupt (Barge-in)**: Add support for immediate voice interrupt during active text-to-speech replays.
- [ ] **Local Model Preloading**: Start background pre-fetching for local LLM weights to reduce first-token latency on start.
- [ ] **Deep Wayland Client Window Tracking**: EnhanceWayland client window tracking for safer shell interactions inside modern Wayland environments.
- [ ] **Sandboxed bubblewrap Expansion**: Add configurable template profiles for custom isolated user-shell execution.

---

## 🔒 Security First

OpenSarthi runs commands on your machine. To keep your system safe:
* **Tauri v2 Capabilities**: The frontend is strictly locked down using Tauri's granular permission system.
* **Bubblewrap Sandboxing**: By default, shell commands executed by the AI are wrapped in `bwrap` with isolated filesystem and network access.
* **User Consent**: Any potentially destructive action triggers an intercepting UI dialog requiring explicit user approval before execution.

---

## 📁 Repository Structure

* `/apps/desktop/` - The Tauri + React frontend application. See its [README](./apps/desktop/README.md).
* `/runtime/` - The Python sidecar and AI logic. See its [README](./runtime/README.md).
