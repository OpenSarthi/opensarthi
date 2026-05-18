# OpenSarthi AI Runtime

This is the central "Brain" of the OpenSarthi application. Built in Python using **FastAPI** and **PydanticAI**, it operates as a headless sidecar to the Tauri desktop shell. 

---

## 🧠 Core Architecture & Completed Features

The runtime operates over a WebSocket connection to stream real-time updates (Voice states, execution plans, logs, and dialog) back to the UI.

### 1. Production-Safe Settings & SQLite Databases
- Configured [config.py](./config.py) to read and save persistent user settings in the user's home configuration directory: **`~/.config/opensarthi/.env`**.
- Refactored [db.py](./db.py) to initialize and manage the SQLite conversation database at **`~/.config/opensarthi/opensarthi.db`**.
- This completely avoids crash-loop directory and write-lock failures under **read-only AppImage mounts** in production.
- Integrated an automatic, zero-data-loss history migration mechanism: on first run, it automatically copies any existing local development SQLite records into the persistent home configuration directory so you never lose your chats!
- Retains key values on empty form inputs, and gracefully falls back to the local dev environment during active development.

### 2. Echo Protection & Silence Handshake Voice Loop
- **Active Echo Loop Termination**: The STT listening pipeline automatically suspends audio capture while the Text-To-Speech engine is actively speaking (`is_speaking = True`), preventing microphone captures of the speaker output.
- **Infinite Prompt Length**: Removed fixed transcription restrictions (`phrase_time_limit = None`) to support deep, long spoken prompts.
- **8-Second Smart Silence Timeout**: Activates a silent listening handshake countdown once speaking finishes. Voice activity automatically resets the timer, and silence gracefully sleeps the voice pipeline.

### 3. The Execution Planner (`/planner`)
Powered by `pydantic-ai`, the main agent is responsible for translating user intent (e.g., "Open my browser and go to GitHub") into a structured plan of atomic tool calls. 
* **Dynamic Routing:** Simple system queries are routed to a local lightweight LLM (Ollama `qwen2.5-coder:3b`), while complex reasoning tasks are escalated to a cloud model (via Gemini API / OpenRouter).

### 4. Desktop Automation Backends (`/tools/desktop.py`)
To ensure compatibility across modern Linux distributions, the runtime implements a provider abstraction:
* Auto-detects the display server via the `WAYLAND_DISPLAY` environment variable.
* **X11:** Uses `xdotool` for window manipulation, typing, and mouse control.
* **Wayland:** Uses `ydotool` / `dotool` for secure input simulation on Wayland compositors.

### 5. Safe Shell Execution (`/tools/system.py`)
When the AI determines a shell command must be run, the system tool wraps the command in `bubblewrap` (`bwrap`). This isolates the filesystem and blocks unauthorized network access, drastically reducing the risk of a hallucinated command breaking your OS.

---

## ⚠️ Python Version Requirements

This backend heavily utilizes advanced Machine Learning libraries (for the Voice Pipeline and Vector databases). 
**You MUST use Python 3.12.**

Using Python 3.14+ or alpha releases will cause `pip` to attempt to build C++ binaries (`numpy`, `blis`, `thinc`) from source due to the lack of pre-compiled wheels, which will almost certainly fail on standard Linux installations.

---

## 🚀 Running the Server

If you are running the runtime completely standalone (outside of the Tauri sidecar wrapper):

```bash
# Create and activate your 3.12 virtual environment
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Start the FastAPI server
python main.py
```

The server will auto-negotiate an open port and print `PORT:<number>` to stdout, which the frontend will listen for to establish the WebSocket connection.

---

## 🔮 What's Left (Roadmap)

- [ ] **Multi-turn Barge-In**: Real-time wake-word interruption during active TTS audio streams.
- [ ] **Weight Preloading**: Cache local voice & LLM model parameters in memory on sidecar launch.
- [ ] **Advanced Sandbox Profiles**: Implement user-configurable directory lists for custom bubblewrap execution rules.
