from pathlib import Path
import os
import platform
from pydantic_settings import BaseSettings, SettingsConfigDict

# Define standard writable user config directories (platform-aware)
LOCAL_DEV_ENV = os.path.join(os.path.dirname(__file__), ".env")

if platform.system() == "Windows":
    USER_CONFIG_DIR = Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData" / "Local")) / "opensarthi"
else:
    USER_CONFIG_DIR = Path.home() / ".config" / "opensarthi"

USER_CONFIG_ENV = USER_CONFIG_DIR / ".env"

# Ensure the config folder exists
USER_CONFIG_DIR.mkdir(parents=True, exist_ok=True)

# Select env file to load: USER_CONFIG_ENV if it exists, otherwise fall back to local dev .env if present
env_file_path = str(USER_CONFIG_ENV) if USER_CONFIG_ENV.exists() else (LOCAL_DEV_ENV if os.path.exists(LOCAL_DEV_ENV) else str(USER_CONFIG_ENV))

class Settings(BaseSettings):
    app_name: str = "OpenSarthi"
    wake_words: list[str] = ["hey sarthi", "hello sarthi"]
    wake_word_enabled: bool = True
    wake_word_threshold: float = 0.5
    local_model: str = "qwen2.5-coder:3b"
    cloud_model: str = "gemini-2.5-flash"
    
    # AI provider selection
    ai_provider: str = "google"  # local_llm, ollama, google, openai, anthropic, groq, openrouter
    
    # API keys (generic per-provider storage)
    gemini_api_key: str | None = None
    openai_api_key: str | None = None
    anthropic_api_key: str | None = None
    groq_api_key: str | None = None
    openrouter_api_key: str | None = None
    
    voice_accent: str = "ie"
    voice_speed: float = 1.35
    continuous_listening: bool = False
    active_theme: str = "theme-red-black"
    
    model_config = SettingsConfigDict(env_file=env_file_path)

settings = Settings()

def save_settings_to_env(
    local_model: str,
    cloud_model: str,
    ai_provider: str,
    gemini_api_key: str | None,
    openai_api_key: str | None,
    anthropic_api_key: str | None,
    groq_api_key: str | None,
    openrouter_api_key: str | None,
    voice_accent: str,
    voice_speed: float,
    continuous_listening: bool,
    active_theme: str,
    wake_words: list[str],
    wake_word_enabled: bool,
    wake_word_threshold: float
):
    import json
    # Always write to the writable user's home configuration directory (safe for read-only AppImage filesystems!)
    with open(USER_CONFIG_ENV, "w") as f:
        f.write(f"LOCAL_MODEL={local_model}\n")
        f.write(f"CLOUD_MODEL={cloud_model}\n")
        f.write(f"AI_PROVIDER={ai_provider}\n")
        if gemini_api_key:
            f.write(f"GEMINI_API_KEY={gemini_api_key}\n")
        if openai_api_key:
            f.write(f"OPENAI_API_KEY={openai_api_key}\n")
        if anthropic_api_key:
            f.write(f"ANTHROPIC_API_KEY={anthropic_api_key}\n")
        if groq_api_key:
            f.write(f"GROQ_API_KEY={groq_api_key}\n")
        if openrouter_api_key:
            f.write(f"OPENROUTER_API_KEY={openrouter_api_key}\n")
        f.write(f"VOICE_ACCENT={voice_accent}\n")
        f.write(f"VOICE_SPEED={voice_speed}\n")
        f.write(f"CONTINUOUS_LISTENING={'True' if continuous_listening else 'False'}\n")
        f.write(f"ACTIVE_THEME={active_theme}\n")
        f.write(f"WAKE_WORDS={json.dumps(wake_words)}\n")
        f.write(f"WAKE_WORD_ENABLED={'True' if wake_word_enabled else 'False'}\n")
        f.write(f"WAKE_WORD_THRESHOLD={wake_word_threshold}\n")

def get_active_api_key() -> str | None:
    """Returns the API key for the currently active provider."""
    provider = settings.ai_provider.lower()
    if provider == "google":
        return settings.gemini_api_key
    elif provider == "openai":
        return settings.openai_api_key
    elif provider == "anthropic":
        return settings.anthropic_api_key
    elif provider == "groq":
        return settings.groq_api_key
    elif provider == "openrouter":
        return settings.openrouter_api_key
    return None
