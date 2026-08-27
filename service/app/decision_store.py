"""SQLite-backed Decision Record persistence.

Written in phases (pending -> processing -> completed/gitea_call_failed) so
a repeated POST of the same Raw Report can check for a prior record by
report hash before doing any LLM or Gitea work.
"""

from __future__ import annotations

import sqlite3
import threading

from app.schemas import DecisionRecord

SCHEMA = """
CREATE TABLE IF NOT EXISTS decision_records (
    report_hash TEXT PRIMARY KEY,
    payload TEXT NOT NULL
);
"""


class SqliteDecisionStore:
    def __init__(self, path: str):
        self._path = path
        self._lock = threading.Lock()
        conn = self._connect()
        try:
            conn.execute(SCHEMA)
            conn.commit()
        finally:
            conn.close()

    def _connect(self) -> sqlite3.Connection:
        return sqlite3.connect(self._path, check_same_thread=False)

    def save(self, record: DecisionRecord) -> None:
        with self._lock, self._connect() as conn:
            conn.execute(
                "INSERT INTO decision_records (report_hash, payload) VALUES (?, ?) "
                "ON CONFLICT(report_hash) DO UPDATE SET payload = excluded.payload",
                (record.report_hash, record.model_dump_json()),
            )

    def get(self, report_hash: str) -> DecisionRecord | None:
        with self._lock, self._connect() as conn:
            row = conn.execute(
                "SELECT payload FROM decision_records WHERE report_hash = ?", (report_hash,)
            ).fetchone()
        if row is None:
            return None
        return DecisionRecord.model_validate_json(row[0])
