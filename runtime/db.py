import sqlite3
import json
import uuid
from pathlib import Path
import os
import shutil

LOCAL_DEV_DB = os.path.join(os.path.dirname(__file__), "opensarthi.db")
USER_CONFIG_DIR = Path.home() / ".config" / "opensarthi"
USER_CONFIG_DIR.mkdir(parents=True, exist_ok=True)

if os.environ.get("OPENSARTHI_TESTING") == "1":
    DB_PATH = os.path.join(os.path.dirname(__file__), "opensarthi_test.db")
else:
    DB_PATH = str(USER_CONFIG_DIR / "opensarthi.db")

# If local dev database exists but home database doesn't, migrate it so no history is lost!
if os.environ.get("OPENSARTHI_TESTING") != "1" and os.path.exists(LOCAL_DEV_DB) and not os.path.exists(DB_PATH):
    try:
        shutil.copy2(LOCAL_DEV_DB, DB_PATH)
    except Exception:
        pass

def init_db():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS threads (
            id TEXT PRIMARY KEY,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            token_request INTEGER DEFAULT 0,
            token_response INTEGER DEFAULT 0,
            token_total INTEGER DEFAULT 0
        )
    ''')
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            thread_id TEXT,
            role TEXT,
            content TEXT,
            timestamp INTEGER,
            token_request INTEGER DEFAULT 0,
            token_response INTEGER DEFAULT 0,
            token_total INTEGER DEFAULT 0,
            FOREIGN KEY(thread_id) REFERENCES threads(id)
        )
    ''')
    # Migrate: add token columns if they don't exist yet (for existing DBs)
    for col, default in [("token_request", 0), ("token_response", 0), ("token_total", 0)]:
        try:
            cursor.execute(f"ALTER TABLE threads ADD COLUMN {col} INTEGER DEFAULT {default}")
        except Exception:
            pass  # Column already exists
    for col, default in [("token_request", 0), ("token_response", 0), ("token_total", 0)]:
        try:
            cursor.execute(f"ALTER TABLE messages ADD COLUMN {col} INTEGER DEFAULT {default}")
        except Exception:
            pass  # Column already exists
    conn.commit()
    conn.close()

def create_thread() -> str:
    thread_id = str(uuid.uuid4())
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('INSERT INTO threads (id) VALUES (?)', (thread_id,))
    conn.commit()
    conn.close()
    return thread_id

def save_message(thread_id: str, msg_id: str, role: str, content: str, timestamp: int, request_tokens: int = 0, response_tokens: int = 0, total_tokens: int = 0):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('INSERT OR IGNORE INTO threads (id) VALUES (?)', (thread_id,))
    cursor.execute(
        'INSERT INTO messages (id, thread_id, role, content, timestamp, token_request, token_response, token_total) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        (msg_id, thread_id, role, content, timestamp, request_tokens, response_tokens, total_tokens)
    )
    conn.commit()
    conn.close()

def get_history(thread_id: str):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('SELECT id, role, content, timestamp, token_request, token_response, token_total FROM messages WHERE thread_id = ? ORDER BY timestamp ASC', (thread_id,))
    rows = cursor.fetchall()
    conn.close()
    return [{"id": r[0], "role": r[1], "content": r[2], "timestamp": r[3], "token_request": r[4] or 0, "token_response": r[5] or 0, "token_total": r[6] or 0} for r in rows]

def accumulate_thread_tokens(thread_id: str, request_tokens: int, response_tokens: int, total_tokens: int):
    """Add token counts from one response to the thread's running totals."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute(
        '''UPDATE threads
           SET token_request  = COALESCE(token_request, 0)  + ?,
               token_response = COALESCE(token_response, 0) + ?,
               token_total    = COALESCE(token_total, 0)    + ?
           WHERE id = ?''',
        (request_tokens, response_tokens, total_tokens, thread_id)
    )
    conn.commit()
    conn.close()

def get_thread_tokens(thread_id: str) -> dict:
    """Return the cumulative token usage for a thread."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('SELECT token_request, token_response, token_total FROM threads WHERE id = ?', (thread_id,))
    row = cursor.fetchone()
    conn.close()
    if row:
        return {"request_tokens": row[0] or 0, "response_tokens": row[1] or 0, "total_tokens": row[2] or 0}
    return {"request_tokens": 0, "response_tokens": 0, "total_tokens": 0}

def get_all_threads():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('''
        SELECT t.id, t.created_at,
               (SELECT content FROM messages WHERE thread_id = t.id AND role = 'user' ORDER BY timestamp ASC LIMIT 1) as first_message,
               t.token_total
        FROM threads t
        WHERE EXISTS (SELECT 1 FROM messages WHERE thread_id = t.id AND role = 'user')
        ORDER BY t.created_at DESC
    ''')
    rows = cursor.fetchall()
    conn.close()
    return [{"id": r[0], "created_at": r[1], "first_message": r[2], "token_total": r[3] or 0} for r in rows]

def delete_thread(thread_id: str):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('DELETE FROM messages WHERE thread_id = ?', (thread_id,))
    cursor.execute('DELETE FROM threads WHERE id = ?', (thread_id,))
    conn.commit()
    conn.close()

def delete_all_threads():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('DELETE FROM messages')
    cursor.execute('DELETE FROM threads')
    conn.commit()
    conn.close()

init_db()
