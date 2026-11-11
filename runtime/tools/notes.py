import os
import glob
from tools.base import BaseTool, RiskLevel, ToolDomain
from planner.schemas import ToolResult, ToolResultConfidence

NOTES_DIR = os.path.expanduser("~/opensarthi_notes")

class SaveNoteTool(BaseTool):
    name = "save_note"
    description = "Create or update a markdown note. Supports saving to user notes folder or specific destination (e.g. 'Downloads', 'Documents')."
    risk_level = RiskLevel.SAFE
    domain = ToolDomain.GENERAL
    schema = {
        "type": "object",
        "properties": {
            "title": {"type": "string", "description": "Note title/filename, e.g. 'project_ideas', 'meeting_notes'"},
            "content": {"type": "string", "description": "Note body text (markdown supported)"},
            "destination": {"type": "string", "description": "Optional destination folder or path (e.g. 'Downloads', '~/Downloads', 'Documents'). Defaults to '~/opensarthi_notes'"},
        },
        "required": ["title", "content"],
    }

    async def execute(self, args: dict) -> ToolResult:
        title = (args.get("title") or "").strip()
        content = (args.get("content") or "").strip()

        if not title:
            return ToolResult.fail("Missing title parameter", retryable=False)
        if not content:
            return ToolResult.fail("Missing content parameter", retryable=False)

        # Sanitize filename
        safe_title = "".join([c if c.isalnum() or c in ['-', '_'] else '_' for c in title])
        filename = f"{safe_title}.md"

        dest_raw = (args.get("destination") or args.get("folder") or args.get("path") or "").strip()
        if dest_raw:
            lowered = dest_raw.lower()
            if lowered in ("downloads", "download"):
                target_dir = os.path.expanduser("~/Downloads")
            elif lowered in ("documents", "document", "docs"):
                target_dir = os.path.expanduser("~/Documents")
            elif lowered in ("desktop",):
                target_dir = os.path.expanduser("~/Desktop")
            else:
                target_dir = os.path.expanduser(dest_raw)
                if not os.path.isabs(target_dir):
                    target_dir = os.path.join(os.path.expanduser("~"), target_dir)

            if target_dir.endswith(".md") or target_dir.endswith(".txt"):
                filepath = target_dir
                os.makedirs(os.path.dirname(filepath), exist_ok=True)
            else:
                os.makedirs(target_dir, exist_ok=True)
                filepath = os.path.join(target_dir, filename)
        else:
            os.makedirs(NOTES_DIR, exist_ok=True)
            filepath = os.path.join(NOTES_DIR, filename)

        try:
            # Format markdown nicely
            note_content = f"# {title.replace('_', ' ').title()}\n\n{content}\n"
            
            with open(filepath, "w", encoding="utf-8") as f:
                f.write(note_content)

            # Deterministic post-write verification
            if os.path.exists(filepath) and os.path.getsize(filepath) > 0:
                return ToolResult.ok(
                    f"Note saved and verified successfully at: {filepath}",
                    result={"path": filepath, "size_bytes": os.path.getsize(filepath), "verified": True},
                    confidence=ToolResultConfidence.HIGH
                )
            else:
                return ToolResult.fail(f"File write was attempted but file not verified at {filepath}", retryable=False)
        except Exception as e:
            return ToolResult.fail(str(e))


class GetNotesTool(BaseTool):
    name = "get_notes"
    description = "Search and retrieve markdown notes by keyword, or list all notes if no query given."
    risk_level = RiskLevel.SAFE
    domain = ToolDomain.GENERAL
    schema = {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "Keyword or phrase to search note contents. Leave empty to list all notes."},
        },
        "required": [],
    }

    async def execute(self, args: dict) -> ToolResult:
        query = (args.get("query") or "").strip().lower()

        if not os.path.exists(NOTES_DIR):
            return ToolResult.ok("No notes folder exists yet. Call save_note to create your first note.")

        try:
            files = glob.glob(os.path.join(NOTES_DIR, "*.md"))
            if not files:
                return ToolResult.ok("No notes found in the notes folder.")

            results = []
            for filepath in files:
                basename = os.path.basename(filepath)
                title = os.path.splitext(basename)[0].replace("_", " ").title()
                
                with open(filepath, "r", encoding="utf-8") as f:
                    content = f.read()

                if not query or query in content.lower() or query in title.lower():
                    # Return snippet
                    lines = content.split("\n")
                    body_lines = [l for l in lines if not l.startswith("#") and l.strip()][:3]
                    snippet = " ".join(body_lines)[:120]
                    results.append(f"• {title} ({basename})\n  Snippet: {snippet}...")

            if not results:
                return ToolResult.ok(f"No notes match query '{query}'")

            return ToolResult.ok("\n".join(results))
        except Exception as e:
            return ToolResult.fail(str(e))
