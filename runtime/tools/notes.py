import os
import glob
from tools.base import BaseTool, RiskLevel
from planner.schemas import ToolResult, ToolResultConfidence

NOTES_DIR = os.path.expanduser("~/opensarthi_notes")

class SaveNoteTool(BaseTool):
    name = "save_note"
    description = (
        "Create or update a markdown note in the user's local notes folder. "
        "Args: title (string: note title/filename, e.g., 'project_ideas'), content (string: note body)"
    )
    risk_level = RiskLevel.SAFE

    async def execute(self, args: dict) -> ToolResult:
        title = args.get("title", "").strip()
        content = args.get("content", "").strip()

        if not title:
            return ToolResult.fail("Missing title parameter", retryable=False)
        if not content:
            return ToolResult.fail("Missing content parameter", retryable=False)

        # Sanitize filename
        safe_title = "".join([c if c.isalnum() or c in ['-', '_'] else '_' for c in title])
        filename = f"{safe_title}.md"

        try:
            os.makedirs(NOTES_DIR, exist_ok=True)
            filepath = os.path.join(NOTES_DIR, filename)
            
            # Format markdown nicely
            note_content = f"# {title.replace('_', ' ').title()}\n\n{content}\n"
            
            with open(filepath, "w", encoding="utf-8") as f:
                f.write(note_content)
                
            return ToolResult.ok(f"Note saved successfully to {filepath}")
        except Exception as e:
            return ToolResult.fail(str(e))


class GetNotesTool(BaseTool):
    name = "get_notes"
    description = (
        "Search and retrieve user markdown notes by keyword query, or list all note titles. "
        "Args: query (string, optional: keyword to search note contents, leave empty to list all notes)"
    )
    risk_level = RiskLevel.SAFE

    async def execute(self, args: dict) -> ToolResult:
        query = args.get("query", "").strip().lower()

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
