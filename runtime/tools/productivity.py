"""
Phase 3 tools: web search (DuckDuckGo free), weather (wttr.in free),
timers (asyncio + libnotify), file browser, read file, volume control, battery.
"""
import asyncio
import os
import shutil
import json
import time
import urllib.request
import urllib.parse
from typing import Optional
from tools.base import BaseTool, RiskLevel
from planner.schemas import ToolResult, ToolResultConfidence


# ─── Web Search (DuckDuckGo Instant Answer — free, no key) ───────────────────

class WebSearchTool(BaseTool):
    name = "search_web"
    description = "Search the web via DuckDuckGo for current information. Returns top results with titles and snippets."
    risk_level = RiskLevel.SAFE
    schema = {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "Search query"},
            "count": {"type": "number", "description": "Max results to return (default: 5)"},
        },
        "required": ["query"],
    }

    async def execute(self, args: dict) -> ToolResult:
        query = args.get("query", "").strip()
        count = int(args.get("count", 5))

        if not query:
            return ToolResult.fail("Missing query parameter", retryable=False)

        try:
            loop = asyncio.get_running_loop()
            results = await loop.run_in_executor(None, self._search, query, count)
            return ToolResult.ok(results, confidence=ToolResultConfidence.HIGH)
        except Exception as e:
            return ToolResult.fail(f"Web search failed: {e}", retryable=True)

    def _search(self, query: str, count: int) -> str:
        """DuckDuckGo HTML scraping — no API key required."""
        import html
        import re

        encoded = urllib.parse.quote_plus(query)
        url = f"https://html.duckduckgo.com/html/?q={encoded}"
        req = urllib.request.Request(
            url,
            headers={"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) OpenSarthi/1.0"},
        )
        with urllib.request.urlopen(req, timeout=8) as resp:
            raw = resp.read().decode("utf-8", errors="replace")

        # Parse result blocks: title + snippet
        results = []
        pattern = re.compile(
            r'class="result__title"[^>]*>.*?href="([^"]+)"[^>]*>([^<]+)</a>.*?'
            r'class="result__snippet"[^>]*>(.*?)</a>',
            re.DOTALL,
        )
        for m in pattern.finditer(raw):
            url_val = html.unescape(m.group(1)).strip()
            title = html.unescape(re.sub(r"<[^>]+>", "", m.group(2))).strip()
            snippet = html.unescape(re.sub(r"<[^>]+>", "", m.group(3))).strip()
            if title and snippet:
                results.append(f"**{title}**\n{snippet}\n{url_val}")
            if len(results) >= count:
                break

        if not results:
            # Fallback: DuckDuckGo Instant Answer API
            url2 = f"https://api.duckduckgo.com/?q={encoded}&format=json&no_html=1&skip_disambig=1"
            req2 = urllib.request.Request(url2, headers={"User-Agent": "OpenSarthi/1.0"})
            with urllib.request.urlopen(req2, timeout=8) as resp2:
                data = json.loads(resp2.read().decode("utf-8"))
            abstract = data.get("AbstractText", "")
            if abstract:
                return f"**{data.get('Heading', query)}**\n{abstract}\n{data.get('AbstractURL', '')}"
            return f"No results found for '{query}'"

        return "\n\n---\n\n".join(results[:count])


# ─── Weather (wttr.in — free, no key) ────────────────────────────────────────

class WeatherTool(BaseTool):
    name = "get_weather"
    description = "Get current weather and short forecast for a location using wttr.in (free, no API key)."
    risk_level = RiskLevel.SAFE
    schema = {
        "type": "object",
        "properties": {
            "location": {"type": "string", "description": "City name, airport code, or 'lat,lon'. E.g. 'Pune', 'Mumbai', 'Delhi'"},
            "days": {"type": "number", "description": "Forecast days 1–3 (default: 1)"},
        },
        "required": [],
    }

    async def execute(self, args: dict) -> ToolResult:
        location = args.get("location", "").strip()
        days = min(int(args.get("days", 1)), 3)

        try:
            loop = asyncio.get_running_loop()
            result = await loop.run_in_executor(None, self._fetch_weather, location, days)
            return ToolResult.ok(result, confidence=ToolResultConfidence.HIGH)
        except Exception as e:
            return ToolResult.fail(f"Weather fetch failed: {e}", retryable=True)

    def _fetch_weather(self, location: str, days: int) -> str:
        loc_enc = urllib.parse.quote_plus(location) if location else ""
        url = f"https://wttr.in/{loc_enc}?format=j1"
        req = urllib.request.Request(url, headers={"User-Agent": "OpenSarthi/1.0"})
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read().decode("utf-8"))

        current = data["current_condition"][0]
        desc = current["weatherDesc"][0]["value"]
        temp_c = current["temp_C"]
        feels = current["FeelsLikeC"]
        humidity = current["humidity"]
        wind_kph = current["windspeedKmph"]

        loc_name = location or "your location"
        result = (
            f"**Weather for {loc_name}**\n"
            f"Condition: {desc}\n"
            f"Temperature: {temp_c}°C (feels like {feels}°C)\n"
            f"Humidity: {humidity}%  |  Wind: {wind_kph} km/h\n"
        )

        if days > 1:
            result += "\n**Forecast:**\n"
            for day_data in data.get("weather", [])[:days]:
                date = day_data["date"]
                max_c = day_data["maxtempC"]
                min_c = day_data["mintempC"]
                day_desc = day_data["hourly"][4]["weatherDesc"][0]["value"]
                result += f"• {date}: {day_desc}, {min_c}–{max_c}°C\n"

        return result.strip()


# ─── Timer (asyncio + libnotify — free, local) ────────────────────────────────

_active_timers: dict[int, asyncio.Task] = {}
_timer_counter = 0


class SetTimerTool(BaseTool):
    name = "set_timer"
    description = "Start a countdown timer. Fires a system notification and voice-ready alert when done."
    risk_level = RiskLevel.SAFE
    schema = {
        "type": "object",
        "properties": {
            "minutes": {"type": "number", "description": "Timer duration in minutes"},
            "seconds": {"type": "number", "description": "Additional seconds (default: 0)"},
            "label": {"type": "string", "description": "Optional timer label, e.g. 'pasta timer'"},
        },
        "required": [],
    }

    async def execute(self, args: dict) -> ToolResult:
        global _timer_counter
        minutes = float(args.get("minutes", 0))
        seconds = float(args.get("seconds", 0))
        label = args.get("label", "Timer").strip() or "Timer"
        total_seconds = minutes * 60 + seconds

        if total_seconds <= 0:
            return ToolResult.fail("Specify minutes or seconds greater than 0", retryable=False)

        _timer_counter += 1
        timer_id = _timer_counter

        async def _fire():
            await asyncio.sleep(total_seconds)
            msg = f"⏰ {label} — time's up!"
            _send_notification(label, "Time's up! ⏰")
            _active_timers.pop(timer_id, None)

        task = asyncio.ensure_future(_fire())
        _active_timers[timer_id] = task

        mins_disp = f"{int(minutes)}m" if minutes else ""
        secs_disp = f"{int(seconds)}s" if seconds else ""
        duration_str = f"{mins_disp}{secs_disp}"
        return ToolResult.ok(
            f"Timer #{timer_id} set: '{label}' fires in {duration_str}.",
            confidence=ToolResultConfidence.HIGH
        )


class ListTimersTool(BaseTool):
    name = "list_timers"
    description = "List all active countdown timers."
    risk_level = RiskLevel.SAFE
    schema = {"type": "object", "properties": {}, "required": []}

    async def execute(self, args: dict) -> ToolResult:
        if not _active_timers:
            return ToolResult.ok("No active timers.")
        lines = [f"• Timer #{tid} — running" for tid, task in _active_timers.items() if not task.done()]
        return ToolResult.ok("\n".join(lines) if lines else "No active timers.")


class CancelTimerTool(BaseTool):
    name = "cancel_timer"
    description = "Cancel a specific timer by ID, or cancel all timers if no ID given."
    risk_level = RiskLevel.SAFE
    schema = {
        "type": "object",
        "properties": {
            "id": {"type": "number", "description": "Timer ID to cancel. Omit to cancel all."},
        },
        "required": [],
    }

    async def execute(self, args: dict) -> ToolResult:
        timer_id = args.get("id")
        if timer_id is not None:
            task = _active_timers.pop(int(timer_id), None)
            if task:
                task.cancel()
                return ToolResult.ok(f"Timer #{int(timer_id)} cancelled.")
            return ToolResult.ok(f"No timer found with ID {int(timer_id)}.")
        else:
            count = len(_active_timers)
            for task in _active_timers.values():
                task.cancel()
            _active_timers.clear()
            return ToolResult.ok(f"All {count} timer(s) cancelled.")


def _send_notification(title: str, body: str):
    """Fire a desktop notification via notify-send if available."""
    if shutil.which("notify-send"):
        try:
            os.system(f'notify-send "{title}" "{body}" --urgency=normal 2>/dev/null')
        except Exception:
            pass


# ─── File Browser ─────────────────────────────────────────────────────────────

_PATH_SHORTCUTS = {
    "desktop": os.path.expanduser("~/Desktop"),
    "downloads": os.path.expanduser("~/Downloads"),
    "documents": os.path.expanduser("~/Documents"),
    "pictures": os.path.expanduser("~/Pictures"),
    "music": os.path.expanduser("~/Music"),
    "videos": os.path.expanduser("~/Videos"),
    "home": os.path.expanduser("~"),
}


def _resolve_path(path: str) -> str:
    p = path.strip().lower()
    if p in _PATH_SHORTCUTS:
        return _PATH_SHORTCUTS[p]
    return os.path.expanduser(path)


class ListFilesTool(BaseTool):
    name = "list_files"
    description = "List files and folders at a path. Accepts shortcuts: 'desktop', 'downloads', 'documents', 'home', or any absolute path."
    risk_level = RiskLevel.SAFE
    schema = {
        "type": "object",
        "properties": {
            "path": {"type": "string", "description": "Path or shortcut (default: 'home')"},
            "folders_only": {"type": "boolean", "description": "Only return directories (default: false)"},
            "limit": {"type": "number", "description": "Max entries to return (default: 50)"},
        },
        "required": [],
    }

    async def execute(self, args: dict) -> ToolResult:
        path_arg = args.get("path", "home")
        folders_only = bool(args.get("folders_only", False))
        limit = int(args.get("limit", 50))

        real_path = _resolve_path(path_arg)
        if not os.path.exists(real_path):
            return ToolResult.fail(f"Path not found: {real_path}", retryable=False)
        if not os.path.isdir(real_path):
            return ToolResult.fail(f"Not a directory: {real_path}", retryable=False)

        try:
            entries = sorted(os.scandir(real_path), key=lambda e: (not e.is_dir(), e.name.lower()))
            lines = []
            for e in entries:
                if e.name.startswith("."):
                    continue
                if folders_only and not e.is_dir():
                    continue
                icon = "📁" if e.is_dir() else "📄"
                size = ""
                if e.is_file():
                    s = e.stat().st_size
                    size = f" ({s//1024} KB)" if s >= 1024 else f" ({s} B)"
                lines.append(f"{icon} {e.name}{size}")
                if len(lines) >= limit:
                    break

            if not lines:
                return ToolResult.ok(f"No {'folders' if folders_only else 'files'} found in {real_path}")
            return ToolResult.ok(f"**{real_path}** ({len(lines)} items):\n" + "\n".join(lines))
        except PermissionError:
            return ToolResult.fail(f"Permission denied: {real_path}", retryable=False)
        except Exception as e:
            return ToolResult.fail(str(e))


class OpenPathTool(BaseTool):
    name = "open_path"
    description = "Open a file or folder in the default application (Nautilus/Dolphin for folders, default app for files)."
    risk_level = RiskLevel.MODERATE
    schema = {
        "type": "object",
        "properties": {
            "path": {"type": "string", "description": "Path or shortcut to open, e.g. '~/Downloads', 'desktop', '/home/user/file.pdf'"},
        },
        "required": ["path"],
    }

    async def execute(self, args: dict) -> ToolResult:
        path_arg = args.get("path", "").strip()
        if not path_arg:
            return ToolResult.fail("Missing path parameter", retryable=False)

        real_path = _resolve_path(path_arg)
        if not os.path.exists(real_path):
            return ToolResult.fail(f"Path not found: {real_path}", retryable=False)

        try:
            proc = await asyncio.create_subprocess_exec(
                "xdg-open", real_path,
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL,
            )
            await asyncio.wait_for(proc.wait(), timeout=5)
            return ToolResult.ok(f"Opened: {real_path}")
        except asyncio.TimeoutError:
            return ToolResult.ok(f"Opened: {real_path} (app still loading)")
        except Exception as e:
            return ToolResult.fail(str(e))


class ReadFileTool(BaseTool):
    name = "read_file"
    description = "Read the text contents of a file (txt, md, py, ts, js, json, config, source code, etc.). Returns up to max_chars characters."
    risk_level = RiskLevel.SAFE
    schema = {
        "type": "object",
        "properties": {
            "path": {"type": "string", "description": "File path or shortcut, e.g. '~/Documents/notes.txt', 'desktop/readme.md'"},
            "max_chars": {"type": "number", "description": "Max characters to return (default: 8000)"},
        },
        "required": ["path"],
    }

    async def execute(self, args: dict) -> ToolResult:
        path_arg = args.get("path", "").strip()
        max_chars = int(args.get("max_chars", 8000))

        if not path_arg:
            return ToolResult.fail("Missing path parameter", retryable=False)

        real_path = _resolve_path(path_arg)
        if not os.path.exists(real_path):
            return ToolResult.fail(f"File not found: {real_path}", retryable=False)
        if not os.path.isfile(real_path):
            return ToolResult.fail(f"Not a file: {real_path}", retryable=False)

        BINARY_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".bmp", ".mp3", ".mp4", ".zip", ".exe", ".bin"}
        if any(real_path.endswith(ext) for ext in BINARY_EXTENSIONS):
            return ToolResult.fail("Binary file type — use a dedicated tool to handle this format", retryable=False)

        try:
            file_size = os.path.getsize(real_path)
            with open(real_path, "r", encoding="utf-8", errors="replace") as f:
                content = f.read(max_chars)
            truncated = file_size > max_chars
            note = f"\n\n[...truncated at {max_chars} chars; total file size: {file_size} bytes]" if truncated else ""
            return ToolResult.ok(
                f"**{real_path}** ({file_size} bytes):\n```\n{content}\n```{note}",
                confidence=ToolResultConfidence.HIGH
            )
        except PermissionError:
            return ToolResult.fail(f"Permission denied: {real_path}", retryable=False)
        except Exception as e:
            return ToolResult.fail(str(e))


# ─── Volume Control (pactl/amixer — free, local) ──────────────────────────────

class VolumeControlTool(BaseTool):
    name = "set_volume"
    description = "Control system audio volume using PulseAudio (pactl) or ALSA (amixer)."
    risk_level = RiskLevel.SAFE
    schema = {
        "type": "object",
        "properties": {
            "level": {"type": "number", "description": "Absolute volume level 0–100"},
            "action": {"type": "string", "enum": ["up", "down", "mute", "unmute", "toggle_mute"], "description": "Relative action instead of absolute level"},
        },
        "required": [],
    }

    async def execute(self, args: dict) -> ToolResult:
        level = args.get("level")
        action = args.get("action", "").lower().strip()

        try:
            if level is not None:
                level = max(0, min(100, int(level)))
                if shutil.which("pactl"):
                    proc = await asyncio.create_subprocess_exec(
                        "pactl", "set-sink-volume", "@DEFAULT_SINK@", f"{level}%",
                        stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL
                    )
                    await proc.wait()
                    return ToolResult.ok(f"Volume set to {level}%")
                elif shutil.which("amixer"):
                    proc = await asyncio.create_subprocess_exec(
                        "amixer", "sset", "Master", f"{level}%",
                        stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL
                    )
                    await proc.wait()
                    return ToolResult.ok(f"Volume set to {level}%")
                return ToolResult.fail("No audio control utility found (pactl/amixer)", retryable=False)

            if action == "up":
                cmd = ["pactl", "set-sink-volume", "@DEFAULT_SINK@", "+5%"] if shutil.which("pactl") else ["amixer", "sset", "Master", "5%+"]
            elif action == "down":
                cmd = ["pactl", "set-sink-volume", "@DEFAULT_SINK@", "-5%"] if shutil.which("pactl") else ["amixer", "sset", "Master", "5%-"]
            elif action in ("mute", "toggle_mute"):
                cmd = ["pactl", "set-sink-mute", "@DEFAULT_SINK@", "1"] if shutil.which("pactl") else ["amixer", "sset", "Master", "mute"]
            elif action == "unmute":
                cmd = ["pactl", "set-sink-mute", "@DEFAULT_SINK@", "0"] if shutil.which("pactl") else ["amixer", "sset", "Master", "unmute"]
            else:
                return ToolResult.fail("Provide level (0-100) or action (up/down/mute/unmute)", retryable=False)

            proc = await asyncio.create_subprocess_exec(*cmd, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL)
            await proc.wait()
            return ToolResult.ok(f"Volume {action} applied.")
        except Exception as e:
            return ToolResult.fail(str(e))


# ─── Battery Status (upower — free, local) ────────────────────────────────────

class BatteryTool(BaseTool):
    name = "get_battery"
    description = "Get current battery percentage and charging status."
    risk_level = RiskLevel.SAFE
    schema = {"type": "object", "properties": {}, "required": []}

    async def execute(self, args: dict) -> ToolResult:
        try:
            # Try upower first
            if shutil.which("upower"):
                proc = await asyncio.create_subprocess_exec(
                    "upower", "-i", "/org/freedesktop/UPower/devices/battery_BAT0",
                    stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
                )
                stdout, _ = await proc.communicate()
                text = stdout.decode()
                percentage = None
                state = "unknown"
                for line in text.splitlines():
                    if "percentage" in line:
                        percentage = line.split(":")[-1].strip()
                    if "state" in line:
                        state = line.split(":")[-1].strip()
                if percentage:
                    charging = "⚡ charging" if "charging" in state else "🔋 discharging" if "discharging" in state else state
                    return ToolResult.ok(f"Battery: {percentage} — {charging}")

            # Fallback: read sysfs
            bat_paths = [
                "/sys/class/power_supply/BAT0",
                "/sys/class/power_supply/BAT1",
            ]
            for bat in bat_paths:
                cap_file = os.path.join(bat, "capacity")
                stat_file = os.path.join(bat, "status")
                if os.path.exists(cap_file):
                    with open(cap_file) as f:
                        pct = f.read().strip()
                    status = "unknown"
                    if os.path.exists(stat_file):
                        with open(stat_file) as f:
                            status = f.read().strip()
                    icon = "⚡" if "Charging" in status else "🔋"
                    return ToolResult.ok(f"Battery: {pct}% — {icon} {status}")

            return ToolResult.fail("No battery found on this device", retryable=False)
        except Exception as e:
            return ToolResult.fail(str(e))


# ─── Network Toggle (nmcli — free, local) ─────────────────────────────────────

class NetworkControlTool(BaseTool):
    name = "toggle_wifi"
    description = "Turn Wi-Fi on or off, or check its current status. Uses nmcli."
    risk_level = RiskLevel.DANGEROUS
    schema = {
        "type": "object",
        "properties": {
            "on": {"type": "boolean", "description": "True to turn on, False to turn off. Omit to check status."},
        },
        "required": [],
    }

    async def execute(self, args: dict) -> ToolResult:
        on = args.get("on")
        if not shutil.which("nmcli"):
            return ToolResult.fail("nmcli not found. Install network-manager.", retryable=False)

        try:
            if on is None:
                # Check status
                proc = await asyncio.create_subprocess_exec(
                    "nmcli", "radio", "wifi",
                    stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
                )
                stdout, _ = await proc.communicate()
                return ToolResult.ok(f"Wi-Fi: {stdout.decode().strip()}")
            else:
                state = "on" if on else "off"
                proc = await asyncio.create_subprocess_exec(
                    "nmcli", "radio", "wifi", state,
                    stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL
                )
                await proc.wait()
                return ToolResult.ok(f"Wi-Fi turned {state}.")
        except Exception as e:
            return ToolResult.fail(str(e))
