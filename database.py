"""
ModelPilot — SQLite persistence layer
=====================================

Every completed request is logged to a local `modelpilot.db` (table: `logs`).
Connections are opened per operation and serialized with a lock because
FastAPI serves sync endpoints from a thread pool.

Schema:
    logs(id, created_at, prompt_snippet, full_prompt, prompt_words,
         routing_score, tier, model_selected, latency_ms,
         tokens_in, tokens_out, cost_usd)
"""

from __future__ import annotations

import sqlite3
import threading
from datetime import datetime
from pathlib import Path
from typing import Any

DB_PATH = Path(__file__).resolve().parent / "modelpilot.db"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS logs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at      TEXT    NOT NULL,
    prompt_snippet  TEXT    NOT NULL,
    full_prompt     TEXT    NOT NULL,
    prompt_words    INTEGER NOT NULL,
    routing_score   INTEGER NOT NULL,
    tier            INTEGER NOT NULL,
    model_selected  TEXT    NOT NULL,
    latency_ms      REAL    NOT NULL,
    tokens_in       INTEGER NOT NULL,
    tokens_out      INTEGER NOT NULL,
    cost_usd        REAL    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_logs_created_at ON logs (created_at DESC);
"""

_write_lock = threading.Lock()


def _raw_connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, timeout=10.0)
    conn.row_factory = sqlite3.Row
    return conn


def _connect() -> sqlite3.Connection:
    """Open a connection, self-healing the schema if the db file vanished.

    The table is normally created at startup (init_db), but if modelpilot.db
    is deleted while the server is running, SQLite silently recreates an
    empty file on the next connect — so recreate the schema here instead of
    letting requests fail with "no such table".
    """
    conn = _raw_connect()
    try:
        conn.execute("SELECT 1 FROM logs LIMIT 1").fetchall()
        return conn
    except sqlite3.OperationalError:
        conn.close()
        conn = _raw_connect()
        conn.executescript(_SCHEMA)  # CREATE IF NOT EXISTS — safe if raced
        return conn


def init_db() -> None:
    """Create the logs table (idempotent — safe on every startup)."""
    with _write_lock, _raw_connect() as conn:
        conn.executescript(_SCHEMA)


def insert_log(
    *,
    full_prompt: str,
    routing_score: int,
    tier: int,
    model_selected: str,
    latency_ms: float,
    tokens_in: int,
    tokens_out: int,
    cost_usd: float,
) -> int:
    """Persist one completed request; returns the new row id."""
    snippet = " ".join(full_prompt.split())[:120] or "(empty prompt)"
    created_at = datetime.now().astimezone().isoformat(timespec="seconds")
    with _write_lock, _connect() as conn:
        cursor = conn.execute(
            """
            INSERT INTO logs (
                created_at, prompt_snippet, full_prompt, prompt_words,
                routing_score, tier, model_selected, latency_ms,
                tokens_in, tokens_out, cost_usd
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                created_at,
                snippet,
                full_prompt,
                len(full_prompt.split()),
                routing_score,
                tier,
                model_selected,
                latency_ms,
                tokens_in,
                tokens_out,
                cost_usd,
            ),
        )
        return int(cursor.lastrowid or 0)


def _row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    record = dict(row)
    record.pop("full_prompt", None)  # keep payloads light for the dashboard
    return record


def get_recent_logs(limit: int = 20) -> list[dict[str, Any]]:
    """Newest-first request log (default: last 20)."""
    with _connect() as conn:
        rows = conn.execute(
            "SELECT * FROM logs ORDER BY id DESC LIMIT ?", (int(limit),)
        ).fetchall()
    return [_row_to_dict(row) for row in rows]


def get_aggregate_stats() -> dict[str, Any]:
    """Session-wide totals powering the dashboard header chips."""
    with _connect() as conn:
        totals = conn.execute(
            """
            SELECT COUNT(*)                AS total_requests,
                   COALESCE(SUM(tokens_in), 0)  AS total_tokens_in,
                   COALESCE(SUM(tokens_out), 0) AS total_tokens_out,
                   COALESCE(SUM(cost_usd), 0.0) AS total_cost_usd,
                   COALESCE(AVG(latency_ms), 0.0) AS avg_latency_ms
            FROM logs
            """
        ).fetchone()
        per_tier = {
            row["tier"]: row["requests"]
            for row in conn.execute(
                "SELECT tier, COUNT(*) AS requests FROM logs GROUP BY tier"
            ).fetchall()
        }
    return {
        "total_requests": int(totals["total_requests"]),
        "total_tokens_in": int(totals["total_tokens_in"]),
        "total_tokens_out": int(totals["total_tokens_out"]),
        "total_tokens": int(totals["total_tokens_in"]) + int(totals["total_tokens_out"]),
        "total_cost_usd": round(float(totals["total_cost_usd"]), 6),
        "avg_latency_ms": round(float(totals["avg_latency_ms"]), 1),
        "requests_per_tier": {str(tier): per_tier.get(tier, 0) for tier in (1, 2, 3)},
    }


if __name__ == "__main__":  # manual sanity check: python database.py
    init_db()
    new_id = insert_log(
        full_prompt="smoke test prompt",
        routing_score=42,
        tier=2,
        model_selected="meta/llama-3.1-70b-instruct",
        latency_ms=123.4,
        tokens_in=10,
        tokens_out=20,
        cost_usd=0.000012,
    )
    print("inserted id:", new_id)
    print("stats:", get_aggregate_stats())
