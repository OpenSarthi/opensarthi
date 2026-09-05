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
        with patch("pydantic_ai.models.groq.GroqModel") as mock_groq:
            build_model("groq", "llama-3")
            mock_groq.assert_called_once()

        # custom_openai
        import pydantic_ai.models.openai as _p_openai
        _openai_cls = "OpenAIChatModel" if hasattr(_p_openai, "OpenAIChatModel") else "OpenAIModel"
        with patch(f"pydantic_ai.models.openai.{_openai_cls}") as mock_openai, \
             patch("pydantic_ai.providers.openai.OpenAIProvider") as mock_provider:
            build_model("custom_openai", "my-custom-model", api_key="sk-custom-key")
            mock_openai.assert_called_once()
            mock_provider.assert_called_once()

    def test_validate_key_route(self):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        from api.routes import router

        app = FastAPI()
        app.include_router(router)
        client = TestClient(app)

        # Missing key for google returns valid: False
        res = client.get("/validate_key?provider=google")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertFalse(data["valid"])

        # Missing base_url for custom_openai returns valid: False
        res = client.get("/validate_key?provider=custom_openai")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertFalse(data["valid"])
        self.assertIn("Base URL is required", data["message"])

class TestBriefing(unittest.TestCase):
    def test_get_briefing_singleton_updates(self):
        from briefing import get_briefing, MorningBriefing
        import briefing

        ws1 = Mock()
        settings1 = Mock()
        b1 = get_briefing(ws1, settings1, thread_id="t1")
        self.assertEqual(b1.thread_id, "t1")
        self.assertEqual(b1.ws, ws1)

        ws2 = Mock()
        settings2 = Mock()
        b2 = get_briefing(ws2, settings2, thread_id="t2")
        self.assertIs(b1, b2)
        self.assertEqual(b2.thread_id, "t2")
        self.assertEqual(b2.ws, ws2)

    def test_briefing_phase2_token_tracking(self):
        async def run_test():
            from briefing import MorningBriefing
            import db

            ws = Mock()
            ws.accumulate_and_update_tokens = AsyncMock()
            ws.send_message = AsyncMock()
            ws.speak = AsyncMock()
            settings = Mock()
            settings.use_native_voice = False

            b = MorningBriefing(ws, settings, thread_id="test-thread-briefing")

            # Mock _generate_summary to return summary and tokens
            b._generate_summary = AsyncMock(return_value=("Good morning!", 40, 200, 240))
            b._get_calendar_events = AsyncMock(return_value=[])
            b._get_weather = AsyncMock(return_value={"description": "sunny"})
            b._get_news_headlines = AsyncMock(return_value=[])
            b._get_relevant_memories = AsyncMock(return_value=[])

            with patch("db.save_message") as mock_save:
                await b._run_phase2()
                mock_save.assert_called_once()
                args, kwargs = mock_save.call_args
                # args: (thread_id, msg_id, role, content, timestamp, req_tok, res_tok, tot_tok)
                self.assertEqual(args[0], "test-thread-briefing")
                self.assertEqual(args[2], "assistant")
                self.assertEqual(args[3], "Good morning!")
                self.assertEqual(args[5], 40)
                self.assertEqual(args[6], 200)
                self.assertEqual(args[7], 240)

        asyncio.run(run_test())

    def test_custom_openai_provider_name_config(self):
        from config import Settings
        s = Settings(custom_openai_provider_name="OmniRoute")
        self.assertEqual(s.custom_openai_provider_name, "OmniRoute")

    def test_maybe_trigger_briefing(self):
        async def run_test():
            from api.websocket import Session
            from unittest.mock import MagicMock, AsyncMock, patch

            mock_ws = MagicMock()
            mock_ws.send_text = AsyncMock()
            session = Session(mock_ws)

            # 1. Not onboarded: should not trigger
            with patch("briefing.get_briefing") as mock_get_briefing:
                await session.maybe_trigger_briefing("test-thread", onboarding_complete=False)
                self.assertFalse(session._briefing_sent)
                mock_get_briefing.assert_not_called()

            # 2. Onboarded, but active provider is google with no key
            with patch("config.settings.ai_provider", "google"), \
                 patch("config.get_active_api_key", return_value=None), \
                 patch("briefing.get_briefing") as mock_get_briefing:
                await session.maybe_trigger_briefing("test-thread", onboarding_complete=True)
                self.assertFalse(session._briefing_sent)
                mock_get_briefing.assert_not_called()

            # 3. Setting updated to custom_openai: should trigger briefing!
            with patch("config.settings.ai_provider", "custom_openai"), \
                 patch("briefing.get_briefing") as mock_get_briefing:
                mock_briefing_inst = MagicMock()
                mock_briefing_inst.start_briefing = AsyncMock()
                mock_get_briefing.return_value = mock_briefing_inst

                await session.maybe_trigger_briefing("test-thread", onboarding_complete=True)
                self.assertTrue(session._briefing_sent)
                mock_get_briefing.assert_called_once()

            # 4. Calling again when _briefing_sent is True: must not trigger again
            with patch("briefing.get_briefing") as mock_get_briefing:
                await session.maybe_trigger_briefing("test-thread")
                mock_get_briefing.assert_not_called()

        asyncio.run(run_test())

if __name__ == "__main__":
    unittest.main()

