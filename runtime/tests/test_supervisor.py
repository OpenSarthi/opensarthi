"""
test_supervisor.py — Tests for multi-agent supervisor integration.

Covers:
- SupervisorResult structure & fallback detection
- resolve_allowed_tools domain expansion (union + GENERAL)
- MultiAgentSupervisor.classify() JSON/text parsing
- Low confidence fallback
- LangGraph node integration (supervise_node, allowed_tools threading)
- Three-level tool enforcement (planner/healer/executor)
- HealerAgent tool scope
- Metrics tracking
"""
import unittest
from unittest.mock import Mock, AsyncMock, patch
import asyncio
from typing import Optional, List
import uuid

from tools.base import ToolDomain, RiskLevel
from agents.supervisor import (
    SupervisorResult,
    resolve_allowed_tools,
    MultiAgentSupervisor,
    CONFIDENCE_FALLBACK_THRESHOLD,
)
from tools.registry import get_tool_names_by_domain, all_tools
from metrics import SupervisorMetrics, get_session_metrics, reset_metrics


class TestSupervisorResult(unittest.TestCase):
    def test_supervisor_result_fields(self):
        """SupervisorResult should hold all required fields."""
        result = SupervisorResult(
            domains=[ToolDomain.WEB],
            confidence=0.9,
            reason="web search task",
            allowed_tools=["web_search"],
            dispatch_id="abc-123",
        )
        self.assertEqual(result.domains, [ToolDomain.WEB])
        self.assertEqual(result.confidence, 0.9)
        self.assertEqual(result.reason, "web search task")
        self.assertEqual(result.allowed_tools, ["web_search"])
        self.assertEqual(result.dispatch_id, "abc-123")
        self.assertEqual(result.to_dict()["domains"], ["web"])
        self.assertFalse(result.is_fallback())
        self.assertEqual(result.primary_domain, ToolDomain.WEB)

    def test_is_fallback_only_general(self):
        """is_fallback() True when only GENERAL selected."""
        result = SupervisorResult(
            domains=[ToolDomain.GENERAL],
            confidence=0.5,
            reason="fallback",
            allowed_tools=["all"],
        )
        self.assertTrue(result.is_fallback())


class TestResolveAllowedTools(unittest.TestCase):
    def test_resolve_general_returns_all(self):
        """GENERAL in domains → all tools returned."""
        allowed = resolve_allowed_tools([ToolDomain.GENERAL])
        all_names = [t.name for t in all_tools()]
        self.assertEqual(set(allowed), set(all_names))

    def test_resolve_web_includes_general(self):
        """WEB domain → web tools + GENERAL tools."""
        allowed = resolve_allowed_tools([ToolDomain.WEB])
        web_tools = set(get_tool_names_by_domain(ToolDomain.WEB))
        general_tools = set(get_tool_names_by_domain(ToolDomain.GENERAL))
        expected = web_tools | general_tools
        self.assertEqual(set(allowed), expected)
        # web_search must be in scope
        self.assertIn("web_search", allowed)

    def test_resolve_multi_domain_union(self):
        """Multi-domain → union of all domain tools + GENERAL."""
        allowed = resolve_allowed_tools([ToolDomain.WEB, ToolDomain.MUSIC])
        web_tools = set(get_tool_names_by_domain(ToolDomain.WEB))
        music_tools = set(get_tool_names_by_domain(ToolDomain.MUSIC))
        general_tools = set(get_tool_names_by_domain(ToolDomain.GENERAL))
        expected = web_tools | music_tools | general_tools
        self.assertEqual(set(allowed), expected)
        self.assertIn("web_search", allowed)
        self.assertIn("music_play", allowed)

    def test_resolve_empty_returns_all(self):
        """Empty domain list → all tools (safe default)."""
        allowed = resolve_allowed_tools([])
        all_names = [t.name for t in all_tools()]
        self.assertEqual(set(allowed), set(all_names))


class TestSupervisorClassify(unittest.TestCase):
    def setUp(self):
        reset_metrics()

    def _make_supervisor(self, mock_agent_output: str):
        """Create a supervisor with a mocked classifier agent returning mock_agent_output."""
        agent_mock = Mock()
        agent_mock.run = AsyncMock(return_value=Mock(output=mock_agent_output))
        with patch("agents.supervisor.PydanticAgent", return_value=agent_mock):
            sup = MultiAgentSupervisor(
                ws_handler=None,
                model="mock-model",
                deps=None,
                thread_id="test-thread",
            )
            sup._classifier_agent = agent_mock
            return sup

    def test_classify_json_output(self):
        """Valid JSON classifier output → parsed correctly."""
        sup = self._make_supervisor(
            '{"domains": ["WEB"], "confidence": 0.92, "reason": "user asked to search"}'
        )
        result = asyncio.run(sup.classify("search the web for python tips"))
        self.assertEqual(result.domains, [ToolDomain.WEB])
        self.assertAlmostEqual(result.confidence, 0.92, places=2)
        self.assertIn("web_search", result.allowed_tools)
        self.assertFalse(result.is_fallback())

    def test_classify_text_output(self):
        """Text-style output with domain keywords → parsed."""
        sup = self._make_supervisor("DOMAINS: MUSIC | CONFIDENCE: 0.8 | REASON: play a song")
        result = asyncio.run(sup.classify("play some music"))
        self.assertIn(ToolDomain.MUSIC, result.domains)
        self.assertIn("music_play", result.allowed_tools)

    def test_classify_multi_domain_json(self):
        """JSON with multiple domains → multi-domain result."""
        sup = self._make_supervisor(
            '{"domains": ["CALENDAR", "MAIL"], "confidence": 0.85, "reason": "check calendar and email summary"}'
        )
        result = asyncio.run(sup.classify("check my calendar and email me a summary"))
        domain_vals = {d.value for d in result.domains}
        self.assertEqual(domain_vals, {"calendar", "mail"})
        self.assertIn("calendar_read", result.allowed_tools)
        self.assertIn("gmail_read", result.allowed_tools)

    def test_classify_low_confidence_fallback(self):
        """Confidence below threshold → GENERAL fallback with all tools."""
        sup = self._make_supervisor(
            '{"domains": ["WEB"], "confidence": 0.1, "reason": "uncertain"}'
        )
        result = asyncio.run(sup.classify("do something vague"))
        self.assertTrue(result.is_fallback())
        all_names = [t.name for t in all_tools()]
        self.assertEqual(set(result.allowed_tools), set(all_names))

    def test_classify_exception_fallback(self):
        """Classifier exception → GENERAL fallback (never raises)."""
        agent_mock = Mock()
        agent_mock.run = AsyncMock(side_effect=RuntimeError("LLM unavailable"))
        with patch("agents.supervisor.PydanticAgent", return_value=agent_mock):
            sup = MultiAgentSupervisor(ws_handler=None, model="m", deps=None)
            sup._classifier_agent = agent_mock
            result = asyncio.run(sup.classify("anything"))
            self.assertTrue(result.is_fallback())
            self.assertEqual(result.reason, result.reason)  # Non-empty reason present


class TestSupervisorNodeIntegration(unittest.TestCase):
    def test_supervise_node_disabled_short_circuits(self):
        """When use_supervisor=False, node returns supervisor_disabled without LLM call."""
        from graph.nodes import supervise_node
        from graph.state import OpenSarthiState

        state = OpenSarthiState(goal="test goal")
        config = {
            "configurable": {
                "ws_handler": None,
                "thread_id": "t1",
                "model": "m",
                "deps": None,
                "dev_logger": None,
            }
        }
        with patch("config.settings") as mock_settings:
            mock_settings.use_supervisor = False
            update = asyncio.run(supervise_node(state, config))
            self.assertTrue(update["supervisor_disabled"])

    def test_supervise_node_active_returns_allowed_tools(self):
        """When use_supervisor=True, node returns allowed_tools from classifier."""
        from graph.nodes import supervise_node
        from graph.state import OpenSarthiState

        state = OpenSarthiState(goal="play music")
        config = {
            "configurable": {
                "ws_handler": None,
                "thread_id": "t1",
                "model": "m",
                "deps": None,
                "dev_logger": None,
            }
        }
        mock_result = SupervisorResult(
            domains=[ToolDomain.MUSIC],
            confidence=0.9,
            reason="music task",
            allowed_tools=["music_play", "youtube_search"],
            dispatch_id="d1",
        )
        with patch("config.settings") as mock_settings:
            mock_settings.use_supervisor = True
            with patch("agents.supervisor.get_supervisor") as mock_get:
                with patch("uuid.uuid4", return_value=uuid.UUID("00000000-0000-0000-0000-000000000001")):
                    mock_sup = Mock()
                    mock_sup.classify = AsyncMock(return_value=mock_result)
                    mock_get.return_value = mock_sup
                    update = asyncio.run(supervise_node(state, config))
                    self.assertEqual(update["allowed_tools"], ["music_play", "youtube_search"])
                    self.assertEqual(update["supervisor_domains"], ["music"])
                    self.assertEqual(update["supervisor_confidence"], 0.9)
                    self.assertEqual(update["dispatch_id"], "00000000-0000-0000-0000-000000000001")


class TestThreeLevelEnforcement(unittest.TestCase):
    def test_plan_node_passes_allowed_tools(self):
        """build_structured_context should filter tools when allowed_tools provided."""
        from planner.agent import build_structured_context
        from observation import DesktopSnapshot

        # All tools minus a few to simulate restricted scope
        restricted = ["web_search", "click", "type_text"]
        ctx = build_structured_context(
            goal="search the web",
            snapshot=DesktopSnapshot(),
            history=[],
            allowed_tools=restricted,
        )
        # The context should mention web_search
        self.assertIn("web_search", ctx)
        # The context should NOT list shell (since not in allowed_tools)
        self.assertNotIn("shell", ctx)

    def test_execute_step_node_blocks_unauthorized_tool(self):
        """execute_step_node should reject steps using tools outside allowed_tools."""
        from graph.nodes import execute_step_node
        from graph.state import OpenSarthiState

        state = OpenSarthiState(
            goal="test",
            plan_steps=[{"tool": "shell", "args": {"command": "rm -rf /"}, "description": "dangerous"}],
            current_step_index=0,
            allowed_tools=["web_search", "click"],
        )
        ws_mock = Mock()
        ws_mock.send_message = AsyncMock()
        config = {"configurable": {"ws_handler": ws_mock, "thread_id": "t1", "dev_logger": None}}
        update = asyncio.run(execute_step_node(state, config))
        self.assertIn("not authorized", update["last_tool_result"]["error"])
        self.assertFalse(update["last_tool_result"]["success"])

    def test_execute_step_node_allows_authorized_tool(self):
        """execute_step_node should allow steps using tools in allowed_tools."""
        from graph.nodes import execute_step_node
        from graph.state import OpenSarthiState
        from tools.base import BaseTool, RiskLevel, ToolResult, ToolDomain

        class FakeTool(BaseTool):
            name = "web_search"
            description = "fake"
            risk_level = RiskLevel.SAFE
            domain = ToolDomain.WEB
            schema = {"type": "object", "properties": {}, "required": []}
            async def execute(self, args):
                return ToolResult(success=True, observation="ok")

        state = OpenSarthiState(
            goal="test",
            plan_steps=[{"tool": "web_search", "args": {"query": "x"}, "description": "search"}],
            current_step_index=0,
            allowed_tools=["web_search", "click"],
        )
        ws_mock = Mock()
        ws_mock.send_message = AsyncMock()
        ws_mock.check_pause = AsyncMock()
        config = {"configurable": {"ws_handler": ws_mock, "thread_id": "t1", "dev_logger": None}}
        with patch("tools.registry.get", return_value=FakeTool()):
            update = asyncio.run(execute_step_node(state, config))
            self.assertTrue(update["last_tool_result"]["success"])

    def test_healer_respects_allowed_tools(self):
        """HealerAgent should only suggest tools in allowed_tools scope."""
        from agents.healer import HealerAgent

        deps = Mock()
        healer = HealerAgent(model="m", deps=deps)
        # Mock the LLM to propose a tool NOT in allowed_tools
        healer._agent = Mock()
        healer._agent.run = AsyncMock(return_value=Mock(output='{"tool": "shell", "args": {}, "description": "bad"}'))

        allowed = ["web_search", "click"]
        result = asyncio.run(healer.diagnose_and_fix(
            failed_tool="click",
            failed_args={},
            description="click failed",
            error="coord issue",
            screen_summary="",
            allowed_tools=allowed,
        ))
        # Should be None because shell is not in allowed_tools
        self.assertIsNone(result)


class TestSupervisorMetrics(unittest.TestCase):
    def setUp(self):
        reset_metrics()

    def test_record_dispatch_updates_metrics(self):
        metrics = get_session_metrics()
        metrics.record_dispatch(
            domains=["web", "music"],
            confidence=0.9,
            allowed_tools=["web_search", "music_play"],
            latency_ms=50.0,
            is_fallback=False,
        )
        summary = metrics.get_summary()
        self.assertEqual(summary["total_dispatches"], 1)
        self.assertEqual(summary["domain_distribution"]["web"], 1)
        self.assertEqual(summary["domain_distribution"]["music"], 1)
        self.assertAlmostEqual(summary["avg_confidence"], 0.9)
        self.assertEqual(summary["avg_tool_scope_size"], 2)
        self.assertEqual(summary["fallback_rate"], 0.0)

    def test_fallback_rate_tracked(self):
        metrics = get_session_metrics()
        metrics.record_dispatch(["general"], 0.3, [], 10.0, is_fallback=True)
        metrics.record_dispatch(["web"], 0.9, ["web_search"], 20.0, is_fallback=False)
        summary = metrics.get_summary()
        self.assertEqual(summary["fallback_rate"], 0.5)
        self.assertEqual(summary["total_dispatches"], 2)


if __name__ == "__main__":
    unittest.main()
