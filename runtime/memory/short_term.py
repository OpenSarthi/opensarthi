from typing import List, Dict, Any
import db

class ShortTermMemory:
    """
    Manages short-term conversation memory by wrapping database history.
    """

    def __init__(self, thread_id: str):
        self.thread_id = thread_id

    def add(self, entry) -> None:
        """Normally handled by db.save_message directly."""
        pass

    def get_recent(self, max_messages: int = 20) -> List[Dict[str, Any]]:
        """Retrieve recent messages for context."""
        history = db.get_history(self.thread_id)
        if len(history) > max_messages:
            return history[-max_messages:]
        return history
