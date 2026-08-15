from typing import Optional
from tools.base import BaseTool
from tools.desktop import ClickTool, TypeTextTool, PressKeyTool, OpenAppTool, ClickElementTool, FocusWindowTool, ObserveDesktopTool
from tools.system import ShellTool
from tools.wait_tools import WaitForWindowTool, WaitForTextTool
from tools.media import MediaControlTool
from tools.memory import RememberTool, RecallTool, ForgetMemoryTool
from tools.notes import SaveNoteTool, GetNotesTool
from tools.self_fix import SelfFixTool
from tools.settings_tool import UpdateSettingsTool
from tools.web_search import WebSearchTool
from tools.productivity import (
    WeatherTool,
    SetTimerTool,
    ListTimersTool,
    CancelTimerTool,
    ListFilesTool,
    OpenPathTool,
    ReadFileTool,
    VolumeControlTool,
    BatteryTool,
    NetworkControlTool,
)
from tools.google_tools import (
    calendar_read_tool,
    gmail_read_tool,
    calendar_search_tool,
    gmail_search_tool,
)
from tools.browser import (
    browser_go_to,
    browser_back,
    browser_forward,
    browser_reload,
    browser_get_url,
    browser_click,
    browser_type,
    browser_press,
    browser_scroll,
    browser_fill_form,
    browser_smart_click,
    browser_get_text,
    browser_screenshot,
    browser_new_tab,
    browser_close_tab,
    browser_switch_tab,
    browser_list_tabs,
    browser_close,
    browser_close_all,
)
from tools.music import (
    youtube_search_tool,
    youtube_control_tool,
    music_play_tool,
)
from tools.social import (
    twitter_post_tool,
    linkedin_post_tool,
    telegram_send_tool,
    whatsapp_send_tool,
    discord_send_tool,
    email_send_tool,
)
from tools.system_monitor import (
    system_status_tool,
    weather_report_tool,
    flight_finder_tool,
    reminder_set_tool,
    reminder_cancel_tool,
    monitor_control_tool,
    agent_shutdown_tool,
)

_registry: dict[str, BaseTool] = {}

def _register(*tools):
    for tool in tools:
        _registry[tool.name] = tool

# Register all tools
_register(
    # Desktop automation
    ClickTool(),
    TypeTextTool(),
    PressKeyTool(),
    OpenAppTool(),
    FocusWindowTool(),
    ClickElementTool(),
    ObserveDesktopTool(),
    # System
    ShellTool(),
    # Wait utilities
    WaitForWindowTool(),
    WaitForTextTool(),
    # Media
    MediaControlTool(),
    # Memory
    RememberTool(),
    RecallTool(),
    ForgetMemoryTool(),
    # Notes
    SaveNoteTool(),
    GetNotesTool(),
    # Self-improvement
    SelfFixTool(),
    # Conversational settings control
    UpdateSettingsTool(),
    # Productivity (Phase 3)
    WebSearchTool(),
    WeatherTool(),
    SetTimerTool(),
    ListTimersTool(),
    CancelTimerTool(),
    ListFilesTool(),
    OpenPathTool(),
    ReadFileTool(),
    VolumeControlTool(),
    BatteryTool(),
    NetworkControlTool(),
    # Google Integration (read-only OAuth)
    calendar_read_tool,
    gmail_read_tool,
    calendar_search_tool,
    gmail_search_tool,
    # Browser Automation (Playwright)
    browser_go_to,
    browser_back,
    browser_forward,
    browser_reload,
    browser_get_url,
    browser_click,
    browser_type,
    browser_press,
    browser_scroll,
    browser_fill_form,
    browser_smart_click,
    browser_get_text,
    browser_screenshot,
    browser_new_tab,
    browser_close_tab,
    browser_switch_tab,
    browser_list_tabs,
    browser_close,
    browser_close_all,
    # Music / YouTube
    youtube_search_tool,
    youtube_control_tool,
    music_play_tool,
    # Social Media
    twitter_post_tool,
    linkedin_post_tool,
    telegram_send_tool,
    whatsapp_send_tool,
    discord_send_tool,
    email_send_tool,
    # System Monitoring & Control
    system_status_tool,
    weather_report_tool,
    flight_finder_tool,
    reminder_set_tool,
    reminder_cancel_tool,
    monitor_control_tool,
    agent_shutdown_tool,
)


def get(name: str) -> Optional[BaseTool]:
    return _registry.get(name)

def all_tools() -> list[BaseTool]:
    return list(_registry.values())

def get_schemas() -> list[dict]:
    """Return JSON schema list for each tool — used for MCP and prompt injection."""
    return [
        {
            "name": t.name,
            "description": t.description,
            "schema": t.schema,
        }
        for t in _registry.values()
    ]

def validate_registry():
    """Boot-time sanity check — every tool must have a non-empty schema."""
    import structlog
    log = structlog.get_logger()
    warnings = []
    for name, tool in _registry.items():
        if not tool.schema:
            warnings.append(name)
    if warnings:
        log.warning("Tools missing schema (LLM may hallucinate args)", tools=warnings)
    else:
        log.info("Tool registry OK", count=len(_registry))

# Run validation at import time
validate_registry()
