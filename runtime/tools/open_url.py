"""
open_url — Terminal-first browser/URL opening.

Fastest path to get a page visible: hand the URL to the platform default
handler (`xdg-open` on Linux) or launch a known browser binary with the URL as
an argument — no GUI clicking through "open browser → type URL → press Enter".

The tool returns once the browser has started. Call `wait_for_window` next if
you plan to interact with the page (so the window gets pinned as the task
target), then `observe_desktop` to read the screen.
"""
import asyncio
import platform
import shutil
from urllib.parse import urlparse

from tools.base import BaseTool, RiskLevel, ToolDomain
from planner.schemas import ToolResult

# Known browsers tried in order of preference. Each entry is
# (binary, [flags sent before the URL]). `--force-renderer-accessibility`
# keeps the AT-SPI tree available so the accessibility-based tools work.
_BROWSER_BINARIES = [
    ("google-chrome-stable", ["--force-renderer-accessibility", "--new-window"]),
    ("google-chrome", ["--force-renderer-accessibility", "--new-window"]),
    ("chromium", ["--force-renderer-accessibility", "--new-window"]),
    ("chromium-browser", ["--force-renderer-accessibility", "--new-window"]),
    ("brave", ["--force-renderer-accessibility", "--new-window"]),
    ("firefox", ["--new-window"]),
    ("microsoft-edge", ["--new-window"]),
    ("edge", ["--new-window"]),
]

# Only these URL schemes may be handed to the browser. Never javascript:/data:
# — that would execute content, not navigate. `file:` is also excluded so the
# tool only ever causes real network navigation.
_ALLOWED_SCHEMES = {"http", "https", "mailto"}


class OpenUrlTool(BaseTool):
    name = "open_url"
    description = (
        "Open a URL directly in the user's visible desktop browser using the system "
        "(launches the browser with the URL as an argument — much faster and more reliable "
        "than open_app + typing the URL). Prefer this for 'open X page' or 'go to URL' requests. "
        "Afterwards call wait_for_window to pin the browser window, then observe_desktop to see the page."
    )
    risk_level = RiskLevel.SAFE
    domain = ToolDomain.BROWSER
    schema = {
        "type": "object",
        "properties": {
            "url": {"type": "string", "description": "Full URL to open, e.g. 'https://leetcode.com/problemset/'"},
            "browser": {
                "type": "string",
                "description": "Optional preferred browser binary ('google-chrome', 'firefox', 'chromium', 'brave'). Defaults to the system default browser.",
            },
        },
        "required": ["url"],
    }

    async def execute(self, args: dict) -> ToolResult:
        url = (args.get("url") or "").strip()
        browser = (args.get("browser") or "").strip().lower()

        if not url:
            return ToolResult.fail("No URL provided", retryable=False)

        # Scheme safety gate — run BEFORE normalisation so `javascript:`, `data:`
        # etc. are not silently rewritten to `https://javascript:…`.
        parsed = urlparse(url)
        if parsed.scheme:
            scheme = parsed.scheme.lower()
            if scheme not in _ALLOWED_SCHEMES:
                return ToolResult.fail(
                    f"URL scheme '{scheme}' is not allowed (must be one of {sorted(_ALLOWED_SCHEMES)})",
                    retryable=False,
                )
        else:
            # Bare host/path — default to https.
            url = "https://" + url

        system = platform.system()
        try:
            if browser:
                exe = shutil.which(browser)
                if not exe:
                    return ToolResult.fail(
                        f"Browser binary '{browser}' not found in PATH", retryable=True
                    )
                return await self._launch_detached([exe, "--new-window", url])

            # Prefer a known browser binary (accessibility-friendly), else the
            # system default handler.
            for binary, flags in _BROWSER_BINARIES:
                exe = shutil.which(binary)
                if exe:
                    return await self._launch_detached([exe, *flags, url])

            if system == "Linux":
                return await self._launch_detached(["xdg-open", url])
            elif system == "Windows":
                return await self._launch_detached(
                    ["rundll32", "url.dll,FileProtocolHandler", url]
                )
            elif system == "Darwin":
                return await self._launch_detached(["open", url])
            return ToolResult.fail(f"Unsupported OS: {system}", retryable=False)
        except Exception as e:
            return ToolResult.fail(str(e), retryable=True)

    async def _launch_detached(self, cmd: list) -> ToolResult:
        """
        Spawn the browser with the URL. The child runs in its own session so it
        survives the runtime process; we probe briefly for an immediate launch
        failure but never kill a still-running process (that would close the
        just-opened window).
        """
        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.DEVNULL,
                # DEVNULL, not PIPE: the browser is detached and outlives this
                # call, so nobody will drain its stderr. A PIPE would fill up
                # (~64KB) once the browser logs enough and block the browser.
                stderr=asyncio.subprocess.DEVNULL,
                start_new_session=True,
            )
        except FileNotFoundError:
            return ToolResult.fail(f"Command not found: {cmd[0]}", retryable=True)

        try:
            await asyncio.wait_for(proc.communicate(), timeout=2.0)
        except asyncio.TimeoutError:
            # Still running after 2s = launched successfully. Leave it alone.
            return ToolResult.ok(f"Opened {cmd[-1]}")

        if proc.returncode != 0:
            return ToolResult.fail(
                f"'{cmd[0]} {cmd[-1]}' exited with code {proc.returncode}",
                retryable=True,
            )

        return ToolResult.ok(f"Opened {cmd[-1]}")


open_url_tool = OpenUrlTool()