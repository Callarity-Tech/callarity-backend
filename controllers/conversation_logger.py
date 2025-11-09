# src/conversation_logger.py
import json
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional

class ConversationLogger:
    """
    Handles structured conversation logging in JSON format.
    Each log contains conversation_id, user_id, timestamps, and dialogue turns.
    """

    def __init__(self, user_id="unknown_user"):
        self.conversation_id = str(uuid.uuid4())
        self.user_id = user_id
        self.started_at = datetime.utcnow().isoformat()
        self.dialogue = []
        self.ended_at = None

        Path("logs").mkdir(exist_ok=True)
        self.file_path = Path(f"logs/conversation_{self.conversation_id}.json")

        # initialize the file with the base structure
        self._write_to_file()

    def _timestamp(self):
        return datetime.utcnow().isoformat()



    def add_turn(self, user_input: str, system_response: Optional[str] = None):
        """Add one dialogue turn (user says something, system optionally replies)."""
        turn = {
            "turn_id": len(self.dialogue) + 1,
            "timestamp": self._timestamp(),
            "user_input": user_input,
            "system_response": system_response or "",
        }
        self.dialogue.append(turn)
        self._write_to_file()

    def end_conversation(self):
        """Mark conversation as ended and save final file."""
        self.ended_at = datetime.utcnow().isoformat()
        self._write_to_file(final=True)

    def _write_to_file(self, final=False):
        """Write current state of the conversation to JSON."""
        data = {
            "conversation_id": self.conversation_id,
            "user_id": self.user_id,
            "started_at": self.started_at,
            "dialogue": self.dialogue,
            "ended_at": self.ended_at,
        }
        with open(self.file_path, "w", encoding="utf-8") as f:
            json.dump([data], f, indent=2)
