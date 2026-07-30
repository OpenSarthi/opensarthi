# OpenSarthi — WebSocket Protocol Reference

This document is the canonical reference for all WebSocket messages exchanged between the frontend (Tauri WebView) and the Python runtime (FastAPI sidecar).

> **Updated:** July 2026 — conversational settings tool, long-term memory toggle, streaming chunks, window control events, multi-tab thread support, audio cue triggers, and permanent permission grants.

---

## Protocol Overview

All messages use a JSON envelope:

```json
{
  "id": "uuid-v4",
  "type": "message_type",
  "payload": {},
  "timestamp": 1234567890.123
}
```

- **`id`** — unique per message; used for deduplication
- **`type`** — routes to specific handler
- **`payload`** — type-specific data
- **`timestamp`** — Unix seconds (float)

The WebSocket endpoint is `ws://127.0.0.1:<PORT>/ws` where `PORT` is dynamically negotiated at startup.

---

## Client → Server Messages

### `user_message`

Send a text message to the agent.

```json
{
  "type": "user_message",
  "payload": {
    "text": "Open Firefox and search for the weather",
    "thread_id": "8558d1f1-790f-4441-8a13-a45b9ec79398"
  }
}
```

### `run_json_plan`

Execute a pre-built JSON plan directly, bypassing LLM planning.

```json
{
  "type": "run_json_plan",
  "payload": {
    "goal": "Open Firefox and go to GitHub",
    "thread_id": "8558d1f1-...",
    "steps": [
      { "tool": "open_app", "args": { "app": "firefox" }, "description": "Launch Firefox" },
      { "tool": "wait_for_window", "args": { "title": "Firefox", "timeout": 10 }, "description": "Wait for Firefox" }
    ]
  }
}
```

### `cancel_execution`

Cancel the currently running task. Immediately cancels both the LLM inference task and the active tool task.

```json
{
  "type": "cancel_execution",
  "payload": { "thread_id": "8558d1f1-..." }
}
```

### `pause_execution`

Pause execution. The loop blocks at the next `_check_pause()` call.

```json
{
  "type": "pause_execution",
  "payload": { "thread_id": "8558d1f1-..." }
}
```

### `resume_execution`

Resume a paused execution.

```json
{
  "type": "resume_execution",
  "payload": { "thread_id": "8558d1f1-..." }
}
```

### `update_settings`

Update one or more settings. Empty string values for API keys are ignored (no accidental deletion).

```json
{
  "type": "update_settings",
  "payload": {
    "ai_provider": "google",
    "cloud_model": "gemini-2.5-flash",
    "local_model": "qwen2.5-coder:3b",
    "gemini_api_key": "AIza...",
    "openai_api_key": "",
    "anthropic_api_key": "",
    "groq_api_key": "",
    "openrouter_api_key": "",
    "voice_accent": "af_heart",
    "voice_speed": 1.35,
    "continuous_listening": false,
    "active_theme": "theme-green-black",
    "wake_words": ["hey sarthi", "hello sarthi"],
    "wake_word_enabled": true,
    "wake_word_threshold": 0.5,
    "long_term_memory_enabled": true,
    "user_name": "Kartik",
    "user_skills": ["general", "developer", "desktop_automation"],
    "custom_prompt": "I prefer concise answers."
  }
}
```

All fields are optional. Missing fields are left unchanged.

### `permission_response`

Response to a `permission_request` from the server.

```json
{
  "type": "permission_response",
  "payload": {
    "request_id": "uuid-of-original-request",
    "granted": true,
    "permanent": false
  }
}
```

If `permanent: true`, the frontend caches the grant in `permanentGrants` and will not show a dialog for future requests of the same tool.

### `input_response`

Response to an `input_request` from the server (agent asked for user input).

```json
{
  "type": "input_response",
  "payload": {
    "request_id": "uuid-of-original-request",
    "value": "my-password"
  }
}
```

### `get_history`

Request the list of past conversation threads.

```json
{
  "type": "get_history",
  "payload": {}
}
```

### `load_thread`

Load a specific past thread into the current session.

```json
{
  "type": "load_thread",
  "payload": { "thread_id": "8558d1f1-..." }
}
```

### `manual_voice_trigger`

(Android-specific) User tapped the mic button — start STT.

```json
{
  "type": "manual_voice_trigger",
  "payload": {}
}
```

### `get_memories`

Request the list of long-term memories / passive facts from the database.

```json
{
  "type": "get_memories",
  "payload": {
    "thread_id": "8558d1f1-..."
  }
}
```

---

## Server → Client Messages

### `assistant_response`

Final or complete assistant response text (non-streaming).

```json
{
  "type": "assistant_response",
  "payload": {
    "text": "I opened Firefox and searched for the weather.",
    "thread_id": "8558d1f1-...",
    "usage": {
      "request_tokens": 450,
      "response_tokens": 85,
      "total_tokens": 535
    }
  }
}
```

### `stream_chunk`

A single word or token chunk during streaming response (word-by-word animation).

```json
{
  "type": "stream_chunk",
  "payload": {
    "chunk": "Hello",
    "thread_id": "8558d1f1-..."
  }
}
```

### `plan_created`

The agent has generated an action plan. The frontend renders this in the ActionLog.

```json
{
  "type": "plan_created",
  "payload": {
    "id": "plan-uuid",
    "goal": "Open Firefox and search for weather",
    "steps": [
      {
        "index": 0,
        "tool": "open_app",
        "description": "Launch Firefox",
        "args": { "app": "firefox" },
        "status": "pending"
      },
      {
        "index": 1,
        "tool": "wait_for_window",
        "description": "Wait for Firefox to open",
        "args": { "title": "Firefox", "timeout": 10 },
        "status": "pending"
      }
    ],
    "recovery_hint": "If Firefox fails to open, try using the shell tool."
  }
}
```

### `tool_started`

A specific plan step has begun execution.

```json
{
  "type": "tool_started",
  "payload": {
    "index": 0,
    "tool": "open_app",
    "description": "Launch Firefox",
    "args": { "app": "firefox" }
  }
}
```

### `tool_completed`

A plan step completed successfully.

```json
{
  "type": "tool_completed",
  "payload": {
    "index": 0,
    "tool": "open_app",
    "description": "Launch Firefox",
    "result": "Application launched successfully.",
    "args": { "app": "firefox" }
  }
}
```

### `tool_error`

A plan step failed.

```json
{
  "type": "tool_error",
  "payload": {
    "index": 0,
    "tool": "open_app",
    "description": "Launch Firefox",
    "error": "Application not found: firefox",
    "args": { "app": "firefox" }
  }
}
```

### `tool_action`

A lightweight event emitted alongside `tool_started`/`tool_completed` for the ActionLog right panel.

```json
{
  "type": "tool_action",
  "payload": {
    "tool": "open_app",
    "description": "Launch Firefox",
    "status": "running",
    "result": null
  }
}
```

`status` values: `"running"` | `"success"` | `"error"` | `"terminated"` | `"skipped"`

### `tool_terminated`

A step was cancelled mid-execution.

```json
{
  "type": "tool_terminated",
  "payload": {
    "index": 0,
    "tool": "open_app"
  }
}
```

### `intent_classified`

The intent classifier result.

```json
{
  "type": "intent_classified",
  "payload": {
    "classification": "TASK",
    "thread_id": "8558d1f1-..."
  }
}
```

`classification` values: `"CHAT"` | `"TASK"` | `"CLARIFY"`

### `voice_state`

Voice pipeline state change.

```json
{
  "type": "voice_state",
  "payload": {
    "state": "listening"
  }
}
```

`state` values: `"idle"` | `"listening"` | `"processing"` | `"speaking"` | `"error"`

### `session_state`

Connection status event (emitted on connect/disconnect).

```json
{
  "type": "session_state",
  "payload": { "connected": true }
}
```

### `settings_sync`

Full settings state pushed to frontend on connect or after any update.

```json
{
  "type": "settings_sync",
  "payload": {
    "ai_provider": "google",
    "local_model": "qwen2.5-coder:3b",
    "cloud_model": "gemini-2.5-flash",
    "has_gemini_key": true,
    "has_openai_key": false,
    "has_anthropic_key": false,
    "has_groq_key": false,
    "has_openrouter_key": false,
    "voice_accent": "af_heart",
    "voice_speed": 1.35,
    "continuous_listening": false,
    "active_theme": "theme-green-black",
    "wake_words": ["hey sarthi", "hello sarthi"],
    "wake_word_enabled": true,
    "wake_word_threshold": 0.5,
    "long_term_memory_enabled": true,
    "user_name": "Kartik",
    "user_skills": ["general", "developer"],
    "custom_prompt": "I prefer concise answers."
  }
}
```

Note: API key values are **never** sent to the frontend. Only boolean `has_*_key` flags indicating whether a key is configured.

### `history_response`

Response to `get_history` — list of past threads.

```json
{
  "type": "history_response",
  "payload": {
    "threads": [
      {
        "id": "8558d1f1-...",
        "created_at": "2026-07-15T14:32:54",
        "first_message": "Open Firefox and search for weather"
      }
    ]
  }
}
```

### `thread_loaded`

Response to `load_thread` — restores full message history.

```json
{
  "type": "thread_loaded",
  "payload": {
    "thread_id": "8558d1f1-...",
    "messages": [
      { "role": "user", "content": "Open Firefox", "timestamp": 1234567890 },
      { "role": "assistant", "content": "Opening Firefox now...", "timestamp": 1234567891 }
    ],
    "token_totals": {
      "request_tokens": 450,
      "response_tokens": 85,
      "total_tokens": 535
    }
  }
}
```

### `task_paused` / `task_resumed`

```json
{ "type": "task_paused", "payload": {} }
{ "type": "task_resumed", "payload": {} }
```

### `window_control`

Instructs the frontend to change the window mode.

```json
{
  "type": "window_control",
  "payload": {
    "action": "minimize_hint",
    "reason": "Plan contains screen-interaction steps"
  }
}
```

```json
{
  "type": "window_control",
  "payload": {
    "action": "restore"
  }
}
```

`action` values: `"minimize_hint"` | `"restore"`

### `permission_request`

Agent requests user approval to run a tool.

```json
{
  "type": "permission_request",
  "payload": {
    "request_id": "uuid",
    "tool": "shell",
    "description": "Run: rm -rf /tmp/test",
    "risk_level": "HIGH",
    "args": { "command": "rm -rf /tmp/test" }
  }
}
```

`risk_level` values: `"SAFE"` | `"MODERATE"` | `"HIGH"`

### `input_request`

Agent asks the user to provide a value.

```json
{
  "type": "input_request",
  "payload": {
    "request_id": "uuid",
    "prompt": "Please enter your GitHub token:",
    "field_name": "github_token",
    "is_sensitive": true
  }
}
```

### `shell_output`

Streaming stdout line from a running shell command.

```json
{
  "type": "shell_output",
  "payload": {
    "line": "Cloning into repository...",
    "thread_id": "8558d1f1-..."
  }
}
```

### `transcript_update`

Live STT transcription update.

```json
{
  "type": "transcript_update",
  "payload": {
    "text": "open firefox and",
    "is_final": false
  }
}
```

### `memories_response`

Returns the list of long-term memories retrieved from the database.

```json
{
  "type": "memories_response",
  "payload": {
    "memories": [
      {
        "content": "User prefers using Chrome over Firefox.",
        "source": "self_review",
        "timestamp": 1785331365,
        "importance": 0.8
      }
    ]
  }
}
```

### `graph_node_status`

Sent when a LangGraph node transitions (runs or completes).

```json
{
  "type": "graph_node_status",
  "payload": {
    "node": "PLAN",
    "status": "running",
    "thread_id": "8558d1f1-..."
  }
}
```

---

## Android-Specific Messages

| Type | Direction | Purpose |
|------|-----------|---------|
| `manual_voice_trigger` | Client→Server | User tapped mic — start STT |
| `speak_text` | Server→Client | Speak text via Android TextToSpeech |
| `stop_speech` | Client→Server | Stop TTS immediately |
| `voice_state` | Server→Client | `listening` / `speaking` / `idle` |
| `transcript_update` | Server→Client | Partial/final STT text |

---

## Tool Risk Levels

| Risk Level | Behavior |
|-----------|---------|
| `SAFE` | Executes without asking |
| `MODERATE` | Shows confirmation dialog; can be permanently granted |
| `HIGH` | Always requires explicit approval; cannot be permanently granted |

Permanent grants are cached in `permanentGrants` (Set) in `useWebSocket.ts`. On subsequent requests for the same tool, the frontend auto-approves without showing a dialog.
