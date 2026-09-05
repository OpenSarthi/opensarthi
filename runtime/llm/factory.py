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
        from pydantic_ai.models.google import GoogleModel
        return GoogleModel(model_name)
    elif provider == "anthropic":
        if api_key:
            os.environ["ANTHROPIC_API_KEY"] = api_key
        from pydantic_ai.models.anthropic import AnthropicModel
        return AnthropicModel(model_name)
    elif provider == "groq":
        if api_key:
            os.environ["GROQ_API_KEY"] = api_key
        from pydantic_ai.models.groq import GroqModel
        return GroqModel(model_name)
    elif provider in ("openai", "openrouter"):
        base_urls = {
            "openai": "https://api.openai.com/v1",
            "openrouter": "https://openrouter.ai/api/v1",
        }
        env_vars = {
            "openai": "OPENAI_API_KEY",
            "openrouter": "OPENROUTER_API_KEY",
        }
        if api_key:
            os.environ[env_vars[provider]] = api_key
        try:
            from pydantic_ai.models.openai import OpenAIChatModel as OpenAIModel
        except ImportError:
            from pydantic_ai.models.openai import OpenAIModel
        from pydantic_ai.providers.openai import OpenAIProvider
        return OpenAIModel(
            model_name=model_name,
            provider=OpenAIProvider(
                base_url=base_urls[provider],
                api_key=api_key or "noop",
            )
        )
    elif provider == "custom_openai":
        # OpenAI-compatible custom endpoint (vLLM, llama-server, Together AI, OmniRoute, etc.)
        try:
            from config import settings as _settings
            base_url = getattr(_settings, "custom_openai_base_url", None) or "http://127.0.0.1:8000/v1"
            effective_key = api_key or getattr(_settings, "custom_openai_api_key", None) or "noop"
        except Exception:
            base_url = "http://127.0.0.1:8000/v1"
            effective_key = api_key or "noop"
        try:
            from pydantic_ai.models.openai import OpenAIChatModel as OpenAIModel
        except ImportError:
            from pydantic_ai.models.openai import OpenAIModel
        from pydantic_ai.providers.openai import OpenAIProvider
        from pydantic_ai.settings import ModelSettings
        return OpenAIModel(
            model_name=model_name,
            provider=OpenAIProvider(
                base_url=base_url,
                api_key=effective_key,
            ),
            settings=ModelSettings(extra_body={"stream": False}),
        )
    raise ValueError(f"Unsupported AI provider: {provider}")



def model_supports_vision(model: Any) -> bool:
    """
    Heuristic: can this PydanticAI model instance consume inline image parts?

    Cloud multimodal providers (Google Gemini, Anthropic Claude, OpenAI GPT-4o,
    OpenRouter, Azure) accept data-URI images. Local Ollama text models such as
    qwen2.5-coder do not — however some deployments serve a vision model, so
    callers should ALSO fall back to text-only if the provider rejects images.
    """
    if model is None:
        return False
    name = model.__class__.__name__.lower()
    if "ollama" in name:
        return False
    return any(
        kind in name
        for kind in ("google", "anthropic", "openai", "azure", "groq", "mistral", "vertex")
    )


def screenshots_for_model(model: Any) -> bool:
    """Whether the planner should attach a screenshot for the given model."""
    try:
        from config import settings
        if not getattr(settings, "send_screenshots_to_llm", True):
            return False
    except Exception:
        pass
    return model_supports_vision(model)
