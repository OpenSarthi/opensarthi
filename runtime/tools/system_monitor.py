"""
System Monitoring & Control Tools — Mark-L Parity Feature

- system_status: CPU, RAM, disk, GPU, network, battery
- weather_report: Current + forecast
- flight_finder: Flight search
- reminder_set / reminder_cancel: Persisted via APScheduler
- monitor_control: Brightness, resolution, multi-monitor layout
- agent_shutdown: Graceful agent shutdown
"""
import asyncio
import structlog
import platform
import psutil
from typing import Dict, Any, Optional, List

from tools.base import BaseTool, RiskLevel, ToolResult, ToolDomain

logger = structlog.get_logger()


class SystemStatusTool(BaseTool):
    """Get system status (CPU, RAM, disk, GPU, network, battery)."""

    name = "system_status"
    description = "Get comprehensive system status: CPU, RAM, disk, GPU, network, battery."
    schema = {
        "type": "object",
        "properties": {
            "include_gpu": {"type": "boolean", "default": True},
            "include_network": {"type": "boolean", "default": True},
            "include_battery": {"type": "boolean", "default": True},
        },
        "required": [],
    }
    risk_level = RiskLevel.SAFE
    domain = ToolDomain.GENERAL

    async def execute(self, args: Dict[str, Any]) -> ToolResult:
        try:
            result = {}

            # CPU
            cpu_percent = psutil.cpu_percent(interval=0.5)
            cpu_count = psutil.cpu_count()
            cpu_freq = psutil.cpu_freq()
            result["cpu"] = {
                "percent": cpu_percent,
                "cores": cpu_count,
                "frequency_mhz": cpu_freq.current if cpu_freq else None,
            }

            # RAM
            mem = psutil.virtual_memory()
            result["memory"] = {
                "total_gb": round(mem.total / (1024**3), 2),
                "available_gb": round(mem.available / (1024**3), 2),
                "used_percent": mem.percent,
            }

            # Disk
            disk = psutil.disk_usage("/")
            result["disk"] = {
                "total_gb": round(disk.total / (1024**3), 2),
                "free_gb": round(disk.free / (1024**3), 2),
                "used_percent": round((disk.used / disk.total) * 100, 1),
            }

            # GPU (if available)
            if args.get("include_gpu", True):
                result["gpu"] = await self._get_gpu_info()

            # Network
            if args.get("include_network", True):
                net = psutil.net_io_counters()
                result["network"] = {
                    "bytes_sent": net.bytes_sent,
                    "bytes_recv": net.bytes_recv,
                    "packets_sent": net.packets_sent,
                    "packets_recv": net.packets_recv,
                }

            # Battery
            if args.get("include_battery", True):
                result["battery"] = await self._get_battery_info()

            # Platform info
            result["platform"] = {
                "system": platform.system(),
                "release": platform.release(),
                "architecture": platform.machine(),
            }

            return ToolResult(success=True, result=result)

        except Exception as e:
            logger.error("System status failed", error=str(e))
            return ToolResult(success=False, result=None, error=str(e))

    async def _get_gpu_info(self) -> Dict:
        """Get GPU information."""
        try:
            import GPUtil
            gpus = GPUtil.getGPUs()
            if gpus:
                gpu = gpus[0]
                return {
                    "name": gpu.name,
                    "load_percent": round(gpu.load * 100, 1),
                    "memory_total_mb": gpu.memoryTotal,
                    "memory_used_mb": gpu.memoryUsed,
                    "temperature_c": gpu.temperature,
                }
        except ImportError:
            pass
        except Exception:
            pass
        return {"available": False}

    async def _get_battery_info(self) -> Dict:
        """Get battery information."""
        try:
            battery = psutil.sensors_battery()
            if battery:
                return {
                    "percent": battery.percent,
                    "power_plugged": battery.power_plugged,
                    "time_left_minutes": battery.secsleft // 60 if battery.secsleft > 0 else None,
                }
        except Exception:
            pass
        return {"available": False}


class WeatherReportTool(BaseTool):
    """Get weather report (current + forecast)."""

    name = "weather_report"
    description = "Get current weather and forecast for a location."
    schema = {
        "type": "object",
        "properties": {
            "location": {"type": "string", "default": "auto", "description": "Location (city, coordinates, or 'auto')"},
            "days": {"type": "integer", "default": 3, "description": "Forecast days"},
        },
        "required": [],
    }
    risk_level = RiskLevel.SAFE
    domain = ToolDomain.GENERAL

    async def execute(self, args: Dict[str, Any]) -> ToolResult:
        location = args.get("location", "auto")
        days = args.get("days", 3)

        try:
            import httpx
            # Use wttr.in (no API key needed)
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"https://wttr.in/{location}?format=j1",
                    timeout=10,
                )
                response.raise_for_status()
                data = response.json()

                current = data.get("current_condition", [{}])[0]
                forecast = data.get("weather", [])[:days]

                result = {
                    "current": {
                        "temperature_c": current.get("temp_C"),
                        "temperature_f": current.get("temp_F"),
                        "description": current.get("weatherDesc", [{}])[0].get("value", ""),
                        "humidity": current.get("humidity"),
                        "wind_kph": current.get("windspeedKmph"),
                        "feels_like_c": current.get("FeelsLikeC"),
                    },
                    "forecast": [],
                }

                for day in forecast:
                    result["forecast"].append({
                        "date": day.get("date"),
                        "max_temp_c": day.get("maxtempC"),
                        "min_temp_c": day.get("mintempC"),
                        "description": day.get("hourly", [{}])[0].get("weatherDesc", [{}])[0].get("value", ""),
                    })

                return ToolResult(success=True, result=result)

        except Exception as e:
            logger.error("Weather report failed", error=str(e))
            return ToolResult(success=False, result=None, error=str(e))


class FlightFinderTool(BaseTool):
    """Find flights (via Duffel/Amadeus or scraping)."""

    name = "flight_finder"
    description = "Search for flights between airports."
    schema = {
        "type": "object",
        "properties": {
            "origin": {"type": "string", "description": "Origin airport code (e.g., JFK)"},
            "destination": {"type": "string", "description": "Destination airport code"},
            "date": {"type": "string", "description": "Departure date (YYYY-MM-DD)"},
            "return_date": {"type": "string", "description": "Return date for round trip"},
            "passengers": {"type": "integer", "default": 1},
        },
        "required": ["origin", "destination", "date"],
    }
    risk_level = RiskLevel.SAFE
    domain = ToolDomain.GENERAL

    async def execute(self, args: Dict[str, Any]) -> ToolResult:
        # This would integrate with Duffel, Amadeus, or scrape
        # For now, return a placeholder
        return ToolResult(
            success=True,
            result={
                "note": "Flight search requires Duffel/Amadeus API integration",
                "origin": args["origin"],
                "destination": args["destination"],
                "date": args["date"],
            },
        )


class ReminderSetTool(BaseTool):
    """Set a persistent reminder via APScheduler."""

    name = "reminder_set"
    description = "Set a reminder that persists across restarts (uses APScheduler)."
    schema = {
        "type": "object",
        "properties": {
            "time": {"type": "string", "description": "ISO format datetime or relative (e.g., '+1h', 'tomorrow 9am')"},
            "message": {"type": "string", "description": "Reminder message"},
            "recurring": {"type": "boolean", "default": False, "description": "Repeat daily/weekly"},
        },
        "required": ["time", "message"],
    }
    risk_level = RiskLevel.MODERATE
    domain = ToolDomain.GENERAL

    async def execute(self, args: Dict[str, Any]) -> ToolResult:
        try:
            from apscheduler.schedulers.asyncio import AsyncIOScheduler
            from apscheduler.triggers.date import DateTrigger
            from apscheduler.triggers.cron import CronTrigger
            from dateutil import parser as date_parser
            import datetime

            time_str = args["time"]
            message = args["message"]
            recurring = args.get("recurring", False)

            # Parse time
            if time_str.startswith("+"):
                # Relative time
                import re
                match = re.match(r"\+(\d+)([hdm])", time_str)
                if match:
                    amount = int(match.group(1))
                    unit = match.group(2)
                    delta = datetime.timedelta(
                        hours=amount if unit == "h" else 0,
                        days=amount if unit == "d" else 0,
                        minutes=amount if unit == "m" else 0,
                    )
                    run_time = datetime.datetime.now() + delta
                else:
                    return ToolResult(success=False, result=None, error="Invalid time format")
            else:
                run_time = date_parser.parse(time_str)

            # Store in DB for persistence
            from db import DB_PATH
            import sqlite3
            import uuid

            conn = sqlite3.connect(DB_PATH)
            cursor = conn.cursor()
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS reminders (
                    id TEXT PRIMARY KEY,
                    time REAL NOT NULL,
                    message TEXT NOT NULL,
                    recurring BOOLEAN DEFAULT FALSE
                )
            """)
            reminder_id = str(uuid.uuid4())
            cursor.execute(
                "INSERT INTO reminders (id, time, message, recurring) VALUES (?, ?, ?, ?)",
                (reminder_id, run_time.timestamp(), message, recurring)
            )
            conn.commit()
            conn.close()

            # Schedule with APScheduler
            scheduler = AsyncIOScheduler()
            if recurring:
                # Parse cron from time (simplified)
                trigger = CronTrigger(hour=run_time.hour, minute=run_time.minute)
            else:
                trigger = DateTrigger(run_date=run_time)

            scheduler.add_job(
                self._trigger_reminder,
                trigger,
                args=[message],
                id=reminder_id,
            )
            scheduler.start()

            return ToolResult(success=True, result={"id": reminder_id, "time": run_time.isoformat()})

        except Exception as e:
            logger.error("Reminder set failed", error=str(e))
            return ToolResult(success=False, result=None, error=str(e))

    async def _trigger_reminder(self, message: str):
        """Callback when reminder fires."""
        logger.info("Reminder triggered", message=message)
        # Would emit WebSocket event here


class ReminderCancelTool(BaseTool):
    """Cancel a reminder."""

    name = "reminder_cancel"
    description = "Cancel a previously set reminder."
    schema = {
        "type": "object",
        "properties": {
            "id": {"type": "string", "description": "Reminder ID to cancel"},
        },
        "required": ["id"],
    }
    risk_level = RiskLevel.SAFE
    domain = ToolDomain.GENERAL

    async def execute(self, args: Dict[str, Any]) -> ToolResult:
        try:
            from apscheduler.schedulers.asyncio import AsyncIOScheduler
            from db import DB_PATH
            import sqlite3

            reminder_id = args["id"]

            # Remove from DB
            conn = sqlite3.connect(DB_PATH)
            cursor = conn.cursor()
            cursor.execute("DELETE FROM reminders WHERE id = ?", (reminder_id,))
            conn.commit()
            conn.close()

            # Remove from scheduler
            scheduler = AsyncIOScheduler()
            scheduler.remove_job(reminder_id)

            return ToolResult(success=True, result="Reminder cancelled")

        except Exception as e:
            logger.error("Reminder cancel failed", error=str(e))
            return ToolResult(success=False, result=None, error=str(e))


class MonitorControlTool(BaseTool):
    """Control monitor settings (brightness, resolution, layout)."""

    name = "monitor_control"
    description = "Control monitor: brightness, resolution, multi-monitor layout."
    schema = {
        "type": "object",
        "properties": {
            "action": {"type": "string", "enum": ["brightness", "resolution", "layout", "rotate", "list"]},
            "value": {"type": "string", "description": "Value for action (e.g., '50' for brightness, '1920x1080' for resolution)"},
            "monitor": {"type": "integer", "default": 0, "description": "Monitor index"},
        },
        "required": ["action"],
    }
    risk_level = RiskLevel.MODERATE
    domain = ToolDomain.GENERAL

    async def execute(self, args: Dict[str, Any]) -> ToolResult:
        system = platform.system()
        action = args["action"]
        value = args.get("value")
        monitor = args.get("monitor", 0)

        try:
            if system == "Linux":
                if action == "brightness":
                    # Use ddcutil or brightnessctl
                    import subprocess
                    subprocess.run(["brightnessctl", "set", f"{value}%"], check=True)
                    return ToolResult(success=True, result=f"Brightness set to {value}%")
                elif action == "resolution":
                    # Use xrandr
                    import subprocess
                    subprocess.run(["xrandr", "--output", f"DP-{monitor}", "--mode", value], check=True)
                    return ToolResult(success=True, result=f"Resolution set to {value}")
                elif action == "list":
                    import subprocess
                    result = subprocess.run(["xrandr", "--listmonitors"], capture_output=True, text=True)
                    return ToolResult(success=True, result={"monitors": result.stdout})

            return ToolResult(success=False, result=None, error=f"Unsupported platform: {system}")

        except Exception as e:
            logger.error("Monitor control failed", error=str(e))
            return ToolResult(success=False, result=None, error=str(e))


class AgentShutdownTool(BaseTool):
    """Graceful agent shutdown."""

    name = "agent_shutdown"
    description = "Gracefully shutdown the agent runtime."
    schema = {"type": "object", "properties": {"confirm": {"type": "boolean", "default": False}}}
    risk_level = RiskLevel.DANGEROUS
    domain = ToolDomain.GENERAL

    async def execute(self, args: Dict[str, Any]) -> ToolResult:
        if not args.get("confirm"):
            return ToolResult(success=False, result=None, error="Confirmation required (confirm=true)")

        # Signal shutdown
        import os
        os._exit(0)


# Tool instances
system_status_tool = SystemStatusTool()
weather_report_tool = WeatherReportTool()
flight_finder_tool = FlightFinderTool()
reminder_set_tool = ReminderSetTool()
reminder_cancel_tool = ReminderCancelTool()
monitor_control_tool = MonitorControlTool()
agent_shutdown_tool = AgentShutdownTool()


# ── Real-time system telemetry push loop ──────────────────────────────────────

import time
import sys
import os

_last_net_bytes: int = 0
_last_net_time: float = 0.0
_nvml_ok: bool | None = None  # None=untested, True=works, False=unavailable

# Intel GPU tracking caches
_last_intel_rc6: int = 0
_last_intel_time: float = 0.0


def _get_gpu_percent() -> float | None:
    """Multi-vendor GPU utilisation for NVIDIA, AMD, and Intel. Returns None if unavailable."""
    global _nvml_ok

    # 1. Try NVIDIA (NVML)
    if _nvml_ok is not False:
        try:
            import pynvml  # type: ignore
            pynvml.nvmlInit()
            h = pynvml.nvmlDeviceGetHandleByIndex(0)
            util = pynvml.nvmlDeviceGetUtilizationRates(h)
            _nvml_ok = True
            return float(util.gpu)
        except Exception:
            pass

        # ctypes fallback (no pynvml package needed on Linux/macOS)
        try:
            import ctypes
            lib_name = (
                "libnvidia-ml.so.1" if sys.platform == "linux"
                else "libnvidia-ml.dylib" if sys.platform == "darwin"
                else "nvml.dll"
            )

            class _Util(ctypes.Structure):
                _fields_ = [("gpu", ctypes.c_uint), ("memory", ctypes.c_uint)]

            nv = ctypes.CDLL(lib_name)
            nv.nvmlInit_v2()
            dev = ctypes.c_void_p()
            nv.nvmlDeviceGetHandleByIndex_v2(0, ctypes.byref(dev))
            u = _Util()
            nv.nvmlDeviceGetUtilizationRates(dev, ctypes.byref(u))
            _nvml_ok = True
            return float(u.gpu)
        except Exception:
            _nvml_ok = False

    # Linux-only sysfs checks for AMD and Intel Integrated GPUs
    if sys.platform != "linux":
        return None

    # 2. Try AMD GPU sysfs fallback
    for card in ('card0', 'card1', 'card2'):
        p = f"/sys/class/drm/{card}/device/gpu_busy_percent"
        if os.path.exists(p):
            try:
                with open(p, "r") as f:
                    val = int(f.read().strip())
                    return float(val)
            except Exception:
                pass

    # 3. Try Intel GPU RC6 residency sysfs fallback (i915 driver)
    global _last_intel_rc6, _last_intel_time
    now = time.monotonic()
    intel_path = None
    for card in ('card0', 'card1', 'card2'):
        p = f"/sys/class/drm/{card}/device/drm/{card}/gt/gt0/rc6_residency_ms"
        if os.path.exists(p):
            intel_path = p
            break

    if intel_path:
        try:
            with open(intel_path, "r") as f:
                rc6 = int(f.read().strip())

            gpu_util = None
            if _last_intel_time > 0:
                elapsed_ms = (now - _last_intel_time) * 1000
                idle_ms = rc6 - _last_intel_rc6
                if elapsed_ms > 0 and idle_ms >= 0:
                    idle_ratio = min(idle_ms / elapsed_ms, 1.0)
                    gpu_util = (1.0 - idle_ratio) * 100.0
                    gpu_util = max(0.0, min(100.0, gpu_util))

            _last_intel_rc6 = rc6
            _last_intel_time = now
            if gpu_util is not None:
                return float(gpu_util)
        except Exception:
            pass

    return None


def _get_cpu_temp() -> float | None:
    """CPU temperature in °C. Returns None if sensor data unavailable."""
    try:
        import psutil  # type: ignore
        temps = psutil.sensors_temperatures()
        if not temps:
            return None
        # Priority: coretemp (Intel Linux) → k10temp (AMD) → cpu_thermal (ARM/macOS) → first available
        for key in ("coretemp", "k10temp", "cpu_thermal", "acpitz"):
            if key in temps and temps[key]:
                entries = temps[key]
                # Use the first "Package" / "Tctl" / "CPU Temperature" entry, else first entry
                for entry in entries:
                    if any(kw in (entry.label or "").lower() for kw in ("package", "tctl", "cpu temp", "core 0")):
                        return round(entry.current, 1)
                return round(entries[0].current, 1)
        # Fallback: first available sensor
        for group in temps.values():
            if group:
                return round(group[0].current, 1)
    except Exception:
        pass
    return None


def _get_net_kbps() -> float:
    """Combined network throughput in KB/s since last call."""
    global _last_net_bytes, _last_net_time
    try:
        import psutil  # type: ignore
        counters = psutil.net_io_counters()
        now = time.monotonic()
        total = counters.bytes_sent + counters.bytes_recv
        if _last_net_time and (now - _last_net_time) > 0:
            kbps = (total - _last_net_bytes) / (now - _last_net_time) / 1024
        else:
            kbps = 0.0
        _last_net_bytes = total
        _last_net_time = now
        return round(max(kbps, 0.0), 1)
    except Exception:
        return 0.0


def get_system_metrics() -> dict:
    """
    Synchronous snapshot of system metrics.
    Returns a dict with CPU %, RAM %, network speed, GPU %, and CPU temperature.
    """
    try:
        import psutil  # type: ignore
        cpu = round(psutil.cpu_percent(interval=None), 1)
        mem = round(psutil.virtual_memory().percent, 1)
    except Exception:
        cpu, mem = 0.0, 0.0

    net = _get_net_kbps()
    gpu_raw = _get_gpu_percent()
    temp_raw = _get_cpu_temp()

    # Fetch mobile pairing server stats
    try:
        from dashboard.server import dashboard_server
        is_running = getattr(dashboard_server, "_running", False)
        devices = list(dashboard_server._device_info.values()) if is_running else []
    except Exception:
        is_running = False
        devices = []

    return {
        "cpu": cpu,
        "mem": mem,
        "net_kbps": net,
        "gpu": round(gpu_raw, 1) if gpu_raw is not None else "N/A",
        "temp": temp_raw if temp_raw is not None else "N/A",
        "mobile_status": {
            "enabled": is_running,
            "connected": len(devices) > 0,
            "devices": devices
        }
    }


async def metrics_push_loop(broadcast_fn, interval: float = 1.5):
    """
    Background asyncio task. Calls get_system_metrics() every `interval` seconds
    and passes the result to `broadcast_fn(event, data)`.
    """
    # Prime the net counter
    await asyncio.to_thread(_get_net_kbps)
    await asyncio.sleep(interval)

    while True:
        try:
            metrics = await asyncio.to_thread(get_system_metrics)
            await broadcast_fn("system_metrics", metrics)
        except Exception:
            pass
        await asyncio.sleep(interval)