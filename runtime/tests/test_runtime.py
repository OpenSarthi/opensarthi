import unittest
import asyncio
from unittest.mock import Mock, AsyncMock, patch

from state_machine import AgentState, AgentStateContext
from planner.schemas import ToolResult, ToolResultConfidence, Plan, PlanStep
from tools.base import RiskLevel, BaseTool
from tools.registry import get, all_tools
from voice.wakeword import WakeWordDetector
from voice.stt import FasterWhisperSTT

class TestAgentStateMachine(unittest.TestCase):
    def test_initial_state(self):
        ctx = AgentStateContext()
        self.assertEqual(ctx.state, AgentState.IDLE)
        self.assertIsNone(ctx.current_goal)
        self.assertEqual(ctx.current_step_index, 0)

    def test_transitions(self):
        ctx = AgentStateContext()
        ctx.transition(AgentState.PLANNING, current_goal="Open firefox")
        self.assertEqual(ctx.state, AgentState.PLANNING)
        self.assertEqual(ctx.current_goal, "Open firefox")

        ctx.transition(AgentState.EXECUTING, current_step_index=1, current_step_description="Click button")
        self.assertEqual(ctx.state, AgentState.EXECUTING)
        self.assertEqual(ctx.current_step_index, 1)
        self.assertEqual(ctx.current_step_description, "Click button")

    def test_to_dict(self):
        ctx = AgentStateContext(
            state=AgentState.EXECUTING,
            current_goal="Test goal",
            current_step_index=2,
            current_step_description="Testing",
            total_steps=5,
            retry_count=1
        )
        data = ctx.to_dict()
        self.assertEqual(data["state"], "executing")
        self.assertEqual(data["goal"], "Test goal")
        self.assertEqual(data["step"], 2)
        self.assertEqual(data["total_steps"], 5)
        self.assertEqual(data["retry_count"], 1)


class TestSchemas(unittest.TestCase):
    def test_tool_result_ok(self):
        res = ToolResult.ok("Success message", ui_changed=True)
        self.assertTrue(res.success)
        self.assertEqual(res.observation, "Success message")
        self.assertTrue(res.ui_changed)
        self.assertEqual(res.confidence, ToolResultConfidence.MEDIUM)

    def test_tool_result_fail(self):
        res = ToolResult.fail("Error occurred", retryable=False)
        self.assertFalse(res.success)
        self.assertEqual(res.error, "Error occurred")
        self.assertFalse(res.retryable)


class TestToolRegistry(unittest.TestCase):
    def test_tools_registered(self):
        self.assertIsNotNone(get("click"))
        self.assertIsNotNone(get("type_text"))
        self.assertIsNotNone(get("shell"))
        self.assertIsNotNone(get("wait_for_window"))

        tools = all_tools()
        self.assertTrue(len(tools) >= 8)


class TestWakeWordDetector(unittest.TestCase):
    def test_phrase_cleaning(self):
        detector = WakeWordDetector([" Hey Sarthi  ", "Alexa"])
        self.assertIn("hey sarthi", detector.phrases)
        self.assertIn("alexa", detector.phrases)


class TestAsyncPrimitives(unittest.IsolatedAsyncioTestCase):
    @patch("asyncio.create_subprocess_exec")
    async def test_wait_for_process_success(self, mock_create):
        # Mock pgrep success
        mock_proc = AsyncMock()
        mock_proc.communicate.return_value = (b"1234\n", b"")
        mock_create.return_value = mock_proc

        from sync_primitives import wait_for_process
        result = await wait_for_process("firefox", timeout=1.0)
        self.assertTrue(result)

    async def test_poll_until_timeout(self):
        from sync_primitives import poll_until, TimeoutError
        
        async def false_condition():
            return False

        with self.assertRaises(TimeoutError):
            await poll_until(false_condition, timeout=0.2, interval=0.05)


class TestAgentRuntimeCumulativeSteps(unittest.TestCase):
    def test_cumulative_steps_formatting(self):
        from agent_runtime import AgentRuntime
        ws_mock = Mock()
        agent_mock = Mock()
        observer_mock = Mock()
        runtime = AgentRuntime(ws_handler=ws_mock, agent=agent_mock, observer=observer_mock)
        
        # Test formatting logic
        steps = [
            {"tool": "click", "description": "Clicking button", "status": "success"},
            {"tool": "type_text", "description": "Typing text", "status": "error", "error": "Failed to type"},
            {"tool": "shell", "description": "Running script", "status": "terminated"}
        ]
        
        res = runtime._format_final_response("Task processed", steps)
        self.assertIn("✓ Clicking button", res)
        self.assertIn("❌ Typing text (Reason: Failed to type)", res)
        self.assertIn("❌ Running script (Reason: Terminated)", res)
        self.assertIn("Task processed", res)


if __name__ == "__main__":
    unittest.main()
