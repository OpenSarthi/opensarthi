from pydantic import BaseModel, ConfigDict
from pydantic_ai import Agent, RunContext
from pydantic_ai.models.ollama import OllamaModel
from pydantic_ai.models.openai import OpenAIModel
from httpx import AsyncClient
import os
from typing import Any

os.environ.setdefault("OLLAMA_BASE_URL", "http://localhost:11434")


from pydantic_ai.providers.openai import OpenAIProvider
from config import settings
from tools.desktop import DesktopTools
from tools.system import SystemTools

# Configure LLMs
from pydantic_ai.models.ollama import OllamaModel
local_llm = OllamaModel(settings.local_model)

cloud_llm = local_llm

class AgentDependencies(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True)

    desktop: DesktopTools
    system: SystemTools
    require_cloud: bool = False
    log_action: Any = None

agent = Agent(
    model=local_llm,
    deps_type=AgentDependencies,
    system_prompt=(
        "You are OpenSarthi, an AI desktop agent for Linux. "
        "You control the user's computer to assist them. "
        "Break down tasks into safe, atomic tool calls. "
        "IMPORTANT RULES:\n"
        "1. When chatting directly to the user (conversational), respond normally with plain text.\n"
        "2. To TYPE into another application (like Slack, Chrome), you MUST use the `type_text` tool.\n"
        "3. To press keys like Enter, Return, Tab, etc., use the `press_key` tool.\n"
        "4. When opening an app like 'slack' or 'google-chrome', use `run_shell_command` with an ampersand (e.g. 'slack &') so it doesn't block.\n"
        "5. If a page or application is loading, use `wait_seconds` to pause execution, then use `take_screenshot` to check the progress. Repeat this in a loop if necessary until the loading completes.\n"
        "6. NEVER hallucinate or call any tools that have not been explicitly provided to you (e.g., do NOT attempt to use 'brave_search', 'web_search', etc.). If you don't know the answer, just say you don't know or use run_shell_command to search."
    ),
)

@agent.tool
async def wait_seconds(ctx: RunContext[AgentDependencies], seconds: int) -> str:
    """Pauses execution for a specified number of seconds (useful when waiting for pages or apps to load)."""
    import asyncio
    if ctx.deps.log_action: await ctx.deps.log_action("wait_seconds", f"Waiting for {seconds} seconds...", "running")
    await asyncio.sleep(seconds)
    if ctx.deps.log_action: await ctx.deps.log_action("wait_seconds", f"Finished waiting.", "success")
    return f"Waited for {seconds} seconds."

@agent.tool
async def take_screenshot(ctx: RunContext[AgentDependencies]) -> str:
    """Takes a screenshot of the primary monitor and returns its file path."""
    if ctx.deps.log_action: await ctx.deps.log_action("take_screenshot", "Capturing screen...", "running")
    res = await ctx.deps.desktop.capture_screen()
    if ctx.deps.log_action: await ctx.deps.log_action("take_screenshot", "Screen captured.", "success", result=res)
    return res

@agent.tool
async def type_text(ctx: RunContext[AgentDependencies], text: str) -> bool:
    """Types the given text into the currently focused window."""
    if ctx.deps.log_action: await ctx.deps.log_action("type_text", f"Typing: {text}", "running")
    res = await ctx.deps.desktop.type_text(text)
    if ctx.deps.log_action: await ctx.deps.log_action("type_text", f"Typed: {text}", "success")
    return res

@agent.tool
async def press_key(ctx: RunContext[AgentDependencies], key: str) -> bool:
    """Presses a specific keyboard key (e.g., 'Return', 'Enter', 'Tab', 'Escape')."""
    if ctx.deps.log_action: await ctx.deps.log_action("press_key", f"Pressing key: {key}", "running")
    res = await ctx.deps.desktop.press_key(key)
    if ctx.deps.log_action: await ctx.deps.log_action("press_key", f"Pressed key: {key}", "success")
    return res

@agent.tool
async def run_shell_command(ctx: RunContext[AgentDependencies], command: str) -> str:
    """Runs a shell command in a sandboxed environment."""
    if ctx.deps.log_action: await ctx.deps.log_action("run_shell_command", f"Running: {command}", "running")
    res = await ctx.deps.system.run_command(command)
    if ctx.deps.log_action: await ctx.deps.log_action("run_shell_command", f"Executed: {command}", "success", result=res)
    return res
