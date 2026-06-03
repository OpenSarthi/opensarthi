import asyncio
import os
import shutil
from tools.base import BaseTool, RiskLevel
from planner.schemas import ToolResult, ToolResultConfidence

# Resolve workspace root dynamically relative to this file's location (runtime/tools/self_fix.py -> runtime -> workspace)
_file_dir = os.path.dirname(os.path.abspath(__file__))
_runtime_dir = os.path.dirname(_file_dir)
WORKSPACE_ROOT = os.path.dirname(_runtime_dir)

class SelfFixTool(BaseTool):
    name = "self_fix"
    description = (
        "Diagnose and automatically heal code issues in the OpenSarthi codebase. "
        "Runs diagnostics, rewrites the file using AI, verifies it compiles, and rolls back on failure."
    )
    risk_level = RiskLevel.DANGEROUS
    schema = {
        "type": "object",
        "properties": {
            "description": {"type": "string", "description": "What is broken or needs fixing. Be specific — name the symptom and relevant behaviour."},
            "target_file": {"type": "string", "description": "Path to the file relative to workspace root, e.g. 'runtime/tools/media.py'"},
        },
        "required": ["description", "target_file"],
    }

    async def execute(self, args: dict, permission_manager=None) -> ToolResult:
        description = args.get("description", "").strip()
        target_file = args.get("target_file", "").strip()

        if not description:
            return ToolResult.fail("Missing description parameter", retryable=False)
        if not target_file:
            return ToolResult.fail("Missing target_file parameter", retryable=False)

        filepath = os.path.join(WORKSPACE_ROOT, target_file)
        if not os.path.exists(filepath):
            return ToolResult.fail(f"Target file {target_file} not found in workspace", retryable=False)

        try:
            # Emit diagnostic status to user via shell streaming if callback is present
            log_action = getattr(permission_manager, 'log_action', None)
            if log_action:
                await log_action(f"⚡ Initiating Self-Fix diagnostic on {target_file}...")

            # Run build/typecheck check depending on file type
            is_frontend = target_file.startswith("apps/desktop")
            build_ok = True
            diagnostic_output = ""

            if is_frontend:
                # Run tsc typecheck
                proc = await asyncio.create_subprocess_exec(
                    "pnpm", "--filter", "desktop", "typecheck",
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                    cwd=WORKSPACE_ROOT
                )
                stdout, stderr = await proc.communicate()
                if proc.returncode != 0:
                    build_ok = False
                    diagnostic_output = (stdout.decode() + stderr.decode()).strip()
            else:
                # Python check: run compileall
                proc = await asyncio.create_subprocess_exec(
                    "python3", "-m", "py_compile", filepath,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE
                )
                stdout, stderr = await proc.communicate()
                if proc.returncode != 0:
                    build_ok = False
                    diagnostic_output = (stdout.decode() + stderr.decode()).strip()

            if build_ok:
                msg = f"Build is currently passing on {target_file}. Self-fix will try to apply requested logical change: {description}"
                if log_action:
                    await log_action(msg)
            else:
                msg = f"Build failed with error:\n{diagnostic_output[:500]}"
                if log_action:
                    await log_action(msg)

            # Let's request the active model to fix it!
            from config import settings, get_active_api_key
            from llm import build_model
            provider = settings.ai_provider.lower()
            model_name = settings.local_model if provider == "ollama" else settings.cloud_model
            api_key = get_active_api_key()

            active_model = build_model(provider, model_name, api_key)

            from pydantic_ai import Agent as PydanticAgent
            fixer = PydanticAgent(model=active_model)

            with open(filepath, "r", encoding="utf-8") as f:
                code_content = f.read()

            prompt = f"""You are a senior self-healing software engineer module for OpenSarthi.
You are tasked with fixing an issue in {target_file}.

THE CURRENT FILE CONTENT:
```
{code_content}
```

THE FIX REQUEST:
{description}

DIAGNOSTIC BUILD ERROR (IF ANY):
{diagnostic_output}

RULES:
- Make the smallest targeted change that fixes the issue.
- Maintain existing styles and logic.
- Output ONLY the full updated code file contents inside a single code block starting with ```python or ```typescript. Do not add conversational text before or after.
"""
            if log_action:
                await log_action("Calling AI self-healing model...")

            result = await fixer.run(prompt)
            raw_response = result.output.strip()

            # Parse out the code block
            import re
            match = re.search(r'```(?:python|typescript|javascript|tsx|ts|json)?\n([\s\S]*?)\n```', raw_response)
            new_code = match.group(1).strip() if match else raw_response

            if not new_code or len(new_code) < 10:
                return ToolResult.fail("AI returned empty or invalid code block.", retryable=True)

            # Backup the original file
            backup_path = filepath + ".bak"
            shutil.copyfile(filepath, backup_path)

            # Write the new code
            with open(filepath, "w", encoding="utf-8") as f:
                f.write(new_code)

            # Verify the fix compiles/passes
            if log_action:
                await log_action("Fix written. Running verification build...")

            if is_frontend:
                proc = await asyncio.create_subprocess_exec(
                    "pnpm", "--filter", "desktop", "typecheck",
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                    cwd=WORKSPACE_ROOT
                )
            else:
                proc = await asyncio.create_subprocess_exec(
                    "python3", "-m", "py_compile", filepath,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE
                )
            await proc.communicate()

            if proc.returncode == 0:
                # Remove backup on success
                if os.path.exists(backup_path):
                    os.remove(backup_path)
                msg = f"Self-healing succeeded! Code compiled/typechecked cleanly on {target_file}."
                if log_action:
                    await log_action(msg)
                return ToolResult.ok(msg)
            else:
                # Rollback on failure!
                shutil.copyfile(backup_path, filepath)
                if os.path.exists(backup_path):
                    os.remove(backup_path)
                msg = "Self-fix rollback triggered. The generated code did not compile/typecheck."
                if log_action:
                    await log_action(msg)
                return ToolResult.fail(msg, retryable=False)

        except Exception as e:
            return ToolResult.fail(str(e))
