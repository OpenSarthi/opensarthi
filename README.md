# OpenSarthi

**An AI-native Desktop Operating Layer & Assistant**

OpenSarthi is an autonomous, voice-first AI desktop agent initially focused on Linux desktop automation. Rather than functioning as just another chatbot window, OpenSarthi acts as a generalized computer-use primitive, capable of executing system-level tasks, app control, screen interaction, and shell automation natively on your machine.

## 🏗️ Architecture Overview

OpenSarthi is built as a monorepo utilizing a modern, secure, two-part architecture:

1. **The Desktop Shell (Frontend):** 
   A blazing-fast desktop overlay built with **Tauri v2, React 19, and TypeScript**. It provides the native windowing, system tray, granular OS permissions, and a beautiful glassmorphism UI.
2. **The AI Brain (Backend Sidecar):**
   A robust, local-first **Python (FastAPI + PydanticAI)** runtime that handles LLM orchestration, task planning, tool execution (via `xdotool`/`ydotool`), shell sandboxing (`bubblewrap`), and the real-time voice pipeline.

## 🚀 Getting Started

### Prerequisites
* **Node.js & pnpm**: For compiling the Tauri frontend.
* **Rust / Cargo**: Required by Tauri for the native bindings.
* **Python 3.12**: Highly recommended. (Note: Using newer/alpha versions like Python 3.14 may cause installation failures for machine learning libraries like `faster-whisper` and `kokoro` due to missing pre-compiled wheels).

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

To run the application in development mode, it's easiest to start the backend and frontend in separate terminals to view logs.

**Terminal 1: Start the Python Runtime**
```bash
cd runtime
source .venv/bin/activate
python main.py
```

**Terminal 2: Start the Desktop App**
```bash
# From the root directory
pnpm dev
```

## 🔒 Security First

OpenSarthi runs commands on your machine. To keep your system safe:
* **Tauri v2 Capabilities**: The frontend is strictly locked down using Tauri's granular permission system.
* **Bubblewrap Sandboxing**: By default, shell commands executed by the AI are wrapped in `bwrap` with isolated filesystem and network access.
* **User Consent**: Any potentially destructive action triggers an intercepting UI dialog requiring explicit user approval before execution.

## 📁 Repository Structure

* `/apps/desktop/` - The Tauri + React frontend application. See its [README](./apps/desktop/README.md).
* `/runtime/` - The Python sidecar and AI logic. See its [README](./runtime/README.md).
