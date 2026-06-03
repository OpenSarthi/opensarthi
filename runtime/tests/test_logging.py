import unittest
import tempfile
import shutil
import os
import json
from unittest.mock import patch
from dev_logger import DevLogger

class TestDevLogger(unittest.TestCase):
    def setUp(self):
        # Create a temporary directory for logs
        self.test_dir = tempfile.mkdtemp()
        self.patcher = patch("dev_logger.LOGS_DIR", self.test_dir)
        self.patcher.start()

    def tearDown(self):
        self.patcher.stop()
        shutil.rmtree(self.test_dir)

    def test_logger_lifecycle(self):
        logger = DevLogger(goal="Test task logging", model_name="gpt-4o", provider="openai")
        run_dir = logger.run_dir
        
        # Verify metadata is written
        meta_path = os.path.join(run_dir, "metadata.json")
        self.assertTrue(os.path.exists(meta_path))
        with open(meta_path, "r", encoding="utf-8") as f:
            meta = json.load(f)
            self.assertEqual(meta["goal"], "Test task logging")
            self.assertEqual(meta["model"], "gpt-4o")
            self.assertEqual(meta["provider"], "openai")

        # Test logging system prompt
        logger.log_system_prompt("You are a helpful assistant.")
        sys_prompt_path = os.path.join(run_dir, "system_prompt.txt")
        self.assertTrue(os.path.exists(sys_prompt_path))
        with open(sys_prompt_path, "r", encoding="utf-8") as f:
            self.assertEqual(f.read(), "You are a helpful assistant.")

        # Test logging context
        logger.log_planning_context(attempt=0, context="Structural planning context")
        context_path = os.path.join(run_dir, "context_attempt_0.txt")
        self.assertTrue(os.path.exists(context_path))
        with open(context_path, "r", encoding="utf-8") as f:
            self.assertEqual(f.read(), "Structural planning context")

        # Test logging LLM response
        logger.log_llm_response(attempt=0, response_text="Planning response text")
        response_path = os.path.join(run_dir, "response_attempt_0.txt")
        self.assertTrue(os.path.exists(response_path))
        with open(response_path, "r", encoding="utf-8") as f:
            self.assertEqual(f.read(), "Planning response text")

        # Test logging tool call
        logger.log_tool_call(
            attempt=0,
            step_index=1,
            tool_name="click",
            args={"x": 100, "y": 200},
            result_status="success",
            result_obs="Clicked at (100, 200)"
        )
        tool_calls_path = os.path.join(run_dir, "tool_calls_attempt_0.jsonl")
        self.assertTrue(os.path.exists(tool_calls_path))
        with open(tool_calls_path, "r", encoding="utf-8") as f:
            record = json.loads(f.readline())
            self.assertEqual(record["step_index"], 1)
            self.assertEqual(record["tool"], "click")
            self.assertEqual(record["arguments"], {"x": 100, "y": 200})
            self.assertEqual(record["status"], "success")
            self.assertEqual(record["observation"], "Clicked at (100, 200)")

        # Test finalize
        logger.finalize("Task completed successfully!")
        with open(meta_path, "r", encoding="utf-8") as f:
            meta = json.load(f)
            self.assertEqual(meta["final_response"], "Task completed successfully!")
            self.assertIn("duration_seconds", meta)

if __name__ == "__main__":
    unittest.main()
