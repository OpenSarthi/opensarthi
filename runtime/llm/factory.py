import os
from typing import Any

def build_model(provider: str, model_name: str, api_key: str | None = None) -> Any:
    """
    Factory: given provider name, model name, and optional api key,
    return a model instance compatible with pydantic_ai.
    """
    provider = provider.lower()
    if provider == "ollama":
        from pydantic_ai.models.ollama import OllamaModel
        return OllamaModel(model_name)
    elif provider == "google":
        if api_key:
            os.environ["GEMINI_API_KEY"] = api_key
        from pydantic_ai.models.gemini import GeminiModel
        return GeminiModel(model_name)
    elif provider == "anthropic":
        if api_key:
            os.environ["ANTHROPIC_API_KEY"] = api_key
        from pydantic_ai.models.anthropic import AnthropicModel
        return AnthropicModel(model_name)
    elif provider in ("groq", "openai", "openrouter"):
        base_urls = {
            "groq": "https://api.groq.com/openai/v1",
            "openai": "https://api.openai.com/v1",
            "openrouter": "https://openrouter.ai/api/v1",
        }
        env_vars = {
            "groq": "GROQ_API_KEY",
            "openai": "OPENAI_API_KEY",
            "openrouter": "OPENROUTER_API_KEY",
        }
        if api_key:
            os.environ[env_vars[provider]] = api_key
        from pydantic_ai.models.openai import OpenAIModel
        from pydantic_ai.providers.openai import OpenAIProvider
        return OpenAIModel(
            model_name=model_name,
            provider=OpenAIProvider(
                base_url=base_urls[provider],
                api_key=api_key or "noop",
            )
        )
    raise ValueError(f"Unsupported AI provider: {provider}")
