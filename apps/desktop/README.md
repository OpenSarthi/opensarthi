# OpenSarthi Desktop Shell

This is the native frontend shell for the OpenSarthi AI agent, built using **Tauri v2**, **React 19**, and **TypeScript**.

## 🎨 UI & Design System

The interface is designed to be a lightweight, borderless, floating overlay that stays out of your way until needed.
* **Glassmorphism Theme:** Custom CSS (`globals.css`) provides a sleek, dark-mode transparent aesthetic with purple-blue accents.
* **Interactive Components:** Utilizing `framer-motion` for fluid micro-animations (e.g., the pulsing microphone button, the real-time audio waveform, and the expanding action logs).
* **State Management:** Fully managed by `zustand` to coordinate Voice States, Conversation History, AI Execution Plans, and Security Permission Requests.

## 🔌 Core Integrations

Because this is a Tauri application, the React frontend has native capabilities that a standard web app does not:
* **System Tray:** A native OS tray icon allows you to show/hide the assistant globally.
* **Sidecar Management:** The Rust core is configured to automatically spawn and manage the lifecycle of the Python AI runtime (`opensarthi-runtime`).
* **IPC (Inter-Process Communication):** Custom Rust-to-Frontend events are used for port negotiation, screenshot captures, and global hotkey triggers.

## 🔒 Tauri v2 Permissions Configuration

We use Tauri v2's strict capability system. The permissions are explicitly mapped out in `src-tauri/capabilities/main.json`. 
The frontend is only allowed to perform specific OS functions (like reading clipboard, firing notifications, and reading the screen buffer), ensuring a secure boundary between the UI and the host system.

## 🛠️ Development

To start the UI in development mode:

```bash
# Ensure you are in the apps/desktop directory or running from the monorepo root via pnpm
pnpm install
pnpm dev
```

*Note: The frontend will attempt to connect to the Python runtime via WebSocket. Ensure the backend is running and has printed its dynamically assigned port to the console so the Tauri sidecar listener can pick it up.*
