<div align="center">

<!-- ANIMATED HEADER BANNER -->
<img src="https://capsule-render.vercel.app/api?type=venom&color=0:0D1117,50:00D9FF,100:7B2FFE&height=200&section=header&text=OPENSARTHI&fontSize=50&fontColor=FFFFFF&animation=fadeIn&fontAlignY=35&desc=Cross-Platform%20Voice%20and%20System%20Automation%20AI%20Agent&descAlignY=55&descSize=16&descAlign=50" width="100%"/>

<!-- ANIMATED TYPING -->
<br/>

[![Typing SVG](https://readme-typing-svg.demolab.com?font=JetBrains+Mono&weight=600&size=24&duration=3000&pause=800&color=00D9FF&center=true&vCenter=true&multiline=false&repeat=true&width=750&height=45&lines=%F0%9F%A4%96+Autonomous+Desktop+%26+Mobile+AI+Agent;%F0%9F%8E%99%EF%B8%8F+Local+Voice%2C+STT+%26+Wake+Word+Engine;%E2%9A%A1+Tauri+v2+%C2%B7+Capacitor+%C2%B7+React+19+%C2%B7+Python;%F0%9F%A7%A0+LangGraph+State+Machine+%26+Self-Healing;%F0%9F%94%92+Secure+Sandboxing+%26+Risk-Based+Auth)](https://git.io/typing-svg)

<br/>

<!-- REPO METRIC BADGES -->
<a href="https://github.com/OpenSarthi/opensarthi/stargazers"><img src="https://img.shields.io/github/stars/OpenSarthi/opensarthi?style=for-the-badge&logo=github&logoColor=white&color=00D9FF&labelColor=0D1117" alt="Stars"/></a>&nbsp;
<a href="https://github.com/OpenSarthi/opensarthi/network/members"><img src="https://img.shields.io/github/forks/OpenSarthi/opensarthi?style=for-the-badge&logo=git&logoColor=white&color=7B2FFE&labelColor=0D1117" alt="Forks"/></a>&nbsp;
<a href="https://github.com/OpenSarthi/opensarthi/issues"><img src="https://img.shields.io/github/issues/OpenSarthi/opensarthi?style=for-the-badge&logo=github-actions&logoColor=white&color=FF5722&labelColor=0D1117" alt="Issues"/></a>&nbsp;
<a href="https://github.com/OpenSarthi/opensarthi/pulls"><img src="https://img.shields.io/github/issues-pr/OpenSarthi/opensarthi?style=for-the-badge&logo=git-pull-request&logoColor=white&color=2F8D46&labelColor=0D1117" alt="PRs"/></a>&nbsp;
<a href="https://github.com/OpenSarthi/opensarthi/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-Apache_2.0-7B2FFE?style=for-the-badge&logo=apache&logoColor=white&labelColor=0D1117" alt="License"/></a>&nbsp;
<a href="mailto:kumarkartik147359@gmail.com"><img src="https://img.shields.io/badge/Gmail-EA4335?style=for-the-badge&logo=gmail&logoColor=white&labelColor=0D1117" alt="Email"/></a>

</div>

<br/>

<!-- ═══════════════════════════════════════════════════════════════════════════════ -->
<!-- 💡 WHAT IS OPENSARTHI                                                         -->
<!-- ═══════════════════════════════════════════════════════════════════════════════ -->

<img src="https://user-images.githubusercontent.com/73097560/115834477-dbab4500-a447-11eb-908a-139a6edaec5c.gif" width="100%">

## 🤖 &nbsp;What is OpenSarthi?

OpenSarthi is an **agentic AI assistant** that executes local commands, automates workflows, and intercepts hardware events:

- 🗣️ **Speak and listen** — Full voice pipeline with wake word detection, local STT, and TTS voice synthesis.
- 🖥️ **Automate your desktop** — Cursor clicking, keyboard emulation, screen snapshots, shell command parsing, and app launching.
- 📱 **Run on Android** — Integrated mobile agent packages powered by Capacitor + Chaquopy in-process environments.
- 🦾 **Flexible LLM Backend** — Model-agnostic configuration supporting Gemini, Claude, GPT, Groq, OpenRouter, and Ollama.
- 🪙 **Token Accounting** — Real-time tracking separating requests and active model session aggregates.
- 🔧 **Customizable Skills** — Gated capability sets mapped to specific user authorization groups.
- 🔀 **LangGraph Orchestration** — Advanced stateful graph scheduling with transaction-level crash-healing loops.

<br/>

<!-- ═══════════════════════════════════════════════════════════════════════════════ -->
<!-- 🏗️ REPOSITORY LAYOUT                                                          -->
<!-- ═══════════════════════════════════════════════════════════════════════════════ -->

<img src="https://user-images.githubusercontent.com/73097560/115834477-dbab4500-a447-11eb-908a-139a6edaec5c.gif" width="100%">

## 🏗️ &nbsp;Repository Layout

```
opensarthi/
├── apps/
│   ├── desktop/          # Tauri + React desktop overlay client (Linux/Windows/macOS)
│   └── android/          # Capacitor + React Android native app wrapper
├── runtime/              # FastAPI + LangGraph Python sidecar (agent brain)
├── docs/                 # Architectural & protocol design specifications
├── SKILLS.md             # Developer guidelines & capabilities source-of-truth
└── README.md             # This repository README
```

<div align="center">

<table>
<tr>
<td width="50%">

### 🖥️ <a href="apps/desktop">apps/desktop</a>
Tauri v2 core hosting borderless HUD overlays. Integrates system trays, WebSocket telemetry streams, snapping layouts, and task timeline logs.
<br/>
→ [Desktop README](apps/desktop/README.md)

</td>
<td width="50%">

### 📱 <a href="apps/android">apps/android</a>
Capacitor-based hand-held client. Embeds the Python backend directly into the APK via Chaquopy for fully local offline execution.
<br/>
→ [Android README](apps/android/README.md)

</td>
</tr>
<tr>
<td width="100%" colspan="2" align="center">

### ⚙️ <a href="runtime">runtime/</a>
Core AI logic server. Executes intent classifiers, schedules tool calls, manages SQLite memory, and implements self-healing terminal rollbacks.
<br/>
→ [Runtime README](runtime/README.md)

</td>
</tr>
</table>

</div>

<br/>

<!-- ═══════════════════════════════════════════════════════════════════════════════ -->
<!-- 🔄 AGENT FLOW GRAPH                                                           -->
<!-- ═══════════════════════════════════════════════════════════════════════════════ -->

<img src="https://user-images.githubusercontent.com/73097560/115834477-dbab4500-a447-11eb-908a-139a6edaec5c.gif" width="100%">

## 🔀 &nbsp;Agent Execution Graph (LangGraph)

```mermaid
graph TD
    Start([User Input]) --> Classify{Classify Intent}
    Classify -->|Direct Chat| Respond[Response Bubble]
    Classify -->|System Task| Plan[Create Plan Graph]
    Plan --> Execute[Execute First/Next Tool]
    Execute --> Assess{Assess Result}
    Assess -->|Success & More Tools| Execute
    Assess -->|Task Finished| Respond
    Assess -->|Execution Failure| Heal[Self-Healing Node]
    Heal -->|Auto-Healed| Execute
    Heal -->|Blockage / Retry Limit| Replan[Replan / Revise Graph]
    Replan --> Execute
    Respond --> End([Done])

    style Start fill:#0D1117,stroke:#00D9FF,stroke-width:2px,color:#fff
    style End fill:#0D1117,stroke:#00D9FF,stroke-width:2px,color:#fff
    style Classify fill:#00D9FF,stroke:#0D1117,stroke-width:1px,color:#000
    style Assess fill:#7B2FFE,stroke:#0D1117,stroke-width:1px,color:#fff
    style Plan fill:#0D1117,stroke:#00D9FF,stroke-width:1px,color:#fff
    style Execute fill:#0D1117,stroke:#7B2FFE,stroke-width:1px,color:#fff
    style Heal fill:#FF5722,stroke:#0D1117,stroke-width:1px,color:#fff
    style Replan fill:#FF5722,stroke:#0D1117,stroke-width:1px,color:#fff
    style Respond fill:#2F8D46,stroke:#0D1117,stroke-width:1px,color:#fff
```

<br/>

<!-- ═══════════════════════════════════════════════════════════════════════════════ -->
<!-- 📊 ANALYTICS & REPOSITORY GRAPHS                                              -->
<!-- ═══════════════════════════════════════════════════════════════════════════════ -->

<img src="https://user-images.githubusercontent.com/73097560/115834477-dbab4500-a447-11eb-908a-139a6edaec5c.gif" width="100%">

## 📊 &nbsp;Repository Analytics & Metrics

<div align="center">

<table>
<tr>
<td width="55%" align="center">

### 📁 Repository Summary
<a href="https://github.com/OpenSarthi/opensarthi">
  <img src="https://github-readme-stats.vercel.app/api/pin/?username=OpenSarthi&repo=opensarthi&theme=react&bg_color=0D1117&border_color=1a1b27&hide_border=false&icon_color=00D9FF&title_color=00D9FF&text_color=c9d1d9" alt="Repo Stats" width="100%"/>
</a>

</td>
<td width="45%" align="center">

### 🔠 Primary Languages
<a href="https://github.com/OpenSarthi/opensarthi">
  <img src="https://github-readme-stats.vercel.app/api/top-langs/?username=OpenSarthi&repo=opensarthi&layout=compact&theme=react&bg_color=0D1117&border_color=1a1b27&title_color=00D9FF&text_color=c9d1d9" alt="Top Languages" width="100%"/>
</a>

</td>
</tr>
</table>

<br/>

### 📈 Development Commit Activity
<img src="https://github-readme-activity-graph.vercel.app/graph?username=itskartike910&repo=opensarthi&theme=react-dark&bg_color=0D1117&color=00D9FF&line=7B2FFE&point=FFFFFF&area_color=00D9FF&area=true&hide_border=false&custom_title=Repository%20Contribution%20Flow" width="95%"/>

</div>

<br/>

<!-- ═══════════════════════════════════════════════════════════════════════════════ -->
<!-- 📝 TECHNICAL DOCUMENTATION                                                    -->
<!-- ═══════════════════════════════════════════════════════════════════════════════ -->

<img src="https://user-images.githubusercontent.com/73097560/115834477-dbab4500-a447-11eb-908a-139a6edaec5c.gif" width="100%">

## 📑 &nbsp;Technical Documentation

| Resource | Scope & Purpose |
|----------|-----------------|
| 🖥️ **[01 — Frontend & Desktop Shell](docs/01_frontend_and_desktop_shell.md)** | React HUD overlays, Tauri IPC commands, state triggers, styles |
| ⚙️ **[02 — Backend Runtime & Infra](docs/02_backend_runtime_and_infra.md)** | FastAPI loop structure, dynamic port mappings, tool registries |
| 🧠 **[03 — Agentic Flow](docs/03_agentic_flow.md)** | Self-healing logic steps, PydanticAI structures, planner schemas |
| 🔌 **[04 — WebSocket Protocol](docs/04_websocket_protocol.md)** | Payload structure and schemas for client ↔ sidecar telemetry |
| 📱 **[05 — Android Implementation](docs/05_android_implementation.md)** | Capacitor layout integrations, Gradle configuration, Chaquopy setups |

<br/>

<!-- ═══════════════════════════════════════════════════════════════════════════════ -->
<!-- 🚀 QUICK START                                                                -->
<!-- ═══════════════════════════════════════════════════════════════════════════════ -->

<img src="https://user-images.githubusercontent.com/73097560/115834477-dbab4500-a447-11eb-908a-139a6edaec5c.gif" width="100%">

## ⚡ &nbsp;Quick Start

### 🖥️ Desktop Execution
1. Install pnpm dependencies:
   ```bash
   pnpm install
   ```
2. Launch the sidecar runtime and development overlay:
   ```bash
   cd apps/desktop
   pnpm tauri dev
   ```

### 📱 Android Application
1. Build frontend React assets:
   ```bash
   pnpm install
   cd apps/android
   npm run build
   ```
2. Sync plugins and assets to Capacitor:
   ```bash
   npx cap sync android
   ```
3. Deploy and install debugging APK:
   ```bash
   cd android
   ./gradlew installDebug --no-daemon
   ```
   *(For full deployment details, review [Android Installation Guide](docs/05_android_implementation.md))*

<br/>

<!-- ═══════════════════════════════════════════════════════════════════════════════ -->
<!-- 🛠️ SUPPORTED PROVIDERS                                                        -->
<!-- ═══════════════════════════════════════════════════════════════════════════════ -->

<img src="https://user-images.githubusercontent.com/73097560/115834477-dbab4500-a447-11eb-908a-139a6edaec5c.gif" width="100%">

## 🔌 &nbsp;Supported LLM Providers

| Provider | Supported Models | Performance Notes |
|----------|------------------|-------------------|
| **Google Gemini** | 2.5 Flash, 2.5 Pro, 2.0 Flash | Recommended default (lowest latency structured logs) |
| **OpenAI** | GPT-4o, GPT-4o Mini, GPT-4 Turbo | High reliability structured plans |
| **Anthropic** | Claude 3.5 Sonnet, Claude 3 Opus | Complex multi-step reasoning capabilities |
| **Groq** | Llama 3.3 70B, Llama 3.1 8B | Ultra-high inference velocity |
| **OpenRouter** | Any compatible model | Aggregated multi-endpoint routing |
| **Ollama** | Llama 3, Phi 3, Mistral | 100% offline local processing (0 token fees) |

<br/>

<!-- ═══════════════════════════════════════════════════════════════════════════════ -->
<!-- 🏆 DEVELOPER GUIDELINES                                                       -->
<!-- ═══════════════════════════════════════════════════════════════════════════════ -->

<img src="https://user-images.githubusercontent.com/73097560/115834477-dbab4500-a447-11eb-908a-139a6edaec5c.gif" width="100%">

## 💡 &nbsp;Developer Guidelines & Invariants

Before making code edits, check **[SKILLS.md](SKILLS.md)** — the single source-of-truth for code constraints.

- **Dual Process Invariant**: Desktop runs Tauri + Python separately (linked via WebSocket); Android hosts Python inside Tauri/Capacitor in-process.
- **Safety Gating**: Modifying, deleting, or shell operations require user authorization unless marked as `SAFE`.
- **Typing Animations**: Word-by-word streaming must use the `Session.stream_text()` websocket protocol.

<br/>

<!-- ═══════════════════════════════════════════════════════════════════════════════ -->
<!-- 🌊 FOOTER                                                                     -->
<!-- ═══════════════════════════════════════════════════════════════════════════════ -->

<div align="center">
<img src="https://capsule-render.vercel.app/api?type=waving&color=0:0D1117,50:00D9FF,100:7B2FFE&height=120&section=footer" width="100%"/>
</div>

<div align="center">

**⭐ Part of the [OpenSarthi Project](https://github.com/OpenSarthi) — Engineered with 💙 and ☕**

<img src="https://img.shields.io/badge/Made_with-Markdown-000000?style=flat-square&logo=markdown&logoColor=white"/>
<img src="https://img.shields.io/badge/Powered_by-GitHub-181717?style=flat-square&logo=github&logoColor=white"/>
<img src="https://img.shields.io/badge/Fueled_by-Coffee_☕-6F4E37?style=flat-square"/>

</div>
