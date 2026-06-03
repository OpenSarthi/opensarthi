import unittest
import asyncio
from unittest.mock import AsyncMock, Mock, patch

from agents.classifier import classify_intent
from agents.orchestrator import OrchestratorAgent

class TestAgents(unittest.IsolatedAsyncioTestCase):
    @patch("agents.classifier.PydanticAgent")
    async def test_classify_intent_task(self, mock_agent_cls):
        # Mock PydanticAgent run output
        mock_agent = AsyncMock()
        mock_res = Mock()
        mock_res.output = "TASK"
        mock_agent.run.return_value = mock_res
        mock_agent_cls.return_value = mock_agent

        model_mock = Mock()
        classification = await classify_intent(model_mock, "Open Chrome and search for cat videos")
        self.assertEqual(classification, "TASK")
        mock_agent.run.assert_called_once_with("Open Chrome and search for cat videos")

    @patch("agents.classifier.PydanticAgent")
    async def test_classify_intent_chat(self, mock_agent_cls):
        # Mock PydanticAgent run output
        mock_agent = AsyncMock()
        mock_res = Mock()
        mock_res.output = "CHAT"
        mock_agent.run.return_value = mock_res
        mock_agent_cls.return_value = mock_agent

        model_mock = Mock()
        classification = await classify_intent(model_mock, "Explain how photosynthesis works")
        self.assertEqual(classification, "CHAT")
        mock_agent.run.assert_called_once_with("Explain how photosynthesis works")

    @patch("agents.orchestrator.classify_intent")
    @patch("llm.build_model")
    async def test_orchestrator_routing(self, mock_build_model, mock_classify):
        ws_mock = AsyncMock()
        model_mock = Mock()
        deps_mock = Mock()
        
        orchestrator = OrchestratorAgent(ws_handler=ws_mock, model=model_mock, deps=deps_mock)
        
        # Test simple chat routing
        mock_classify.return_value = "CHAT"
        classification, summarized = await orchestrator.route("What is the capital of France?", [], None)
        self.assertEqual(classification, "CHAT")
        self.assertIsNone(summarized)
        
        # Test task routing
        mock_classify.return_value = "TASK"
        classification, summarized = await orchestrator.route("Open chrome and search for cat videos", [], None)
        self.assertEqual(classification, "TASK")
        self.assertIsNone(summarized)

if __name__ == "__main__":
    unittest.main()
