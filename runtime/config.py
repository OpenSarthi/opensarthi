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
    cloud_model: str = "gemini-3.6-flash"
    
    # AI provider selection
    ai_provider: str = "google"  # local_llm, ollama, google, openai, anthropic, groq, openrouter, custom_openai
    
    # API keys (generic per-provider storage)
    gemini_api_key: str | None = None
    openai_api_key: str | None = None
    anthropic_api_key: str | None = None
    groq_api_key: str | None = None
    openrouter_api_key: str | None = None
    
    # Custom OpenAI-compatible endpoint
    custom_openai_base_url: str | None = None
    custom_openai_api_key: str | None = None
    custom_openai_provider_name: str | None = None
    
    voice_accent: str = "ie"  # Legacy gTTS fallback TLD — use voice_persona instead
    voice_persona: str = "JARVIS"  # Active voice persona ID (JARVIS/NOVA/ATLAS/ARIA/LUNA/SARTHI)
    voice_speed: float = 1.35
    continuous_listening: bool = False
    active_theme: str = "theme-green-black"

    # User personalization
    user_name: str = ""
    user_skills: list[str] = ["general", "desktop_automation", "developer", "home_user"]
    custom_prompt: str = ""
    long_term_memory_enabled: bool = False
    use_langgraph: bool = True
    use_supervisor: bool = True
    use_native_voice: bool = False

    # Multimodal screen context: send the desktop screenshot to the planner LLM.
    # Currently gated to vision-capable cloud providers (Google/Anthropic/OpenAI/OpenRouter/Groq).
    # Local Ollama text models stay text-only (an unsupported-image provider error
    # triggers the text-only fallback regardless).
    send_screenshots_to_llm: bool = True

    # Native Audio Pipeline (Mark-L speed feature)
    native_audio_pipeline: str = "auto"  # "auto" | "gemini-live" | "openai-realtime" | "offline"

    # Session Memory (Mark-L style: consumed after use)
    session_memory_enabled: bool = True
    session_memory_turns: int = 40  # turns to summarize
    session_memory_model: str = "gemini-2.5-flash"  # fast model for summarization

    # Sound (stored in localStorage on frontend; backend receives via update_settings)
    sound_enabled: bool = True
    sound_volume: int = 60

    # Social Media & Messaging credentials
    twitter_api_key: str | None = None
    twitter_api_secret: str | None = None
    twitter_access_token: str | None = None
    twitter_access_token_secret: str | None = None
    telegram_bot_token: str | None = None
    telegram_chat_id: str | None = None
    discord_webhook_url: str | None = None
    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_user: str | None = None
    smtp_password: str | None = None
    linkedin_access_token: str | None = None

    # Google OAuth (read-only)
    google_oauth_enabled: bool = False
    google_client_id: str | None = None
    google_client_secret: str | None = None
    google_redirect_uri: str = "http://localhost:8765/oauth2callback"
    google_scopes: list[str] = ["https://www.googleapis.com/auth/calendar.readonly", "https://www.googleapis.com/auth/gmail.readonly"]

    # Parallel Search
    parallel_search_enabled: bool = True
    search_engines: list[str] = ["duckduckgo", "gemini", "brave"]

    # Background Monitoring
    background_monitoring_enabled: bool = False
    monitoring_interval_minutes: int = 30
    proactive_enabled: bool = False
    proactive_cooldown_minutes: int = 20

    # Remote control dashboard settings
    remote_dashboard_enabled: bool = False

    model_config = SettingsConfigDict(env_file=env_file_path)

settings = Settings()

def save_settings_to_env(
    local_model: str = None,
    cloud_model: str = None,
    ai_provider: str = None,
    gemini_api_key: str | None = None,
    openai_api_key: str | None = None,
    anthropic_api_key: str | None = None,
    groq_api_key: str | None = None,
    openrouter_api_key: str | None = None,
    voice_accent: str = None,
    voice_persona: str = None,
    voice_speed: float = None,
    continuous_listening: bool = None,
    active_theme: str = None,
    wake_words: list[str] = None,
    wake_word_enabled: bool = None,
    wake_word_threshold: float = None,
    user_name: str = None,
    user_skills: list[str] = None,
    custom_prompt: str = None,
    long_term_memory_enabled: bool = None,
    remote_dashboard_enabled: bool = None,
    native_audio_pipeline: str = None,
    session_memory_enabled: bool = None,
    session_memory_turns: int = None,
    session_memory_model: str = None,
    sound_enabled: bool = None,
    sound_volume: int = None,
    google_oauth_enabled: bool = None,
    google_client_id: str | None = None,
    google_client_secret: str | None = None,
    parallel_search_enabled: bool = None,
    search_engines: list[str] = None,
    background_monitoring_enabled: bool = None,
    monitoring_interval_minutes: int = None,
    proactive_enabled: bool = None,
    proactive_cooldown_minutes: int = None,
    use_langgraph: bool = None,
    use_supervisor: bool = None,
    use_native_voice: bool = None,
    custom_openai_base_url: str | None = None,
    custom_openai_api_key: str | None = None,
    custom_openai_provider_name: str | None = None,
    twitter_api_key: str | None = None,
    twitter_api_secret: str | None = None,
    twitter_access_token: str | None = None,
    twitter_access_token_secret: str | None = None,
    telegram_bot_token: str | None = None,
    telegram_chat_id: str | None = None,
    discord_webhook_url: str | None = None,
    smtp_host: str | None = None,
    smtp_port: int = None,
    smtp_user: str | None = None,
    smtp_password: str | None = None,
    linkedin_access_token: str | None = None,
):
    import json
    import os

    # Update in-memory settings instance
    if local_model is not None: settings.local_model = local_model
    if cloud_model is not None: settings.cloud_model = cloud_model
    if ai_provider is not None: settings.ai_provider = ai_provider
    if gemini_api_key is not None: settings.gemini_api_key = gemini_api_key
    if openai_api_key is not None: settings.openai_api_key = openai_api_key
    if anthropic_api_key is not None: settings.anthropic_api_key = anthropic_api_key
    if groq_api_key is not None: settings.groq_api_key = groq_api_key
    if openrouter_api_key is not None: settings.openrouter_api_key = openrouter_api_key
    if voice_accent is not None: settings.voice_accent = voice_accent
    if voice_persona is not None: settings.voice_persona = voice_persona
    if voice_speed is not None: settings.voice_speed = voice_speed
    if continuous_listening is not None: settings.continuous_listening = continuous_listening
    if active_theme is not None: settings.active_theme = active_theme
    if wake_words is not None: settings.wake_words = wake_words
    if wake_word_enabled is not None: settings.wake_word_enabled = wake_word_enabled
    if wake_word_threshold is not None: settings.wake_word_threshold = wake_word_threshold
    if user_name is not None: settings.user_name = user_name
    if user_skills is not None: settings.user_skills = user_skills
    if custom_prompt is not None: settings.custom_prompt = custom_prompt
    if long_term_memory_enabled is not None: settings.long_term_memory_enabled = long_term_memory_enabled
    if remote_dashboard_enabled is not None: settings.remote_dashboard_enabled = remote_dashboard_enabled
    if native_audio_pipeline is not None: settings.native_audio_pipeline = native_audio_pipeline
    if session_memory_enabled is not None: settings.session_memory_enabled = session_memory_enabled
    if session_memory_turns is not None: settings.session_memory_turns = session_memory_turns
    if session_memory_model is not None: settings.session_memory_model = session_memory_model
    if sound_enabled is not None: settings.sound_enabled = sound_enabled
    if sound_volume is not None: settings.sound_volume = sound_volume
    if google_oauth_enabled is not None: settings.google_oauth_enabled = google_oauth_enabled
    if google_client_id is not None:
        settings.google_client_id = google_client_id
        os.environ["GOOGLE_CLIENT_ID"] = google_client_id
    if google_client_secret is not None:
        settings.google_client_secret = google_client_secret
        os.environ["GOOGLE_CLIENT_SECRET"] = google_client_secret
    if parallel_search_enabled is not None: settings.parallel_search_enabled = parallel_search_enabled
    if search_engines is not None: settings.search_engines = search_engines
    if background_monitoring_enabled is not None: settings.background_monitoring_enabled = background_monitoring_enabled
    if monitoring_interval_minutes is not None: settings.monitoring_interval_minutes = monitoring_interval_minutes
    if proactive_enabled is not None: settings.proactive_enabled = proactive_enabled
    if proactive_cooldown_minutes is not None: settings.proactive_cooldown_minutes = proactive_cooldown_minutes
    if use_langgraph is not None: settings.use_langgraph = use_langgraph
    if use_supervisor is not None: settings.use_supervisor = use_supervisor
    if use_native_voice is not None: settings.use_native_voice = use_native_voice
    if custom_openai_base_url is not None: settings.custom_openai_base_url = custom_openai_base_url
    if custom_openai_api_key is not None: settings.custom_openai_api_key = custom_openai_api_key
    if custom_openai_provider_name is not None: settings.custom_openai_provider_name = custom_openai_provider_name
    if twitter_api_key is not None: settings.twitter_api_key = twitter_api_key
    if twitter_api_secret is not None: settings.twitter_api_secret = twitter_api_secret
    if twitter_access_token is not None: settings.twitter_access_token = twitter_access_token
    if twitter_access_token_secret is not None: settings.twitter_access_token_secret = twitter_access_token_secret
    if telegram_bot_token is not None: settings.telegram_bot_token = telegram_bot_token
    if telegram_chat_id is not None: settings.telegram_chat_id = telegram_chat_id
    if discord_webhook_url is not None: settings.discord_webhook_url = discord_webhook_url
    if smtp_host is not None: settings.smtp_host = smtp_host
    if smtp_port is not None: settings.smtp_port = smtp_port
    if smtp_user is not None: settings.smtp_user = smtp_user
    if smtp_password is not None: settings.smtp_password = smtp_password
    if linkedin_access_token is not None: settings.linkedin_access_token = linkedin_access_token

    USER_CONFIG_ENV.parent.mkdir(parents=True, exist_ok=True)
    with open(USER_CONFIG_ENV, "w") as f:
        f.write(f"LOCAL_MODEL={settings.local_model}\n")
        f.write(f"CLOUD_MODEL={settings.cloud_model}\n")
        f.write(f"AI_PROVIDER={settings.ai_provider}\n")
        if settings.gemini_api_key:
            f.write(f"GEMINI_API_KEY={settings.gemini_api_key}\n")
        if settings.openai_api_key:
            f.write(f"OPENAI_API_KEY={settings.openai_api_key}\n")
        if settings.anthropic_api_key:
            f.write(f"ANTHROPIC_API_KEY={settings.anthropic_api_key}\n")
        if settings.groq_api_key:
            f.write(f"GROQ_API_KEY={settings.groq_api_key}\n")
        if settings.openrouter_api_key:
            f.write(f"OPENROUTER_API_KEY={settings.openrouter_api_key}\n")
        f.write(f"VOICE_ACCENT={settings.voice_accent}\n")
        f.write(f"VOICE_PERSONA={getattr(settings, 'voice_persona', 'JARVIS')}\n")
        f.write(f"VOICE_SPEED={settings.voice_speed}\n")
        f.write(f"CONTINUOUS_LISTENING={'True' if settings.continuous_listening else 'False'}\n")
        f.write(f"ACTIVE_THEME={settings.active_theme}\n")
        f.write(f"WAKE_WORDS={json.dumps(settings.wake_words)}\n")
        f.write(f"WAKE_WORD_ENABLED={'True' if settings.wake_word_enabled else 'False'}\n")
        f.write(f"WAKE_WORD_THRESHOLD={settings.wake_word_threshold}\n")
        f.write(f"LONG_TERM_MEMORY_ENABLED={'True' if settings.long_term_memory_enabled else 'False'}\n")
        f.write(f"REMOTE_DASHBOARD_ENABLED={'True' if settings.remote_dashboard_enabled else 'False'}\n")
        f.write(f"NATIVE_AUDIO_PIPELINE={settings.native_audio_pipeline}\n")
        f.write(f"SESSION_MEMORY_ENABLED={'True' if settings.session_memory_enabled else 'False'}\n")
        f.write(f"SESSION_MEMORY_TURNS={settings.session_memory_turns}\n")
        f.write(f"SESSION_MEMORY_MODEL={settings.session_memory_model}\n")
        f.write(f"SOUND_ENABLED={'True' if settings.sound_enabled else 'False'}\n")
        f.write(f"SOUND_VOLUME={settings.sound_volume}\n")
        f.write(f"GOOGLE_OAUTH_ENABLED={'True' if settings.google_oauth_enabled else 'False'}\n")
        if settings.google_client_id:
            f.write(f"GOOGLE_CLIENT_ID={settings.google_client_id}\n")
        if settings.google_client_secret:
            f.write(f"GOOGLE_CLIENT_SECRET={settings.google_client_secret}\n")
        f.write(f"PARALLEL_SEARCH_ENABLED={'True' if settings.parallel_search_enabled else 'False'}\n")
        if settings.search_engines:
            f.write(f"SEARCH_ENGINES={json.dumps(settings.search_engines)}\n")
        f.write(f"BACKGROUND_MONITORING_ENABLED={'True' if settings.background_monitoring_enabled else 'False'}\n")
        f.write(f"MONITORING_INTERVAL_MINUTES={settings.monitoring_interval_minutes}\n")
        f.write(f"PROACTIVE_ENABLED={'True' if settings.proactive_enabled else 'False'}\n")
        f.write(f"PROACTIVE_COOLDOWN_MINUTES={settings.proactive_cooldown_minutes}\n")
        f.write(f"USE_LANGGRAPH={'True' if settings.use_langgraph else 'False'}\n")
        f.write(f"USE_SUPERVISOR={'True' if settings.use_supervisor else 'False'}\n")
        f.write(f"USE_NATIVE_VOICE={'True' if settings.use_native_voice else 'False'}\n")
        if settings.custom_openai_base_url:
            f.write(f"CUSTOM_OPENAI_BASE_URL={settings.custom_openai_base_url}\n")
        if settings.custom_openai_api_key:
            f.write(f"CUSTOM_OPENAI_API_KEY={settings.custom_openai_api_key}\n")
        if settings.custom_openai_provider_name:
            f.write(f"CUSTOM_OPENAI_PROVIDER_NAME={settings.custom_openai_provider_name}\n")
        # Social media credentials
        if settings.twitter_api_key:
            f.write(f"TWITTER_API_KEY={settings.twitter_api_key}\n")
        if settings.twitter_api_secret:
            f.write(f"TWITTER_API_SECRET={settings.twitter_api_secret}\n")
        if settings.twitter_access_token:
            f.write(f"TWITTER_ACCESS_TOKEN={settings.twitter_access_token}\n")
        if settings.twitter_access_token_secret:
            f.write(f"TWITTER_ACCESS_TOKEN_SECRET={settings.twitter_access_token_secret}\n")
        if settings.telegram_bot_token:
            f.write(f"TELEGRAM_BOT_TOKEN={settings.telegram_bot_token}\n")
        if settings.telegram_chat_id:
            f.write(f"TELEGRAM_CHAT_ID={settings.telegram_chat_id}\n")
        if settings.discord_webhook_url:
            f.write(f"DISCORD_WEBHOOK_URL={settings.discord_webhook_url}\n")
        if settings.smtp_host:
            f.write(f"SMTP_HOST={settings.smtp_host}\n")
        if settings.smtp_port and settings.smtp_port != 587:
            f.write(f"SMTP_PORT={settings.smtp_port}\n")
        if settings.smtp_user:
            f.write(f"SMTP_USER={settings.smtp_user}\n")
        if settings.smtp_password:
            f.write(f"SMTP_PASSWORD={settings.smtp_password}\n")
        if settings.linkedin_access_token:
            f.write(f"LINKEDIN_ACCESS_TOKEN={settings.linkedin_access_token}\n")
        if settings.user_name:
            f.write(f"USER_NAME={settings.user_name}\n")
        if settings.user_skills:
            f.write(f"USER_SKILLS={json.dumps(settings.user_skills)}\n")
        if settings.custom_prompt:
            f.write(f"CUSTOM_PROMPT={settings.custom_prompt}\n")

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
    elif provider == "custom_openai":
        return settings.custom_openai_api_key
    return None
