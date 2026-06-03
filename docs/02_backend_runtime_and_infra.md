# OpenSarthi Desktop Agent & Assistant
# Part 2: Python Runtime, AI, Automation, Voice & Infrastructure

---

> [!NOTE]
> This document describes the design and implementation details of OpenSarthi's Python backend runtime, updated to match the latest implementation.

---

## 1. Python Runtime Architecture

### 1.1 Tech Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| **Python** | 3.12 exactly | TaskGroups, pre-compiled ML wheels compatibility |
| **API Server** | FastAPI | Async-native, auto-docs, WebSocket support |
| **Validation** | Pydantic v2 | Rust-core validation, 5-50x faster than v1 |
| **Async** | asyncio + uvicorn | Standard async runtime |
| **Agent Framework** | PydanticAI (start) → + LangGraph (later) | Type-safe tools first, orchestration when needed |
| **Packaging & Bootstrapping** | **`uv` + Rust Sidecar Launcher** | Portable, self-contained Python venv resolution without needing a global Python installation |

### 1.2 Runtime Directory Structure

```
runtime/
├── main.py                     # FastAPI app entry, sidecar bootstrap
├── config.py                   # Settings via pydantic-settings
├── requirements.txt
│
├── api/
│   ├── routes.py               # REST endpoints (settings, health)
│   └── websocket.py            # WebSocket handler (events/streaming)
│
├── planner/
│   ├── planner.py              # Core planning loop
│   ├── router.py               # Intent classification / routing
│   └── schemas.py              # Plan, PlanStep models
│
├── tests/
│   ├── test_agents.py          # Orchestrator & classification tests
│   ├── test_logging.py         # DevLogger tests
│   └── test_tools.py           # Tool execution logic tests
│
├── tools/
│   ├── registry.py             # Tool registry + discovery
│   ├── base.py                 # BaseTool abstract class
│   ├── app_tools.py            # open_app, close_app, focus_window
│   ├── input_tools.py          # click, type_text, hotkey, scroll
│   ├── screen_tools.py         # capture_screen, OCR
│   ├── a11y_tools.py           # accessibility tree, find_element
│   ├── shell_tools.py          # execute_command, read/write file
│   └── memory_tools.py         # remember, recall, search
│
├── providers/
│   ├── base.py                 # DesktopProvider ABC
│   ├── linux/
│   │   ├── provider.py         # LinuxDesktopProvider
│   │   ├── x11.py              # X11 backend (xdotool)
│   │   ├── wayland.py          # Wayland backend (ydotool/dotool)
│   │   └── accessibility.py    # AT-SPI via GObject Introspection
│   └── factory.py              # Auto-detect display server
│
├── voice/
│   ├── stt.py                  # Faster Whisper integration
│   ├── tts.py                  # Kokoro TTS (primary) / Piper (fallback)
│   ├── wakeword.py             # OpenWakeWord detection
│   └── audio_stream.py         # Unix socket audio I/O with Rust
│
├── llm/
│   ├── base.py                 # LLM provider interface
│   ├── ollama.py               # Local models via Ollama
│   ├── openrouter.py           # Cloud models via OpenRouter
│   └── model_router.py         # Route tasks to appropriate model
│
├── memory/
│   ├── short_term.py           # Conversation context window
│   ├── long_term.py            # Persistent preferences/habits
│   └── store.py                # LanceDB vector store
│
├── security/
│   ├── permissions.py          # PermissionManager
│   ├── sandbox.py              # bubblewrap shell sandboxing
│   └── rules.py                # Dangerous action definitions
│
├── observer/
│   ├── observer.py             # Unified observation collector
│   ├── screen.py               # Screenshot capture (mss)
│   ├── ocr.py                  # Tesseract / EasyOCR
│   └── vision.py               # OpenCV + LLM vision
│
└── mcp/                        # Model Context Protocol support
    ├── server.py               # Expose tools as MCP server
    └── client.py               # Connect to external MCP servers
```

### 1.3 Portable Bootstrap & Executable Distribution Flow

To ensure the packaged executable (AppImage on Linux, `.exe` on Windows) is entirely zero-dependency and does not require pre-installed Python configurations, a portable bootstrapping mechanism manages Python's execution lifecycle:

1. **Tauri Sidecar Ingestion**: The native Rust desktop shell executes the compiled bootstrap launcher (`opensarthi-runtime` sidecar) which is bundled inside the app's resource scope.
2. **Environment Location Mapping**: All runtime dependencies and configuration files are completely isolated from read-only application mounts to avoid permission errors:
   - **Linux**: Config at `~/.config/opensarthi/` and Python Virtual Environment at `~/.config/opensarthi/venv/`
   - **Windows**: Config at `%LOCALAPPDATA%\opensarthi\` and Python Virtual Environment at `%LOCALAPPDATA%\opensarthi\venv\`
3. **Environment Audit & Provisioning**:
   - The launcher checks if the virtual environment directory already exists and validates key Python package imports (e.g. `fastapi`, `pydantic_ai`, `speech_recognition`).
   - If missing or corrupted, the launcher leverages the bundled `uv` utility to fetch a standalone, portable Python 3.12 build.
   - It initializes a virtual environment and runs `uv pip install -r requirements.txt` to pull down local dependencies and build compatibility layers.
4. **Dynamic Negotiation & Socket Boot**: Once libraries are resolved, it launches FastAPI/Uvicorn on a free, dynamically-negotiated OS port and prints `PORT:<number>` to stdout. Tauri reads this stream, establishes the WebSocket listener, and redirects user queries.

---

## 2. Core Runtime Flow

```
User Input (voice/text)
    │
    ▼
┌─────────────────┐
│  Intent Router   │  ← Local model (Ollama: qwen2.5:3b)
│  (lightweight)   │
└────────┬────────┘
         │
    ┌────▼────┐
    │ Simple? │──Yes──► Direct tool execution
    └────┬────┘
         │ No
    ┌────▼─────────────┐
    │  Planner (Cloud)  │  ← DeepSeek V3 / Gemini Flash
    │  Generate plan    │
    └────────┬─────────┘
             │
    ┌────────▼─────────┐
    │  Execution Loop   │
    │  ┌──────────────┐ │
    │  │ Execute tool  │ │
    │  │ Observe state │ │
    │  │ Re-plan if    │ │
    │  │ needed        │ │
    │  └──────────────┘ │
    └────────┬─────────┘
             │
    ┌────────▼─────────┐
    │  Response / Done  │  → TTS + UI update
    └──────────────────┘
```

---

## 3. Agent & Planning Architecture

### 3.1 Intent Router

Runs a **small local model** for fast classification:

| Intent Type | Action | Model |
|------------|--------|-------|
| Simple command | Direct tool call | Local (qwen2.5:3b) |
| Complex task | Full planning | Cloud (DeepSeek V3) |
| Conversation | Chat response | Cloud (Gemini Flash) |
| System query | Direct lookup | No LLM needed |

### 3.2 Plan Schema

```python
class PlanStep(BaseModel):
    tool: str
    args: dict[str, Any]
    description: str
    depends_on: list[int] = []  # Step indices
    retry_strategy: RetryStrategy = RetryStrategy.ONCE

class Plan(BaseModel):
    goal: str
    steps: list[PlanStep]
    recovery_hint: str | None = None
```

### 3.3 Tool Registry

```python
class BaseTool(ABC):
    name: str
    description: str  # For LLM tool selection
    parameters: dict  # JSON Schema
    risk_level: RiskLevel  # SAFE, MODERATE, DANGEROUS
    
    @abstractmethod
    async def execute(self, args: dict, provider: DesktopProvider) -> ToolResult: ...

class ToolRegistry:
    _tools: dict[str, BaseTool]
    
    def register(self, tool: BaseTool): ...
    def get(self, name: str) -> BaseTool: ...
    def get_schemas(self) -> list[dict]:  # For LLM function calling
        ...
```

### 3.4 Core Primitive Tools

**Application:** `open_app`, `close_app`, `focus_window`, `list_windows`

**Input:** `click`, `double_click`, `right_click`, `move_mouse`, `scroll`, `type_text`, `hotkey`, `press_key`

**Screen:** `capture_screen`, `capture_region`, `get_active_window`, `ocr_text`, `locate_image`

**Accessibility:** `get_accessibility_tree`, `find_element`, `click_element`, `read_element_text`

**Shell:** `execute_command`, `list_processes`, `read_file`, `write_file`

**Memory:** `remember`, `recall`, `search_memory`

---

## 4. Desktop Provider Abstraction

### 4.1 Interface

```python
class DesktopProvider(ABC):
    @abstractmethod
    async def open_app(self, name: str) -> bool: ...
    @abstractmethod
    async def click(self, x: int, y: int, button: str = "left") -> None: ...
    @abstractmethod
    async def type_text(self, text: str) -> None: ...
    @abstractmethod
    async def hotkey(self, *keys: str) -> None: ...
    @abstractmethod
    async def get_windows(self) -> list[WindowInfo]: ...
    @abstractmethod
    async def capture_screen(self) -> bytes: ...
    @abstractmethod
    async def get_accessibility_tree(self) -> AccessibilityNode: ...
    @abstractmethod
    async def find_element(self, **criteria) -> UIElement | None: ...
```

### 4.2 Linux: X11 vs Wayland

> [!WARNING]
> **Critical:** `xdotool` only works on X11. Wayland requires different tools. The provider must detect and adapt.

| Capability | X11 | Wayland |
|-----------|-----|---------|
| **Input simulation** | `xdotool` | `ydotool` (uinput, needs daemon) or `dotool` |
| **Keyboard typing** | `xdotool type` | `wtype` (native) or `ydotool` |
| **Window management** | `wmctrl` / `xdotool` | Compositor-specific (swaymsg, gdbus for GNOME) |
| **Window listing** | `wmctrl -l` | D-Bus / compositor IPC |
| **Accessibility** | `pyatspi2` (D-Bus) | GObject Introspection (direct AT-SPI D-Bus) |
| **Screenshots** | `mss` / X11 API | `grim` (wlroots) / D-Bus portal |

**Auto-detection:**
```python
def detect_display_server() -> str:
    if os.environ.get("WAYLAND_DISPLAY"):
        return "wayland"
    if os.environ.get("DISPLAY"):
        return "x11"
    raise RuntimeError("No display server detected")
```

### 4.3 Future Providers

| Platform | Technologies |
|----------|-------------|
| **Windows** | UIAutomation, pywinauto |
| **macOS** | Accessibility API, pyobjc |

---

## 5. Voice Pipeline

### 5.1 Wake Word → STT → TTS Flow

```
Mic (Rust/cpal) → PCM stream → Unix socket → Python
    │
    ▼
OpenWakeWord (always listening, low CPU)
    │ Triggered
    ▼
Faster Whisper (activate on trigger)
    │ Transcript
    ▼
Agent Runtime (process intent)
    │ Response text
    ▼
Kokoro TTS → PCM audio → Unix socket → Rust (rodio) → Speaker
```

### 5.2 Component Choices

| Component | Primary | Fallback | Rationale |
|-----------|---------|----------|-----------|
| **STT** | faster-whisper (large-v3-turbo) | distil-whisper | Best NVIDIA GPU perf; turbo model for speed |
| **Wake Word** | OpenWakeWord | — | Free, open-source, customizable phrases |
| **TTS** | **Kokoro TTS** | Piper TTS | Kokoro: best quality/speed on CPU. Piper: ultra-low-resource fallback |

> [!NOTE]
> **Changed from original spec:** Kokoro TTS replaces Piper as primary. Kokoro produces significantly more natural speech while still running on CPU. Piper remains as fallback for very low-resource systems.

### 5.3 STT Configuration

```python
# faster-whisper with VAD for efficient streaming
from faster_whisper import WhisperModel

model = WhisperModel(
    "large-v3-turbo",      # or "distil-large-v3" for speed
    device="cuda",          # or "cpu"
    compute_type="int8",    # memory efficient
)
segments, info = model.transcribe(
    audio_data,
    vad_filter=True,        # Skip silence
    beam_size=5,
    language="en",
)
```

---

## 6. AI Model Strategy

### 6.1 Model Routing

| Task | Model Tier | Provider | Recommended Model |
|------|-----------|----------|--------------------|
| Intent classification | Local | Ollama | qwen2.5:3b |
| Simple commands | Local | Ollama | qwen2.5:7b |
| Complex planning | Cloud | OpenRouter | DeepSeek V3 |
| Multimodal reasoning | Cloud | OpenRouter | Gemini Flash / Gemini Pro |
| Code generation | Cloud | OpenRouter | DeepSeek Coder |
| Vision (screenshot analysis) | Cloud | OpenRouter | Gemini Flash (vision) |

### 6.2 Function Calling Format

All tools exposed as standard function-calling schemas:

```python
def get_tool_schemas() -> list[dict]:
    return [
        {
            "type": "function",
            "function": {
                "name": tool.name,
                "description": tool.description,
                "parameters": tool.parameters,  # JSON Schema
            }
        }
        for tool in registry.all_tools()
    ]
```

### 6.3 MCP Integration

Expose the agent's tools as an **MCP server** so external AI clients can use them. Also act as an **MCP client** to consume tools from external MCP servers (expanding capabilities without code changes).

---

## 7. Security Model

### 7.1 Risk Levels

```python
class RiskLevel(Enum):
    SAFE = "safe"           # open_app, capture_screen, read_file
    MODERATE = "moderate"   # type_text, click, write_file
    DANGEROUS = "dangerous" # execute_command, delete file, sudo
    FORBIDDEN = "forbidden" # never auto-execute
```

### 7.2 Permission Manager

```python
class PermissionManager:
    async def check(self, tool: str, args: dict, risk: RiskLevel) -> bool:
        if risk == RiskLevel.SAFE:
            return True
        if risk == RiskLevel.FORBIDDEN:
            return False
        if self._has_permanent_permission(tool, args):
            return True
        # Send permission_request via WebSocket → wait for user response
        return await self._request_user_permission(tool, args, risk)
```

### 7.3 Shell Sandboxing

Use **bubblewrap** (`bwrap`) for shell command execution:

```python
async def sandboxed_execute(command: str, timeout: int = 30) -> str:
    bwrap_cmd = [
        "bwrap",
        "--ro-bind", "/usr", "/usr",
        "--ro-bind", "/bin", "/bin",
        "--ro-bind", "/lib", "/lib",
        "--ro-bind", "/lib64", "/lib64",
        "--proc", "/proc",
        "--dev", "/dev",
        "--tmpfs", "/tmp",
        "--unshare-all",
        "--share-net",
        "--die-with-parent",
        "--", "bash", "-c", command,
    ]
    proc = await asyncio.create_subprocess_exec(
        *bwrap_cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await asyncio.wait_for(
        proc.communicate(), timeout=timeout
    )
    return stdout.decode()
```

### 7.4 Command Filtering

```python
BLOCKED_PATTERNS = [
    r"rm\s+-rf\s+/",
    r"mkfs\.",
    r"dd\s+if=.+of=/dev/",
    r":\(\)\{.*\}",          # Fork bomb
    r"chmod\s+-R\s+777\s+/",
]
```

### 7.5 Security Rules Summary

| Rule | Implementation |
|------|---------------|
| Never `os.system(llm_output)` | All commands go through PermissionManager |
| Sandbox shell commands | bubblewrap with restricted filesystem |
| Timeout all commands | 30s default, configurable |
| Block destructive patterns | Regex filter before execution |
| Require confirmation for `sudo` | Always DANGEROUS risk level |
| Log all actions | Structured audit log |

---

## 8. Memory System

### 8.1 Short-Term Memory

- Current conversation context (last N messages)
- Current workflow state (plan + observations)
- Managed as a sliding window in the planner

### 8.2 Long-Term Memory

| Data | Storage | Access |
|------|---------|--------|
| Preferences | SQLite | Direct query |
| App habits | SQLite | Pattern matching |
| Semantic memory | **LanceDB** | Vector similarity search |
| Workflow templates | SQLite (JSON) | Name/tag lookup |

### 8.3 Storage Stack

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| **Structured data** | SQLite (via aiosqlite) | Zero-config, embedded, reliable |
| **Vector search** | **LanceDB** | Embedded (no server), disk-based, multimodal-ready |
| **Embeddings** | `all-MiniLM-L6-v2` (via sentence-transformers) | Fast, small, good quality |

> [!NOTE]
> **Changed from original spec:** LanceDB replaces the SQLite→PostgreSQL→pgvector migration path. LanceDB is embedded (like SQLite), handles larger-than-RAM datasets, and supports multimodal data natively. No server to manage.
> 
> **Graceful Degradation:** To support portable execution and ease local configuration, if `lancedb` or `sentence-transformers` package dependencies are missing, the long-term memory engine gracefully falls back to a local SQLite keyword substring similarity query, preventing runtime crashes while keeping memory functional out-of-the-box.

---

## 9. Vision Pipeline

For apps where accessibility trees are incomplete (Electron, canvas-based, games):

```
Screenshot (mss / grim)
    │
    ├──► Tesseract OCR → extracted text + bounding boxes
    │
    ├──► OpenCV → UI element detection (buttons, inputs, etc.)
    │
    └──► LLM Vision (Gemini Flash) → semantic understanding
            │
            ▼
    Merged observation (text + elements + semantic context)
```

**Libraries:**
- `mss` — fast screenshot (X11); `grim` for Wayland
- `pytesseract` or `easyocr` — OCR
- `opencv-python-headless` — image processing
- Cloud vision model — semantic understanding

---

## 10. Dependency Summary

### Python Runtime (`requirements.txt`)

```
# API
fastapi>=0.115
uvicorn[standard]>=0.32
websockets>=13
pydantic>=2.9
pydantic-settings>=2.6

# AI
pydantic-ai>=0.2
ollama>=0.4
httpx>=0.28              # For OpenRouter API calls

# Voice
faster-whisper>=1.1
openwakeword>=0.6
kokoro>=0.9              # Primary TTS
piper-tts>=1.2           # Fallback TTS

# Automation
mss>=9.0                 # Screenshots
PyGObject>=3.50          # AT-SPI via GObject Introspection
pytesseract>=0.3
opencv-python-headless>=4.10

# Storage
aiosqlite>=0.20
lancedb>=0.15
sentence-transformers>=3.3

# Security
# bubblewrap — system package, not pip

# Utilities
structlog>=24.4          # Structured logging
```

### Rust Core (`Cargo.toml` key deps)

```toml
[dependencies]
tauri = { version = "2", features = ["tray-icon"] }
tauri-plugin-shell = "2"
tauri-plugin-notification = "2"
tauri-plugin-global-shortcut = "2"
tauri-plugin-clipboard-manager = "2"
tauri-plugin-dialog = "2"
tauri-plugin-autostart = "2"
cpal = "0.15"            # Audio input
rodio = "0.19"           # Audio playback
xcap = "0.0"             # Screenshots
tokio = { version = "1", features = ["full"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tracing = "0.1"
tracing-subscriber = "0.3"
```

### System Packages (Linux)

```bash
# Ubuntu/Debian
sudo apt install \
    at-spi2-core libatspi2.0-dev \  # Accessibility
    xdotool wmctrl \                 # X11 automation
    ydotool \                        # Wayland automation
    tesseract-ocr \                  # OCR
    bubblewrap \                     # Sandboxing
    libwebkit2gtk-4.1-dev \          # Tauri WebView
    libappindicator3-dev \           # System tray
    grim slurp                       # Wayland screenshots
```

---

## 11. Development Priorities (Full Stack)

### Phase 1 — Foundation (Weeks 1-3)
| # | Task | Component |
|---|------|-----------|
| 1 | Tauri v2 shell + system tray | Frontend |
| 2 | Python sidecar lifecycle (spawn/health/restart) | Rust + Python |
| 3 | FastAPI + WebSocket server | Python |
| 4 | IPC protocol (WebSocket messages) | All |
| 5 | DesktopProvider interface + Linux auto-detect | Python |

### Phase 2 — Voice (Weeks 3-5)
| # | Task | Component |
|---|------|-----------|
| 6 | Mic capture (cpal) + audio streaming | Rust |
| 7 | OpenWakeWord integration | Python |
| 8 | Faster Whisper STT | Python |
| 9 | Kokoro TTS + audio playback | Python + Rust |
| 10 | Voice button UI + waveform | Frontend |

### Phase 3 — Automation (Weeks 5-7)
| # | Task | Component |
|---|------|-----------|
| 11 | xdotool / ydotool input tools | Python |
| 12 | AT-SPI accessibility tree | Python |
| 13 | Screenshot + OCR pipeline | Python |
| 14 | Tool registry + base tools | Python |
| 15 | Shell execution + bubblewrap sandbox | Python |

### Phase 4 — AI Brain (Weeks 7-9)
| # | Task | Component |
|---|------|-----------|
| 16 | Ollama integration (local models) | Python |
| 17 | OpenRouter integration (cloud models) | Python |
| 18 | Intent router (local model) | Python |
| 19 | Planner (cloud model) | Python |
| 20 | Execution loop (plan → execute → observe → replan) | Python |

### Phase 5 — Polish (Weeks 9-11)
| # | Task | Component |
|---|------|-----------|
| 21 | Permission system + UI dialogs | Python + Frontend |
| 22 | Action log timeline UI | Frontend |
| 23 | Settings panel | Frontend |
| 24 | Memory system (SQLite + LanceDB) | Python |
| 25 | Error recovery + retry logic | Python |

### Phase 6 — Advanced (Weeks 11+)
| # | Task | Component |
|---|------|-----------|
| 26 | MCP server/client | Python |
| 27 | Vision pipeline (OpenCV + LLM) | Python |
| 28 | Workflow templates | Python + Frontend |
| 29 | Desktop overlays | Frontend |
| 30 | PyInstaller packaging + distribution | Build |

---

## 12. Key Deviations from Original Spec

| Original | Recommendation | Rationale |
|----------|---------------|-----------|
| Piper TTS (primary) | **Kokoro TTS** primary, Piper fallback | Kokoro: far more natural voice, still CPU-friendly |
| `pyatspi` for accessibility | **GObject Introspection** (direct AT-SPI D-Bus) | `pyatspi` is deprecated; GNOME/Orca moved away from it |
| xdotool only | **xdotool + ydotool/dotool** with auto-detect | Wayland support is essential for modern Linux |
| SQLite → PostgreSQL → pgvector | **SQLite + LanceDB** (embedded) | No server management; LanceDB handles vectors natively |
| Custom orchestration | **PydanticAI** (start) → **+ LangGraph** (later) | Type-safe tools from day one; add orchestration complexity only when needed |
| No MCP mention | **MCP server + client** | Industry standard (Linux Foundation); enables ecosystem integration |
| No sandboxing detail | **bubblewrap** for shell commands | Lightweight, unprivileged, used by Flatpak |
| Unspecified logging | **structlog** (Python) + **tracing** (Rust) | Structured, machine-parseable, spans for debugging |
| No Wayland strategy | **Full X11/Wayland dual-backend** | Wayland is default on most distros now |

---

> [!TIP]
> Both documents together form the complete implementation plan. Review and provide feedback before any code is written.
