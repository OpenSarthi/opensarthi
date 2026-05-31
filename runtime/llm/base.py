from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any

@dataclass
class ModelInfo:
    provider: str
    model_name: str
    is_cloud: bool
    supports_vision: bool = False
    context_length: int = 128000

class LLMProvider(ABC):
    @abstractmethod
    def build_model(self, model_name: str, api_key: str | None) -> Any:
        """Return a pydantic_ai compatible model object."""
        pass
