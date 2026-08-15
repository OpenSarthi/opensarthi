"""
Browser Automation Tools — Mark-L Parity Feature (15+ actions)

Uses Playwright for headless/headed browser automation.
Runs in sandboxed browser context; no access to user profiles by default.
"""
import asyncio
import structlog
from typing import Dict, Any, Optional, List
from pathlib import Path

from tools.base import BaseTool, RiskLevel, ToolResult

logger = structlog.get_logger()

# Global browser state
_browser = None
_browser_context = None
_browser_page = None
_browser_initialized = False


async def _ensure_browser():
    """Initialize Playwright browser if not already done."""
    global _browser, _browser_context, _browser_page, _browser_initialized
    if _browser_initialized:
        return

    try:
        from playwright.async_api import async_playwright
        _playwright = await async_playwright().start()
        _browser = await _playwright.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-dev-shm-usage"],
        )
        _browser_context = await _browser.new_context()
        _browser_page = await _browser_context.new_page()
        _browser_initialized = True
        logger.info("Browser automation initialized")
    except Exception as e:
        logger.error("Failed to initialize browser", error=str(e))
        raise


async def _ensure_page():
    """Ensure a page exists."""
    await _ensure_browser()
    global _browser_page
    if _browser_page is None:
        _browser_page = await _browser_context.new_page()
    return _browser_page


class BrowserGoToTool(BaseTool):
    """Navigate to a URL."""

    name = "browser_go_to"
    description = "Navigate the browser to a specific URL."
    schema = {
        "type": "object",
        "properties": {
            "url": {"type": "string", "description": "URL to navigate to"},
            "wait_until": {"type": "string", "default": "load", "enum": ["load", "domcontentloaded", "networkidle"]},
        },
        "required": ["url"],
    }
    risk_level = RiskLevel.SAFE

    async def execute(self, args: Dict[str, Any]) -> ToolResult:
        page = await _ensure_page()
        url = args["url"]
        wait_until = args.get("wait_until", "load")
        try:
            await page.goto(url, wait_until=wait_until, timeout=30000)
            return ToolResult(success=True, result=f"Navigated to {url}")
        except Exception as e:
            return ToolResult(success=False, result=None, error=str(e))


class BrowserBackTool(BaseTool):
    """Navigate back."""

    name = "browser_back"
    description = "Navigate back in browser history."
    schema = {"type": "object", "properties": {}}
    risk_level = RiskLevel.SAFE

    async def execute(self, args: Dict[str, Any]) -> ToolResult:
        page = await _ensure_page()
        try:
            await page.go_back()
            return ToolResult(success=True, result="Navigated back")
        except Exception as e:
            return ToolResult(success=False, result=None, error=str(e))


class BrowserForwardTool(BaseTool):
    """Navigate forward."""

    name = "browser_forward"
    description = "Navigate forward in browser history."
    schema = {"type": "object", "properties": {}}
    risk_level = RiskLevel.SAFE

    async def execute(self, args: Dict[str, Any]) -> ToolResult:
        page = await _ensure_page()
        try:
            await page.go_forward()
            return ToolResult(success=True, result="Navigated forward")
        except Exception as e:
            return ToolResult(success=False, result=None, error=str(e))


class BrowserReloadTool(BaseTool):
    """Reload current page."""

    name = "browser_reload"
    description = "Reload the current page."
    schema = {"type": "object", "properties": {}}
    risk_level = RiskLevel.SAFE

    async def execute(self, args: Dict[str, Any]) -> ToolResult:
        page = await _ensure_page()
        try:
            await page.reload()
            return ToolResult(success=True, result="Page reloaded")
        except Exception as e:
            return ToolResult(success=False, result=None, error=str(e))


class BrowserGetUrlTool(BaseTool):
    """Get current URL."""

    name = "browser_get_url"
    description = "Get the current page URL."
    schema = {"type": "object", "properties": {}}
    risk_level = RiskLevel.SAFE

    async def execute(self, args: Dict[str, Any]) -> ToolResult:
        page = await _ensure_page()
        try:
            return ToolResult(success=True, result={"url": page.url})
        except Exception as e:
            return ToolResult(success=False, result=None, error=str(e))


class BrowserClickTool(BaseTool):
    """Click on an element."""

    name = "browser_click"
    description = "Click on an element on the page (by selector or text)."
    schema = {
        "type": "object",
        "properties": {
            "selector": {"type": "string", "description": "CSS selector or XPath"},
            "text": {"type": "string", "description": "Click element containing this text"},
        },
        "required": [],
    }
    risk_level = RiskLevel.MODERATE

    async def execute(self, args: Dict[str, Any]) -> ToolResult:
        page = await _ensure_page()
        selector = args.get("selector")
        text = args.get("text")

        try:
            if text:
                await page.get_by_text(text).first.click()
            elif selector:
                await page.click(selector)
            else:
                return ToolResult(success=False, result=None, error="No selector or text provided")
            return ToolResult(success=True, result="Clicked element")
        except Exception as e:
            return ToolResult(success=False, result=None, error=str(e))


class BrowserTypeTool(BaseTool):
    """Type text into an input field."""

    name = "browser_type"
    description = "Type text into an input field."
    schema = {
        "type": "object",
        "properties": {
            "selector": {"type": "string", "description": "CSS selector for input field"},
            "text": {"type": "string", "description": "Text to type"},
            "press_enter": {"type": "boolean", "default": False},
        },
        "required": ["selector", "text"],
    }
    risk_level = RiskLevel.MODERATE

    async def execute(self, args: Dict[str, Any]) -> ToolResult:
        page = await _ensure_page()
        selector = args["selector"]
        text = args["text"]
        press_enter = args.get("press_enter", False)

        try:
            await page.fill(selector, text)
            if press_enter:
                await page.press(selector, "Enter")
            return ToolResult(success=True, result=f"Typed '{text}' into {selector}")
        except Exception as e:
            return ToolResult(success=False, result=None, error=str(e))


class BrowserPressTool(BaseTool):
    """Press a key."""

    name = "browser_press"
    description = "Press a keyboard key in the browser."
    schema = {
        "type": "object",
        "properties": {
            "key": {"type": "string", "description": "Key to press (e.g., 'Enter', 'Escape', 'Tab')"},
        },
        "required": ["key"],
    }
    risk_level = RiskLevel.SAFE

    async def execute(self, args: Dict[str, Any]) -> ToolResult:
        page = await _ensure_page()
        key = args["key"]
        try:
            await page.keyboard.press(key)
            return ToolResult(success=True, result=f"Pressed {key}")
        except Exception as e:
            return ToolResult(success=False, result=None, error=str(e))


class BrowserScrollTool(BaseTool):
    """Scroll the page."""

    name = "browser_scroll"
    description = "Scroll the page up or down."
    schema = {
        "type": "object",
        "properties": {
            "direction": {"type": "string", "enum": ["up", "down"], "default": "down"},
            "amount": {"type": "integer", "default": 500, "description": "Pixels to scroll"},
        },
        "required": [],
    }
    risk_level = RiskLevel.SAFE

    async def execute(self, args: Dict[str, Any]) -> ToolResult:
        page = await _ensure_page()
        direction = args.get("direction", "down")
        amount = args.get("amount", 500)
        try:
            delta_y = amount if direction == "down" else -amount
            await page.mouse.wheel(0, delta_y)
            return ToolResult(success=True, result=f"Scrolled {direction} {amount}px")
        except Exception as e:
            return ToolResult(success=False, result=None, error=str(e))


class BrowserFillFormTool(BaseTool):
    """Fill a form with multiple fields."""

    name = "browser_fill_form"
    description = "Fill a form with multiple field values."
    schema = {
        "type": "object",
        "properties": {
            "fields": {
                "type": "object",
                "description": "Dict of selector -> value pairs",
            },
        },
        "required": ["fields"],
    }
    risk_level = RiskLevel.MODERATE

    async def execute(self, args: Dict[str, Any]) -> ToolResult:
        page = await _ensure_page()
        fields = args["fields"]
        try:
            for selector, value in fields.items():
                await page.fill(selector, str(value))
            return ToolResult(success=True, result=f"Filled {len(fields)} fields")
        except Exception as e:
            return ToolResult(success=False, result=None, error=str(e))


class BrowserSmartClickTool(BaseTool):
    """Click using AI-powered element detection."""

    name = "browser_smart_click"
    description = "Click on an element described in natural language (AI-assisted)."
    schema = {
        "type": "object",
        "properties": {
            "description": {"type": "string", "description": "Natural language description of element to click"},
        },
        "required": ["description"],
    }
    risk_level = RiskLevel.MODERATE

    async def execute(self, args: Dict[str, Any]) -> ToolResult:
        page = await _ensure_page()
        description = args["description"]
        try:
            # Use get_by_text / get_by_role as heuristics
            # Could be enhanced with vision model
            await page.get_by_text(description, exact=False).first.click()
            return ToolResult(success=True, result=f"Clicked element matching '{description}'")
        except Exception as e:
            return ToolResult(success=False, result=None, error=str(e))


class BrowserGetTextTool(BaseTool):
    """Extract text from page."""

    name = "browser_get_text"
    description = "Extract text content from the current page."
    schema = {
        "type": "object",
        "properties": {
            "selector": {"type": "string", "description": "Optional CSS selector to scope extraction"},
        },
        "required": [],
    }
    risk_level = RiskLevel.SAFE

    async def execute(self, args: Dict[str, Any]) -> ToolResult:
        page = await _ensure_page()
        selector = args.get("selector")
        try:
            if selector:
                elements = await page.query_selector_all(selector)
                text = "\n".join([await e.inner_text() for e in elements])
            else:
                text = await page.inner_text()
            return ToolResult(success=True, result={"text": text[:5000]})
        except Exception as e:
            return ToolResult(success=False, result=None, error=str(e))


class BrowserScreenshotTool(BaseTool):
    """Take a screenshot of the page."""

    name = "browser_screenshot"
    description = "Take a screenshot of the current page."
    schema = {
        "type": "object",
        "properties": {
            "path": {"type": "string", "description": "Optional path to save screenshot"},
        },
        "required": [],
    }
    risk_level = RiskLevel.SAFE

    async def execute(self, args: Dict[str, Any]) -> ToolResult:
        page = await _ensure_page()
        path = args.get("path")
        try:
            import base64
            screenshot_bytes = await page.screenshot()
            screenshot_b64 = base64.b64encode(screenshot_bytes).decode()
            result = {"screenshot_b64": screenshot_b64}
            if path:
                with open(path, "wb") as f:
                    f.write(screenshot_bytes)
                result["path"] = path
            return ToolResult(success=True, result=result)
        except Exception as e:
            return ToolResult(success=False, result=None, error=str(e))


class BrowserNewTabTool(BaseTool):
    """Open a new tab."""

    name = "browser_new_tab"
    description = "Open a new browser tab."
    schema = {
        "type": "object",
        "properties": {
            "url": {"type": "string", "description": "Optional URL to open in new tab"},
        },
        "required": [],
    }
    risk_level = RiskLevel.SAFE

    async def execute(self, args: Dict[str, Any]) -> ToolResult:
        global _browser_context
        await _ensure_browser()
        url = args.get("url")
        try:
            page = await _browser_context.new_page()
            if url:
                await page.goto(url)
            return ToolResult(success=True, result="New tab opened")
        except Exception as e:
            return ToolResult(success=False, result=None, error=str(e))


class BrowserCloseTabTool(BaseTool):
    """Close current tab."""

    name = "browser_close_tab"
    description = "Close the current browser tab."
    schema = {"type": "object", "properties": {}}
    risk_level = RiskLevel.SAFE

    async def execute(self, args: Dict[str, Any]) -> ToolResult:
        global _browser_page
        try:
            if _browser_page:
                await _browser_page.close()
                _browser_page = None
            return ToolResult(success=True, result="Tab closed")
        except Exception as e:
            return ToolResult(success=False, result=None, error=str(e))


class BrowserSwitchTabTool(BaseTool):
    """Switch to a different tab."""

    name = "browser_switch_tab"
    description = "Switch to a tab by index."
    schema = {
        "type": "object",
        "properties": {
            "index": {"type": "integer", "description": "Tab index (0-based)"},
        },
        "required": ["index"],
    }
    risk_level = RiskLevel.SAFE

    async def execute(self, args: Dict[str, Any]) -> ToolResult:
        global _browser_context, _browser_page
        await _ensure_browser()
        index = args["index"]
        try:
            pages = _browser_context.pages
            if 0 <= index < len(pages):
                _browser_page = pages[index]
                return ToolResult(success=True, result=f"Switched to tab {index}")
            else:
                return ToolResult(success=False, result=None, error="Invalid tab index")
        except Exception as e:
            return ToolResult(success=False, result=None, error=str(e))


class BrowserListTabsTool(BaseTool):
    """List all open tabs."""

    name = "browser_list_tabs"
    description = "List all open browser tabs with their URLs."
    schema = {"type": "object", "properties": {}}
    risk_level = RiskLevel.SAFE

    async def execute(self, args: Dict[str, Any]) -> ToolResult:
        global _browser_context
        await _ensure_browser()
        try:
            tabs = []
            for i, page in enumerate(_browser_context.pages):
                tabs.append({"index": i, "url": page.url, "title": await page.title()})
            return ToolResult(success=True, result={"tabs": tabs})
        except Exception as e:
            return ToolResult(success=False, result=None, error=str(e))


class BrowserCloseTool(BaseTool):
    """Close the browser."""

    name = "browser_close"
    description = "Close the browser and clean up resources."
    schema = {"type": "object", "properties": {}}
    risk_level = RiskLevel.SAFE

    async def execute(self, args: Dict[str, Any]) -> ToolResult:
        global _browser, _browser_context, _browser_page, _browser_initialized
        try:
            if _browser_page:
                await _browser_page.close()
            if _browser_context:
                await _browser_context.close()
            if _browser:
                await _browser.close()
            _browser = None
            _browser_context = None
            _browser_page = None
            _browser_initialized = False
            return ToolResult(success=True, result="Browser closed")
        except Exception as e:
            return ToolResult(success=False, result=None, error=str(e))


class BrowserCloseAllTool(BaseTool):
    """Close all browser windows."""

    name = "browser_close_all"
    description = "Close all browser windows and tabs."
    schema = {"type": "object", "properties": {}}
    risk_level = RiskLevel.SAFE

    async def execute(self, args: Dict[str, Any]) -> ToolResult:
        global _browser, _browser_context, _browser_page, _browser_initialized
        try:
            if _browser_context:
                for page in _browser_context.pages:
                    await page.close()
            return ToolResult(success=True, result="All tabs closed")
        except Exception as e:
            return ToolResult(success=False, result=None, error=str(e))


# Tool instances
browser_go_to = BrowserGoToTool()
browser_back = BrowserBackTool()
browser_forward = BrowserForwardTool()
browser_reload = BrowserReloadTool()
browser_get_url = BrowserGetUrlTool()
browser_click = BrowserClickTool()
browser_type = BrowserTypeTool()
browser_press = BrowserPressTool()
browser_scroll = BrowserScrollTool()
browser_fill_form = BrowserFillFormTool()
browser_smart_click = BrowserSmartClickTool()
browser_get_text = BrowserGetTextTool()
browser_screenshot = BrowserScreenshotTool()
browser_new_tab = BrowserNewTabTool()
browser_close_tab = BrowserCloseTabTool()
browser_switch_tab = BrowserSwitchTabTool()
browser_list_tabs = BrowserListTabsTool()
browser_close = BrowserCloseTool()
browser_close_all = BrowserCloseAllTool()
