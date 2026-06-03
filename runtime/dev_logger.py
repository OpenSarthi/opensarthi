import os
import json
import time
import datetime
import uuid
from pathlib import Path

# Resolve workspace root dynamically relative to this file's location (runtime/dev_logger.py -> workspace)
_file_dir = os.path.dirname(os.path.abspath(__file__))
WORKSPACE_ROOT = os.path.dirname(_file_dir)
LOGS_DIR = os.path.join(WORKSPACE_ROOT, "runtime", "logs")

class DevLogger:
    """
    Detailed development logger for OpenSarthi agentic runs.
    Logs system prompts, planning contexts, raw LLM responses, tool calls, and outputs.
    """
    def __init__(self, goal: str, model_name: str, provider: str):
        self.run_id = str(uuid.uuid4())[:8]
        timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        self.run_dir = os.path.join(LOGS_DIR, "agent_runs", f"run_{timestamp}_{self.run_id}")
        self.log_filepath = os.path.join(self.run_dir, "execution_flow.log")
        self.goal = goal
        self.model_name = model_name
        self.provider = provider
        self.start_time = time.time()
        self.is_dev_mode = True # Default to True in workspace dev runs
        
        # Check if we can create the directory
        try:
            os.makedirs(self.run_dir, exist_ok=True)
            self._write_metadata()
            self.log(f"=== OpenSarthi Agentic Run {self.run_id} Started ===")
            self.log(f"Goal: {goal}")
            self.log(f"Model: {model_name} ({provider})")
        except Exception as e:
            # Fallback if logs directory is not writeable (e.g. packaged permissions)
            self.is_dev_mode = False

    def log(self, message: str):
        if not self.is_dev_mode:
            return
        timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
        try:
            with open(self.log_filepath, "a", encoding="utf-8") as f:
                f.write(f"[{timestamp}] {message}\n")
        except Exception:
            pass

    def _write_metadata(self):
        if not self.is_dev_mode:
            return
        metadata = {
            "run_id": self.run_id,
            "goal": self.goal,
            "model": self.model_name,
            "provider": self.provider,
            "timestamp": datetime.datetime.now().isoformat(),
            "start_time": self.start_time
        }
        try:
            with open(os.path.join(self.run_dir, "metadata.json"), "w", encoding="utf-8") as f:
                json.dump(metadata, f, indent=2)
        except Exception:
            pass

    def log_system_prompt(self, system_prompt: str):
        if not self.is_dev_mode:
            return
        try:
            with open(os.path.join(self.run_dir, "system_prompt.txt"), "w", encoding="utf-8") as f:
                f.write(system_prompt)
            self.log("Logged system prompt.")
        except Exception as e:
            self.log(f"Error logging system prompt: {e}")

    def log_planning_context(self, attempt: int, context: str):
        if not self.is_dev_mode:
            return
        try:
            filepath = os.path.join(self.run_dir, f"context_attempt_{attempt}.txt")
            with open(filepath, "w", encoding="utf-8") as f:
                f.write(context)
            self.log(f"Logged planning context for attempt {attempt}.")
        except Exception as e:
            self.log(f"Error logging context for attempt {attempt}: {e}")

    def log_llm_response(self, attempt: int, response_text: str):
        if not self.is_dev_mode:
            return
        try:
            filepath = os.path.join(self.run_dir, f"response_attempt_{attempt}.txt")
            with open(filepath, "w", encoding="utf-8") as f:
                f.write(response_text)
            self.log(f"Logged LLM response for attempt {attempt}.")
        except Exception as e:
            self.log(f"Error logging LLM response for attempt {attempt}: {e}")

    def log_tool_call(self, attempt: int, step_index: int, tool_name: str, args: dict, result_status: str, result_obs: str):
        if not self.is_dev_mode:
            return
        try:
            filepath = os.path.join(self.run_dir, f"tool_calls_attempt_{attempt}.jsonl")
            record = {
                "timestamp": datetime.datetime.now().isoformat(),
                "step_index": step_index,
                "tool": tool_name,
                "arguments": args,
                "status": result_status,
                "observation": result_obs
            }
            with open(filepath, "a", encoding="utf-8") as f:
                f.write(json.dumps(record) + "\n")
            self.log(f"Logged tool call: {tool_name} (step {step_index}) -> {result_status}")
        except Exception as e:
            self.log(f"Error logging tool call: {e}")

    def finalize(self, final_response: str):
        if not self.is_dev_mode:
            return
        duration = time.time() - self.start_time
        self.log(f"=== OpenSarthi Agentic Run Finished. Duration: {duration:.2f}s ===")
        self.log(f"Final Response: {final_response}")
        try:
            # Update metadata
            meta_path = os.path.join(self.run_dir, "metadata.json")
            if os.path.exists(meta_path):
                with open(meta_path, "r", encoding="utf-8") as f:
                    meta = json.load(f)
                meta["duration_seconds"] = duration
                meta["final_response"] = final_response
                meta["end_time"] = time.time()
                with open(meta_path, "w", encoding="utf-8") as f:
                    json.dump(meta, f, indent=2)
        except Exception:
            pass
