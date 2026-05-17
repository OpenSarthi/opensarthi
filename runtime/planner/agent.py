from pydantic_ai import Agent, RunContext
from pydantic_ai.models.ollama import OllamaModel
from pydantic_ai.models.openai import OpenAIModel
from pydantic import BaseModel
from httpx import AsyncClient

from config import settings
from tools.desktop import DesktopTools
from tools.system import SystemTools

# Configure LLMs
local_llm = OllamaModel(
    model_name=settings.local_model,
    base_url="http://localhost:11434/api",
)

cloud_llm = OpenAIModel(
    model_name=settings.cloud_model,
    base_url="https://openrouter.ai/api/v1",
    api_key=settings.openrouter_api_key,
) if settings.openrouter_api_key else None

class AgentDependencies(BaseModel):
    desktop: DesktopTools
    system: SystemTools
    require_cloud: bool = False

agent = Agent(
    model=local_llm,
    deps_type=AgentDependencies,
    system_prompt=(
        "You are OpenSarthi, an AI desktop agent for Linux. "
        "You can control the user's computer to assist them. "
        "Break down tasks into safe, atomic tool calls. "
        "If a task is complex and you need better reasoning, request escalation."
    ),
)

@agent.tool
async def take_screenshot(ctx: RunContext[AgentDependencies]) -> str:
    """Takes a screenshot of the primary monitor and returns its file path."""
    return await ctx.deps.desktop.capture_screen()

@agent.tool
async def type_text(ctx: RunContext[AgentDependencies], text: str) -> bool:
    """Types the given text into the currently focused window."""
    return await ctx.deps.desktop.type_text(text)

@agent.tool
async def run_shell_command(ctx: RunContext[AgentDependencies], command: str) -> str:
    """Runs a shell command in a sandboxed environment."""
    return await ctx.deps.system.run_command(command)
