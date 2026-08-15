"""
Music / YouTube Tools — Mark-L Parity Feature

- youtube_search: Search and play YouTube videos
- youtube_control: Play/pause/next/previous/volume/seek
- music_play: Local music file playback (MP3, FLAC via system player)
"""
import asyncio
import structlog
import subprocess
import platform
from typing import Dict, Any, Optional, List
from pathlib import Path

from tools.base import BaseTool, RiskLevel, ToolResult

logger = structlog.get_logger()


class YouTubeSearchTool(BaseTool):
    """Search and play YouTube videos."""

    name = "youtube_search"
    description = "Search YouTube for videos and optionally play the first result."
    schema = {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "Search query"},
            "play": {"type": "boolean", "default": True, "description": "Play first result"},
            "max_results": {"type": "integer", "default": 5},
        },
        "required": ["query"],
    }
    risk_level = RiskLevel.SAFE

    async def execute(self, args: Dict[str, Any]) -> ToolResult:
        query = args["query"]
        play = args.get("play", True)
        max_results = args.get("max_results", 5)

        try:
            import httpx
            # Use YouTube Data API if available, else scrape
            from config import settings
            api_key = getattr(settings, "youtube_api_key", None)

            if api_key:
                results = await self._search_api(api_key, query, max_results)
            else:
                results = await self._search_scrape(query, max_results)

            if not results:
                return ToolResult(success=False, result=None, error="No results found")

            if play and results:
                # Open first result in browser/default player
                await self._play_video(results[0]["url"])
                return ToolResult(
                    success=True,
                    result={
                        "played": results[0],
                        "results": results,
                    },
                )
            else:
                return ToolResult(success=True, result={"results": results})

        except Exception as e:
            logger.error("YouTube search failed", error=str(e))
            return ToolResult(success=False, result=None, error=str(e))

    async def _search_api(self, api_key: str, query: str, max_results: int) -> List[Dict]:
        """Search using YouTube Data API."""
        import httpx
        async with httpx.AsyncClient() as client:
            response = await client.get(
                "https://www.googleapis.com/youtube/v3/search",
                params={
                    "part": "snippet",
                    "q": query,
                    "type": "video",
                    "maxResults": max_results,
                    "key": api_key,
                },
                timeout=10,
            )
            response.raise_for_status()
            data = response.json()
            return [
                {
                    "title": item["snippet"]["title"],
                    "url": f"https://www.youtube.com/watch?v={item['id']['videoId']}",
                    "video_id": item["id"]["videoId"],
                    "description": item["snippet"].get("description", ""),
                }
                for item in data.get("items", [])
            ]

    async def _search_scrape(self, query: str, max_results: int) -> List[Dict]:
        """Scrape YouTube search results (no API key)."""
        import httpx
        from urllib.parse import quote
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"https://www.youtube.com/results?search_query={quote(query)}",
                headers={"User-Agent": "Mozilla/5.0 (compatible; OpenSarthi/1.0)"},
                timeout=10,
            )
            response.raise_for_status()
            # Extract video IDs from page (simplified)
            import re
            video_ids = re.findall(r'"videoId":"([^"]+)"', response.text)
            results = []
            for vid in video_ids[:max_results]:
                results.append({
                    "title": f"Video {vid}",
                    "url": f"https://www.youtube.com/watch?v={vid}",
                    "video_id": vid,
                })
            return results

    async def _play_video(self, url: str):
        """Play video URL in default browser/player."""
        system = platform.system()
        if system == "Linux":
            subprocess.Popen(["xdg-open", url], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        elif system == "Windows":
            subprocess.Popen(["start", url], shell=True)
        elif system == "Darwin":
            subprocess.Popen(["open", url])


class YouTubeControlTool(BaseTool):
    """Control YouTube/media playback."""

    name = "youtube_control"
    description = "Control media playback: play, pause, next, previous, volume, seek."
    schema = {
        "type": "object",
        "properties": {
            "action": {
                "type": "string",
                "enum": ["play", "pause", "next", "previous", "volume_up", "volume_down", "mute", "seek_forward", "seek_backward"],
            },
            "amount": {"type": "integer", "default": 10, "description": "Amount for volume/seek"},
        },
        "required": ["action"],
    }
    risk_level = RiskLevel.SAFE

    async def execute(self, args: Dict[str, Any]) -> ToolResult:
        action = args["action"]
        amount = args.get("amount", 10)

        try:
            system = platform.system()
            if system == "Linux":
                key_map = {
                    "play": "space",
                    "pause": "space",
                    "next": "n",
                    "previous": "p",
                    "volume_up": "up",
                    "volume_down": "down",
                    "mute": "m",
                    "seek_forward": "right",
                    "seek_backward": "left",
                }
                key = key_map.get(action, "space")
                # Use playerctl if available
                try:
                    if action in ("play", "pause"):
                        subprocess.run(["playerctl", "play-pause"], timeout=5)
                    elif action == "next":
                        subprocess.run(["playerctl", "next"], timeout=5)
                    elif action == "previous":
                        subprocess.run(["playerctl", "previous"], timeout=5)
                    elif action in ("volume_up", "volume_down"):
                        # Use pactl for volume
                        op = "+" if action == "volume_up" else "-"
                        subprocess.run(["pactl", "set-sink-volume", "@DEFAULT_SINK@", f"{op}{amount}%"], timeout=5)
                    return ToolResult(success=True, result=f"Media {action}")
                except Exception:
                    # Fallback to media key simulation
                    subprocess.run(["xdotool", "key", f"XF86Audio{action.title()}"], timeout=5)
                    return ToolResult(success=True, result=f"Media {action} (key)")
            elif system == "Windows":
                # Windows Media keys
                key_map = {
                    "play": "Media_Play_Pause",
                    "pause": "Media_Play_Pause",
                    "next": "Media_Next",
                    "previous": "Media_Prev",
                    "volume_up": "Volume_Up",
                    "volume_down": "Volume_Down",
                    "mute": "Volume_Mute",
                }
                key = key_map.get(action, "Media_Play_Pause")
                subprocess.run(["nircmd", "sendkeypress", key], timeout=5)
                return ToolResult(success=True, result=f"Media {action}")
            else:
                return ToolResult(success=False, result=None, error="Unsupported platform")
        except Exception as e:
            return ToolResult(success=False, result=None, error=str(e))


class MusicPlayTool(BaseTool):
    """Play local music file."""

    name = "music_play"
    description = "Play a local music file (MP3, FLAC, etc.) using system player."
    schema = {
        "type": "object",
        "properties": {
            "path": {"type": "string", "description": "Path to music file or directory"},
            "recursive": {"type": "boolean", "default": False, "description": "Play all files in directory recursively"},
        },
        "required": ["path"],
    }
    risk_level = RiskLevel.SAFE

    async def execute(self, args: Dict[str, Any]) -> ToolResult:
        path = args["path"]
        recursive = args.get("recursive", False)

        if not Path(path).exists():
            return ToolResult(success=False, result=None, error=f"Path not found: {path}")

        try:
            system = platform.system()
            if Path(path).is_file():
                if system == "Linux":
                    subprocess.Popen(["xdg-open", path], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                elif system == "Windows":
                    subprocess.Popen(["start", path], shell=True)
                elif system == "Darwin":
                    subprocess.Popen(["open", path])
                return ToolResult(success=True, result=f"Playing {path}")
            elif Path(path).is_dir():
                # Find audio files
                patterns = ["*.mp3", "*.flac", "*.wav", "*.ogg", "*.m4a"]
                files = []
                for pattern in patterns:
                    if recursive:
                        files.extend(Path(path).rglob(pattern))
                    else:
                        files.extend(Path(path).glob(pattern))
                if not files:
                    return ToolResult(success=False, result=None, error="No audio files found")
                # Play first file
                first = str(files[0])
                if system == "Linux":
                    subprocess.Popen(["xdg-open", first], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                return ToolResult(success=True, result=f"Playing {first} ({len(files)} files found)")
        except Exception as e:
            return ToolResult(success=False, result=None, error=str(e))


# Tool instances
youtube_search_tool = YouTubeSearchTool()
youtube_control_tool = YouTubeControlTool()
music_play_tool = MusicPlayTool()
