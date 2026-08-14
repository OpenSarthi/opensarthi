"""
runtime/tools/system_monitor.py
Real-time system metrics for OpenSarthi.

Returns CPU %, RAM %, network speed KB/s, GPU %, CPU temperature.
Uses psutil (already a dependency) + optional pynvml for NVIDIA GPU.
Graceful fallback: GPU = "N/A", temp = "N/A" when unavailable.
"""

import asyncio
import os
import sys
import time
from typing import TypedDict


class SystemMetrics(TypedDict):
    cpu: float          # 0–100%
    mem: float          # 0–100%
    net_kbps: float     # combined send+recv KB/s
    gpu: float | None   # 0–100% or None
    temp: float | None  # °C or None


# ── Module-level caches ──────────────────────────────────────────────────────

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
    """CPU temperature in °C.  Returns None if sensor data unavailable."""
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
    Returns a dict matching the SystemMetrics TypedDict shape,
    but with None replaced by sentinel strings for JSON serialisation:
      gpu: float | "N/A"
      temp: float | "N/A"
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


async def metrics_push_loop(broadcast_fn, interval: float = 2.0):
    """
    Background asyncio task.  Calls get_system_metrics() every `interval` seconds
    and passes the result to `broadcast_fn(event, data)`.

    Usage in websocket.py:
        asyncio.create_task(metrics_push_loop(manager.broadcast_event))
    """
    # Prime the net counter (first reading is always 0 KB/s)
    _get_net_kbps()
    await asyncio.sleep(interval)

    while True:
        try:
            metrics = get_system_metrics()
            await broadcast_fn("system_metrics", metrics)
        except Exception:
            pass
        await asyncio.sleep(interval)
