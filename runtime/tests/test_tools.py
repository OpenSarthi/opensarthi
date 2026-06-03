import unittest
import asyncio
import os
import shutil
import tempfile
from unittest.mock import patch, AsyncMock, MagicMock

from tools.notes import SaveNoteTool, GetNotesTool
from tools.system import ShellTool

class TestTools(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        # Create a temporary directory for notes
        self.test_dir = tempfile.mkdtemp()
        self.patcher = patch('tools.notes.NOTES_DIR', self.test_dir)
        self.patcher.start()

    def tearDown(self):
        self.patcher.stop()
        shutil.rmtree(self.test_dir)

    async def test_save_note_tool(self):
        tool = SaveNoteTool()
        
        # Test missing title
        res = await tool.execute({"content": "hello"})
        self.assertFalse(res.success)
        self.assertIn("Missing title", res.error)
        
        # Test success
        res = await tool.execute({"title": "Test Note", "content": "This is a test note."})
        self.assertTrue(res.success)
        
        # Verify file creation
        expected_path = os.path.join(self.test_dir, "Test_Note.md")
        self.assertTrue(os.path.exists(expected_path))
        with open(expected_path, "r") as f:
            content = f.read()
            self.assertIn("# Test Note", content)
            self.assertIn("This is a test note.", content)

    async def test_get_notes_tool(self):
        save_tool = SaveNoteTool()
        get_tool = GetNotesTool()
        
        # Setup: create two notes
        await save_tool.execute({"title": "apple recipe", "content": "buy apples and bake pie"})
        await save_tool.execute({"title": "banana recipe", "content": "buy bananas and make bread"})
        
        # Search by query
        res = await get_tool.execute({"query": "apple"})
        self.assertTrue(res.success)
        self.assertIn("Apple Recipe", res.observation)
        self.assertNotIn("Banana Recipe", res.observation)
        
        # Get all notes
        res2 = await get_tool.execute({})
        self.assertTrue(res2.success)
        self.assertIn("Apple Recipe", res2.observation)
        self.assertIn("Banana Recipe", res2.observation)

    @patch('tools.system.is_blocked')
    async def test_shell_tool_blocked(self, mock_is_blocked):
        tool = ShellTool()
        mock_is_blocked.return_value = (True, "rm -rf is dangerous")
        
        res = await tool.execute({"command": "rm -rf /"})
        self.assertFalse(res.success)
        self.assertIn("Blocked dangerous command", res.error)

    @patch('tools.system.is_blocked')
    @patch('asyncio.create_subprocess_shell')
    async def test_shell_tool_success(self, mock_subprocess, mock_is_blocked):
        mock_is_blocked.return_value = (False, "")
        
        # Mock the subprocess
        mock_proc = AsyncMock()
        mock_proc.wait.return_value = 0
        
        # Mock stdout and stderr streams
        async def mock_stdout():
            yield b"hello world\n"
        async def mock_stderr():
            return
            yield
            
        mock_proc.stdout = mock_stdout()
        mock_proc.stderr = mock_stderr()
        mock_subprocess.return_value = mock_proc
        
        tool = ShellTool()
        res = await tool.execute({"command": "echo hello world"})
        self.assertTrue(res.success)
        self.assertEqual(res.observation.strip(), "hello world")

if __name__ == "__main__":
    unittest.main()
