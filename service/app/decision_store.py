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
    """One long-lived connection guarded by a lock (sqlite3.Connection is not
    thread-safe on its own; check_same_thread=False plus the lock lets
    FastAPI's threadpool-run sync handlers share it safely).
    """

    def __init__(self, path: str):
        self._conn = sqlite3.connect(path, check_same_thread=False)
        self._lock = threading.Lock()
        with self._lock:
            self._conn.execute(SCHEMA)
            self._conn.commit()

    def save(self, record: DecisionRecord) -> None:
        with self._lock:
            self._conn.execute(
                "INSERT INTO decision_records (report_hash, payload) VALUES (?, ?) "
                "ON CONFLICT(report_hash) DO UPDATE SET payload = excluded.payload",
                (record.report_hash, record.model_dump_json()),
            )
            self._conn.commit()

    def get(self, report_hash: str) -> DecisionRecord | None:
        with self._lock:
            row = self._conn.execute(
                "SELECT payload FROM decision_records WHERE report_hash = ?", (report_hash,)
            ).fetchone()
        if row is None:
            return None
        return DecisionRecord.model_validate_json(row[0])
