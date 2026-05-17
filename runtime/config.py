from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    app_name: str = "OpenSarthi"
    wake_words: list[str] = ["hey sarthi", "hello sarthi"]
    local_model: str = "qwen2.5:3b"
    cloud_model: str = "deepseek/deepseek-chat"
    openrouter_api_key: str | None = None
    
    model_config = SettingsConfigDict(env_file=".env")

settings = Settings()
