# OpenSarthi AI Runtime

This is the central "Brain" of the OpenSarthi application. Built in Python using **FastAPI** and **PydanticAI**, it operates as a headless sidecar to the Tauri desktop shell. 

## 🧠 Core Architecture

The runtime operates over a WebSocket connection to stream real-time updates (Voice states, execution plans, logs, and dialog) back to the UI.

### 1. The Execution Planner (`/planner`)
Powered by `pydantic-ai`, the main agent is responsible for translating user intent (e.g., "Open my browser and go to GitHub") into a structured plan of atomic tool calls. 
* **Dynamic Routing:** Simple system queries are routed to a local lightweight LLM (Ollama `qwen2.5:3b`), while complex reasoning tasks are escalated to a cloud model (via OpenRouter).

### 2. Desktop Automation Backends (`/tools/desktop.py`)
To ensure compatibility across modern Linux distributions, the runtime implements a provider abstraction:
* Auto-detects the display server via the `WAYLAND_DISPLAY` environment variable.
* **X11:** Uses `xdotool` for window manipulation, typing, and mouse control.
* **Wayland:** Uses `ydotool` / `dotool` for secure input simulation on Wayland compositors.

### 3. Safe Shell Execution (`/tools/system.py`)
When the AI determines a shell command must be run, the system tool wraps the command in `bubblewrap` (`bwrap`). This isolates the filesystem and blocks unauthorized network access, drastically reducing the risk of a hallucinated command breaking your OS.

### 4. Local Voice Pipeline (`/voice/pipeline.py`)
A fast, fully-local voice interface:
* **TTS:** `Kokoro` for ultra-fast, natural-sounding voice synthesis.
* **STT:** `faster-whisper` (large-v3-turbo) for highly accurate speech recognition.
* **Wake Word:** `openwakeword` for continuous listening without cloud dependencies.

## ⚠️ Python Version Requirements

This backend heavily utilizes advanced Machine Learning libraries (for the Voice Pipeline and Vector databases). 
**You MUST use Python 3.12.**

Using Python 3.14+ or alpha releases will cause `pip` to attempt to build C++ binaries (`numpy`, `blis`, `thinc`) from source due to the lack of pre-compiled wheels, which will almost certainly fail on standard Linux installations.

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
