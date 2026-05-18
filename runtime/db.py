import sqlite3
import json
import uuid
from pathlib import Path
import os
import shutil

LOCAL_DEV_DB = os.path.join(os.path.dirname(__file__), "opensarthi.db")
USER_CONFIG_DIR = Path.home() / ".config" / "opensarthi"
USER_CONFIG_DIR.mkdir(parents=True, exist_ok=True)

DB_PATH = str(USER_CONFIG_DIR / "opensarthi.db")

# If local dev database exists but home database doesn't, migrate it so no history is lost!
if os.path.exists(LOCAL_DEV_DB) and not os.path.exists(DB_PATH):
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
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            thread_id TEXT,
            role TEXT,
            content TEXT,
            timestamp INTEGER,
            FOREIGN KEY(thread_id) REFERENCES threads(id)
        )
    ''')
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

def save_message(thread_id: str, msg_id: str, role: str, content: str, timestamp: int):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute(
        'INSERT INTO messages (id, thread_id, role, content, timestamp) VALUES (?, ?, ?, ?, ?)',
        (msg_id, thread_id, role, content, timestamp)
    )
    conn.commit()
    conn.close()

def get_history(thread_id: str):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('SELECT id, role, content, timestamp FROM messages WHERE thread_id = ? ORDER BY timestamp ASC', (thread_id,))
    rows = cursor.fetchall()
    conn.close()
    return [{"id": r[0], "role": r[1], "content": r[2], "timestamp": r[3]} for r in rows]

def get_all_threads():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('''
        SELECT t.id, t.created_at, m.content 
        FROM threads t 
        LEFT JOIN messages m ON t.id = m.thread_id 
        WHERE m.role = 'user'
        GROUP BY t.id
        ORDER BY t.created_at DESC
    ''')
    rows = cursor.fetchall()
    conn.close()
    return [{"id": r[0], "created_at": r[1], "first_message": r[2]} for r in rows]

init_db()
