"""
tools/settings_tool.py — Conversational Settings Control for OpenSarthi.

Allows the AI to update any assistant setting (theme, model, provider,
API keys, voice settings, wake words, etc.) by tool call — triggered
via natural language voice/text commands.

Risk levels:
  - API key updates → MODERATE (permission dialog pops up for sensitive data)
  - All other settings → SAFE (no confirmation needed)

After saving, emits settings_sync back to the frontend so the UI updates live.
"""
from __future__ import annotations
from typing import Any, Optional
from tools.base import BaseTool, RiskLevel, ToolDomain
from planner.schemas import ToolResult


class UpdateSettingsTool(BaseTool):
    name = "update_settings"
    description = (
        "Update one or more OpenSarthi assistant settings. "
        "Use this when the user asks to change theme, model, provider, API key, "
        "voice speed, wake words, accent, language, continuous listening, or any other setting."
    )
    risk_level = RiskLevel.SAFE  # overridden per-field at runtime
    domain = ToolDomain.GENERAL

    schema = {
        "type": "object",
        "properties": {
            "theme": {
                "type": "string",
                "description": "UI colour theme",
                "enum": [
                    "theme-green-black",
                    "theme-red-black",
                    "theme-mono-dark",
                    "theme-purple-black",
                    "theme-blue-black",
                    "theme-light-sakura",
                    "theme-light-slate",
                    "theme-light-clean",
                    "theme-multicolor-dark",
                    "theme-multicolor-light",
                ],
            },
            "provider": {
                "type": "string",
                "description": "AI provider to use",
                "enum": ["google", "openai", "anthropic", "groq", "openrouter", "ollama"],
            },
            "cloud_model": {
                "type": "string",
                "description": "Cloud model name (e.g. gemini-2.5-flash, gpt-4o, claude-opus-4-5)",
            },
            "local_model": {
                "type": "string",
                "description": "Local ollama model name (e.g. qwen2.5-coder:3b, llama3.2)",
            },
            "gemini_api_key": {
                "type": "string",
                "description": "Google Gemini API key (sensitive — will prompt for permission)",
            },
            "openai_api_key": {
                "type": "string",
                "description": "OpenAI API key (sensitive — will prompt for permission)",
            },
            "anthropic_api_key": {
                "type": "string",
                "description": "Anthropic API key (sensitive — will prompt for permission)",
            },
            "groq_api_key": {
                "type": "string",
                "description": "Groq API key (sensitive — will prompt for permission)",
            },
            "openrouter_api_key": {
                "type": "string",
                "description": "OpenRouter API key (sensitive — will prompt for permission)",
            },
            "voice_accent": {
                "type": "string",
                "description": "TTS voice accent/language code",
                "enum": ["ie", "com", "co.uk", "co.in", "com.au", "ca", "fr", "es", "de", "hi", "ja", "pt"],
            },
            "voice_speed": {
                "type": "number",
                "description": "TTS playback speed multiplier (0.8 to 2.0)",
            },
            "continuous_listening": {
                "type": "boolean",
                "description": "Whether to keep mic active after each reply",
            },
            "wake_word_enabled": {
                "type": "boolean",
                "description": "Enable or disable wake word detection",
            },
            "wake_words": {
                "type": "array",
                "items": {"type": "string"},
                "description": "List of wake word phrases (e.g. ['hey sarthi', 'ok sarthi'])",
            },
            "wake_word_threshold": {
                "type": "number",
                "description": "Wake word sensitivity 0.1 (most sensitive) to 0.9 (least sensitive)",
            },
            "user_name": {
                "type": "string",
                "description": "User name for personalised greetings",
            },
            "user_skills": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Active skill modules e.g. ['general', 'desktop_automation', 'developer']",
            },
            "custom_prompt": {
                "type": "string",
                "description": "Custom instructions to inject into every agent system prompt",
            },
            "use_supervisor": {
                "type": "boolean",
                "description": "Enable or disable the multi-agent supervisor (domain-based tool routing).",
            },
        },
        "required": [],
    }

    # Fields that contain sensitive data (require MODERATE permission dialog)
    _SENSITIVE_FIELDS = {
        "gemini_api_key",
        "openai_api_key",
        "anthropic_api_key",
        "groq_api_key",
        "openrouter_api_key",
    }

    async def execute(self, args: dict, permission_manager=None) -> ToolResult:
        """Apply each provided setting field, persist, and broadcast settings_sync."""
        from config import settings, save_settings_to_env
        import os

        if not args:
            return ToolResult.fail("No settings fields provided.", retryable=False)

        valid_fields = set(self.schema["properties"].keys())
        updates = {k: v for k, v in args.items() if k in valid_fields and v is not None}
        if not updates:
            return ToolResult.fail("No valid settings fields provided.", retryable=False)

        # Ask permission once for sensitive API key fields
        sensitive_updates = {k: v for k, v in updates.items() if k in self._SENSITIVE_FIELDS}
        if sensitive_updates and permission_manager:
            masked = {
                k: f"...{str(v)[-4:]}" if len(str(v)) > 4 else "****"
                for k, v in sensitive_updates.items()
            }
            approved = await permission_manager.request_permission(
                self.name,
                {"action": "update_api_keys", "fields": masked},
            )
            if not approved:
                return ToolResult.fail("User denied permission to update API key(s).", retryable=False)

        changed = []

        def _set_key(field: str, env_var: str):
            val = updates.get(field)
            if val and str(val).strip():
                setattr(settings, field, str(val).strip())
                os.environ[env_var] = str(val).strip()
                changed.append(field)

        # ── Apply all settings fields ──────────────────────────────────────

        # Personalization FIRST (fixes ordering bug §19.4)
        if "user_name" in updates:
            settings.user_name = str(updates["user_name"])
            changed.append("user_name")

        if "user_skills" in updates:
            raw = updates["user_skills"]
            if isinstance(raw, list):
                settings.user_skills = [str(s).strip() for s in raw if str(s).strip()]
            elif isinstance(raw, str):
                import json as _json
                try:
                    settings.user_skills = _json.loads(raw)
                except Exception:
                    settings.user_skills = [s.strip() for s in raw.split(",") if s.strip()]
            changed.append("user_skills")

        if "custom_prompt" in updates:
            settings.custom_prompt = str(updates["custom_prompt"])
            changed.append("custom_prompt")

        # Supervisor toggle
        if "use_supervisor" in updates:
            settings.use_supervisor = bool(updates["use_supervisor"])
            changed.append("use_supervisor")

        # Model / provider
        if "provider" in updates:
            settings.ai_provider = str(updates["provider"])
            changed.append("provider")
        if "cloud_model" in updates:
            settings.cloud_model = str(updates["cloud_model"])
            changed.append("cloud_model")
        if "local_model" in updates:
            settings.local_model = str(updates["local_model"])
            changed.append("local_model")

        # API keys
        _set_key("gemini_api_key", "GEMINI_API_KEY")
        _set_key("openai_api_key", "OPENAI_API_KEY")
        _set_key("anthropic_api_key", "ANTHROPIC_API_KEY")
        _set_key("groq_api_key", "GROQ_API_KEY")
        _set_key("openrouter_api_key", "OPENROUTER_API_KEY")

        # Voice settings
        if "voice_accent" in updates:
            settings.voice_accent = str(updates["voice_accent"])
            changed.append("voice_accent")
        if "voice_speed" in updates:
            try:
                speed = float(updates["voice_speed"])
                settings.voice_speed = max(0.5, min(3.0, speed))
                changed.append("voice_speed")
            except (TypeError, ValueError):
                pass
        if "continuous_listening" in updates:
            settings.continuous_listening = bool(updates["continuous_listening"])
            changed.append("continuous_listening")

        # Wake word
        if "wake_word_enabled" in updates:
            settings.wake_word_enabled = bool(updates["wake_word_enabled"])
            changed.append("wake_word_enabled")
        if "wake_words" in updates:
            raw = updates["wake_words"]
            if isinstance(raw, list):
                settings.wake_words = [str(w).strip() for w in raw if str(w).strip()]
            elif isinstance(raw, str):
                settings.wake_words = [w.strip() for w in raw.split(",") if w.strip()]
            changed.append("wake_words")
        if "wake_word_threshold" in updates:
            try:
                thr = float(updates["wake_word_threshold"])
                settings.wake_word_threshold = max(0.1, min(0.9, thr))
                changed.append("wake_word_threshold")
            except (TypeError, ValueError):
                pass

        # Theme
        if "theme" in updates:
            settings.active_theme = str(updates["theme"])
            changed.append("theme")

        if not changed:
            return ToolResult.fail("No settings were changed (invalid or empty values).", retryable=False)

        # ── Persist to .env ──────────────────────────────────────────────────
        save_settings_to_env(
            settings.local_model,
            settings.cloud_model,
            settings.ai_provider,
            settings.gemini_api_key,
            settings.openai_api_key,
            settings.anthropic_api_key,
            settings.groq_api_key,
            settings.openrouter_api_key,
            settings.voice_accent,
            settings.voice_speed,
            settings.continuous_listening,
            settings.active_theme,
            settings.wake_words,
            settings.wake_word_enabled,
            settings.wake_word_threshold,
            settings.user_name,
            settings.user_skills,
            settings.custom_prompt,
            use_langgraph=settings.use_langgraph,
            use_supervisor=settings.use_supervisor,
        )

        # ── Propagate wake word changes to live pipeline ──────────────────
        # permission_manager is a WSWrapper; the real ws_handler is accessible via _ws attr
        ws_root = getattr(permission_manager, "_ws", permission_manager) if permission_manager else None
        if ws_root and hasattr(ws_root, "voice_pipeline") and ws_root.voice_pipeline:
            try:
                if (
                    hasattr(ws_root.voice_pipeline, "wake_detector")
                    and ws_root.voice_pipeline.wake_detector
                ):
                    ws_root.voice_pipeline.wake_detector.update_phrases(settings.wake_words)
                    ws_root.voice_pipeline.wake_detector.threshold = settings.wake_word_threshold
            except Exception:
                pass  # non-fatal

        # ── Broadcast settings_sync to frontend ──────────────────────────
        if ws_root and hasattr(ws_root, "send_message"):
            try:
                await ws_root.send_message("settings_sync", {
                    "local_model": settings.local_model,
                    "cloud_model": settings.cloud_model,
                    "ai_provider": settings.ai_provider,
                    "gemini_api_key": settings.gemini_api_key or "",
                    "openai_api_key": settings.openai_api_key or "",
                    "anthropic_api_key": settings.anthropic_api_key or "",
                    "groq_api_key": settings.groq_api_key or "",
                    "openrouter_api_key": settings.openrouter_api_key or "",
                    "voice_accent": settings.voice_accent,
                    "voice_speed": settings.voice_speed,
                    "continuous_listening": settings.continuous_listening,
                    "active_theme": settings.active_theme,
                    "wake_words": settings.wake_words,
                    "wake_word_enabled": settings.wake_word_enabled,
                    "wake_word_threshold": settings.wake_word_threshold,
                    "user_name": settings.user_name,
                    "user_skills": settings.user_skills,
                    "custom_prompt": settings.custom_prompt,
                    "long_term_memory_enabled": settings.long_term_memory_enabled,
                    "use_langgraph": settings.use_langgraph,
                    "use_supervisor": settings.use_supervisor,
                })
            except Exception:
                pass  # non-fatal

        change_list = ", ".join(changed)
        return ToolResult(
            success=True,
            observation=f"Settings updated: {change_list}.",
        )
