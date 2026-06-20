import unittest
from unittest.mock import Mock, AsyncMock, patch
import asyncio

from graph.state import OpenSarthiState
from graph.edges import (
    route_by_classification,
    route_after_plan,
    route_after_execute,
    route_after_heal,
    route_replan,
)
from graph.graph import build_graph, get_compiled_graph


class TestGraphRouting(unittest.TestCase):
    def test_route_by_classification(self):
        # Cancelled states should go to __end__
        state = OpenSarthiState(goal="test", is_cancelled=True)
        self.assertEqual(route_by_classification(state), "__end__")

        # Conversational / Clarify should go to chat
        state = OpenSarthiState(goal="test", classification="CHAT")
        self.assertEqual(route_by_classification(state), "chat")
        state = OpenSarthiState(goal="test", classification="CLARIFY")
        self.assertEqual(route_by_classification(state), "chat")

        # Tasks should go to observe
        state = OpenSarthiState(goal="test", classification="TASK")
        self.assertEqual(route_by_classification(state), "observe")

    def test_route_after_plan(self):
        state = OpenSarthiState(goal="test", is_cancelled=True)
        self.assertEqual(route_after_plan(state), "__end__")

        # If there are steps, execute them
        state = OpenSarthiState(goal="test", plan_steps=[{"tool": "click"}])
        self.assertEqual(route_after_plan(state), "execute")

        # No steps means text-only reply -> review
        state = OpenSarthiState(goal="test", plan_steps=[])
        self.assertEqual(route_after_plan(state), "review")

    def test_route_after_execute(self):
        state = OpenSarthiState(goal="test", is_cancelled=True)
        self.assertEqual(route_after_execute(state), "__end__")

        # Successful step, more steps remaining
        state = OpenSarthiState(
            goal="test",
            plan_steps=[{"tool": "click"}, {"tool": "type_text"}],
            current_step_index=1,
            last_tool_result={"success": True}
        )
        self.assertEqual(route_after_execute(state), "execute")

        # Successful step, last step completed
        state = OpenSarthiState(
            goal="test",
            plan_steps=[{"tool": "click"}],
            current_step_index=1,
            last_tool_result={"success": True}
        )
        self.assertEqual(route_after_execute(state), "review")

        # Step failed, retryable -> heal
        state = OpenSarthiState(
            goal="test",
            last_tool_result={"success": False, "retryable": True}
        )
        self.assertEqual(route_after_execute(state), "heal")

        # Step failed, non-retryable, retries remain -> replan
        state = OpenSarthiState(
            goal="test",
            retry_count=0,
            max_retries=3,
            last_tool_result={"success": False, "retryable": False}
        )
        self.assertEqual(route_after_execute(state), "replan")

    def test_route_after_heal(self):
        state = OpenSarthiState(goal="test", is_cancelled=True)
        self.assertEqual(route_after_heal(state), "__end__")

        # Retries remain -> retry execute
        state = OpenSarthiState(goal="test", retry_count=1, max_retries=3)
        self.assertEqual(route_after_heal(state), "execute")

        # Retries exhausted -> end
        state = OpenSarthiState(goal="test", retry_count=3, max_retries=3)
        self.assertEqual(route_after_heal(state), "__end__")

    def test_route_replan(self):
        state = OpenSarthiState(goal="test", is_cancelled=True)
        self.assertEqual(route_replan(state), "__end__")

        # Retries remain -> observe (start planning loop again)
        state = OpenSarthiState(goal="test", retry_count=1, max_retries=3)
        self.assertEqual(route_replan(state), "observe")

        # Retries exhausted -> end
        state = OpenSarthiState(goal="test", retry_count=3, max_retries=3)
        self.assertEqual(route_replan(state), "__end__")


class TestGraphCompilation(unittest.TestCase):
    def test_graph_build(self):
        workflow = build_graph()
        self.assertIsNotNone(workflow)
        self.assertIn("classify", workflow.nodes)
        self.assertIn("observe", workflow.nodes)
        self.assertIn("plan", workflow.nodes)
        self.assertIn("execute", workflow.nodes)
        self.assertIn("heal", workflow.nodes)
        self.assertIn("replan", workflow.nodes)
        self.assertIn("review", workflow.nodes)
        self.assertIn("chat", workflow.nodes)

    def test_graph_compile(self):
        compiled = get_compiled_graph(use_sqlite=False)
        self.assertIsNotNone(compiled)


if __name__ == "__main__":
    unittest.main()
