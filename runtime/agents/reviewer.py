"""
ReviewerAgent — Self-improving post-task learner for OpenSarthi.

After every task run (success or failure), the Reviewer analyses the execution log
and writes concrete, actionable lessons to long-term memory.  These lessons are
auto-injected into the planner context on the next similar task, progressively
making the agent smarter over time.

Runs as a fire-and-forget asyncio task — never blocks the user response.
"""
import json
import asyncio
import structlog
from typing import Optional

logger = structlog.get_logger()


class ReviewerAgent:
    """
    Post-task reviewer that extracts reusable lessons and writes them to
    long-term memory (importance=0.9, source='self_review').
    """

    def __init__(self, model, deps):
        self.model = model
        self.deps = deps

    async def review_and_learn(
        self,
        goal: str,
        execution_log: list,
        outcome: str,
        memory_manager,
        ws_handler=None,
        thread_id: str = None,
        dev_logger=None,
    ) -> None:
        """
        Async fire-and-forget — call with asyncio.create_task().
        Extracts 0–3 lessons and stores them in long-term memory.
        """
        if not execution_log:
            return

        # Only review tasks that had actual tool calls
        tool_calls = [s for s in execution_log if s.get("tool")]
        if not tool_calls:
            return

        try:
            from pydantic_ai import Agent as PydanticAgent
            reviewer = PydanticAgent(model=self.model)

            log_summary = []
            for step in tool_calls[-10:]:  # Cap at last 10 steps
                status = step.get("status", "unknown")
                tool = step.get("tool", "")
                desc = step.get("description", tool)
                err = step.get("error", "")
                obs = step.get("result", "")
                entry = f"  [{status.upper()}] {desc} (tool={tool})"
                if err:
                    entry += f" — ERROR: {err[:100]}"
                elif obs:
                    entry += f" — RESULT: {str(obs)[:80]}"
                log_summary.append(entry)

            prompt = f"""You are a self-improvement module for an AI desktop agent.
Analyse this completed task and extract 1–3 reusable lessons for future tasks.

TASK GOAL: {goal[:200]}

EXECUTION LOG:
{chr(10).join(log_summary)}

FINAL OUTCOME: {outcome[:200]}

Extract ONLY lessons that are:
- Specific and actionable (not generic advice)
- About tool usage, timing, app behaviour, or UI quirks on Linux
- Things that would genuinely help next time

OUTPUT FORMAT — JSON array of strings (or empty array if no lesson):
["lesson 1", "lesson 2"]

Examples of good lessons:
- "Firefox address bar: click → Ctrl+L to select all → type URL → press Enter"
- "Dolphin file manager: always wait 1500ms after opening before clicking files"
- "YouTube volume slider: use keyboard (up/down arrow keys) — mouse drag unreliable"
- "Leafpad text editor app name on Garuda Linux is 'mousepad', not 'leafpad'"
"""
            if dev_logger:
                dev_logger.log("ReviewerAgent self-review lessons extraction started...")
                dev_logger.log(f"ReviewerAgent Prompt:\n{prompt}\n")
                try:
                    import os
                    filepath_prompt = os.path.join(dev_logger.run_dir, "reviewer_lessons_prompt.txt")
                    with open(filepath_prompt, "w", encoding="utf-8") as f:
                        f.write(prompt)
                except Exception as e:
                    dev_logger.log(f"Failed to log self-review prompt: {e}")

            result = await asyncio.wait_for(
                reviewer.run(prompt),
                timeout=25.0
            )
            raw = result.output.strip()

            if dev_logger:
                dev_logger.log(f"ReviewerAgent Raw Response:\n{raw}\n")
                try:
                    import os
                    filepath_res = os.path.join(dev_logger.run_dir, "reviewer_lessons_response.txt")
                    with open(filepath_res, "w", encoding="utf-8") as f:
                        f.write(raw)
                    dev_logger.log(f"Logged ReviewerAgent self-review lessons response. Extracted lessons: {raw}")
                except Exception as e:
                    dev_logger.log(f"Failed to log self-review response: {e}")

            if ws_handler:
                try:
                    await ws_handler.accumulate_and_update_tokens(result.usage, thread_id=thread_id)
                except Exception as e:
                    logger.debug("Failed to accumulate reviewer tokens", error=str(e))

            lessons = None
            try:
                lessons = json.loads(raw)
            except json.JSONDecodeError:
                start_idx = raw.find('[')
                end_idx = raw.rfind(']')
                if start_idx != -1 and end_idx != -1 and end_idx > start_idx:
                    try:
                        lessons = json.loads(raw[start_idx:end_idx+1])
                    except json.JSONDecodeError:
                        pass

            if not lessons or not isinstance(lessons, list):
                return

            stored = 0
            for lesson in lessons[:3]:  # Never store more than 3 lessons per task
                if not isinstance(lesson, str) or len(lesson.strip()) < 10:
                    continue
                await memory_manager.store(
                    content=lesson.strip(),
                    source="self_review",
                    importance=0.9,
                )
                stored += 1

            if stored:
                logger.info(
                    "ReviewerAgent stored lessons",
                    goal=goal[:60],
                    count=stored,
                )

        except asyncio.TimeoutError:
            logger.debug("ReviewerAgent timed out — skipping lesson extraction")
        except Exception as e:
            logger.debug("ReviewerAgent error", error=str(e))
