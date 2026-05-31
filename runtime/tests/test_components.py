import unittest
import asyncio
from unittest.mock import Mock, AsyncMock, patch

from security import is_blocked, requires_confirmation, sandboxed_execute
from memory import MemoryManager, MemoryEntry
from observer import ObserverPipeline, ObservationResult
from llm import build_model
from mcp.schemas import MCPTool, MCPCallToolRequest, MCPCallToolResponse

class TestSecurity(unittest.TestCase):
    def test_blocked_patterns(self):
        blocked, reason = is_blocked("rm -rf /")
        self.assertTrue(blocked)
        self.assertIn("Blocked pattern matched", reason)

        blocked, reason = is_blocked("ls -la")
        self.assertFalse(blocked)

    def test_requires_confirmation(self):
        self.assertTrue(requires_confirmation("sudo apt update"))
        self.assertTrue(requires_confirmation("rm file.txt"))
        self.assertFalse(requires_confirmation("echo 'hello'"))

    @patch("security.sandbox.BWRAP_AVAILABLE", False)
    def test_sandboxed_execute_fallback(self):
        # Test direct fallback execution
        async def run_test():
            stdout, stderr, code = await sandboxed_execute("echo 'test'", timeout=5)
            self.assertEqual(stdout.strip(), "test")
            self.assertEqual(code, 0)
        asyncio.run(run_test())

class TestMemory(unittest.TestCase):
    def test_memory_storage_and_recall(self):
        async def run_test():
            mgr = MemoryManager(thread_id="test-thread-123")
            # Store some memory entries
            await mgr.store("User wants to configure the web app settings", source="user", importance=0.8)
            await mgr.store("Random non-important conversation message", source="user", importance=0.3)
            
            # Recall memory
            results = await mgr.recall("configure web app")
            self.assertTrue(len(results) >= 1)
            self.assertEqual(results[0].content, "User wants to configure the web app settings")
            self.assertEqual(results[0].source, "user")
        asyncio.run(run_test())

class TestObserver(unittest.TestCase):
    @patch("observer.pipeline.capture_screenshot", return_value=b"png-data")
    @patch("observer.pipeline.get_active_window", return_value="VS Code")
    @patch("observer.pipeline.extract_text", return_value="hello page")
    def test_observer_pipeline(self, mock_ocr, mock_window, mock_screen):
        async def run_test():
            pipeline = ObserverPipeline(use_ocr=True, use_vision=False)
            res = await pipeline.observe()
            self.assertEqual(res.active_window, "VS Code")
            self.assertEqual(res.screenshot_bytes, b"png-data")
            self.assertEqual(res.ocr_text, "hello page")
        asyncio.run(run_test())

class TestLLMFactory(unittest.TestCase):
    def test_build_model_validation(self):
        with self.assertRaises(ValueError):
            build_model("unsupported_provider", "some-model")

        # Test that building standard models imports the correct classes
        # Groq
        with patch("pydantic_ai.models.openai.OpenAIModel") as mock_openai:
            build_model("groq", "llama-3")
            mock_openai.assert_called_once()

if __name__ == "__main__":
    unittest.main()
