"""
ModelPilot — SQLite persistence layer
=====================================

Every completed request is logged to a local `modelpilot.db` (table: `logs`).
Connections are opened per operation and serialized with a lock because
FastAPI serves sync endpoints from a thread pool.
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
    cost_usd        REAL    NOT NULL,
    favorites       INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_logs_created_at ON logs (created_at DESC);

CREATE TABLE IF NOT EXISTS prompt_history (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at      TEXT    NOT NULL,
    full_prompt     TEXT    NOT NULL,
    routing_score   INTEGER NOT NULL,
    tier            INTEGER NOT NULL,
    model_selected  TEXT    NOT NULL,
    use_count       INTEGER DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_history_created_at ON prompt_history (created_at DESC);
"""

_write_lock = threading.Lock()


def _raw_connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, timeout=10.0)
    conn.row_factory = sqlite3.Row
    return conn


def _connect() -> sqlite3.Connection:
    conn = _raw_connect()
    try:
        conn.execute("SELECT 1 FROM logs LIMIT 1").fetchall()
        conn.execute("SELECT 1 FROM prompt_history LIMIT 1").fetchall()
        return conn
    except sqlite3.OperationalError:
        conn.close()
        conn = _raw_connect()
        conn.executescript(_SCHEMA)
        return conn


def init_db() -> None:
    with _write_lock, _raw_connect() as conn:
        conn.executescript(_SCHEMA)
        # Migration: add favorites column if missing
        try:
            conn.execute("SELECT favorites FROM logs LIMIT 1")
        except sqlite3.OperationalError:
            conn.execute("ALTER TABLE logs ADD COLUMN favorites INTEGER DEFAULT 0")


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
    record.pop("full_prompt", None)
    return record


def _row_to_dict_full(row: sqlite3.Row) -> dict[str, Any]:
    return dict(row)


def get_recent_logs(limit: int = 20) -> list[dict[str, Any]]:
    with _connect() as conn:
        rows = conn.execute(
            "SELECT * FROM logs ORDER BY id DESC LIMIT ?", (int(limit),)
        ).fetchall()
    return [_row_to_dict(row) for row in rows]


def get_aggregate_stats() -> dict[str, Any]:
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


# --- Favorites ---

def toggle_favorite(log_id: int) -> bool:
    with _write_lock, _connect() as conn:
        row = conn.execute("SELECT favorites FROM logs WHERE id = ?", (log_id,)).fetchone()
        if not row:
            return False
        new_val = 0 if row["favorites"] else 1
        conn.execute("UPDATE logs SET favorites = ? WHERE id = ?", (new_val, log_id))
        return bool(new_val)


def get_favorites() -> list[dict[str, Any]]:
    with _connect() as conn:
        rows = conn.execute(
            "SELECT * FROM logs WHERE favorites = 1 ORDER BY id DESC LIMIT 50"
        ).fetchall()
    return [_row_to_dict(row) for row in rows]


# --- Prompt History ---

def save_prompt_history(
    *,
    full_prompt: str,
    routing_score: int,
    tier: int,
    model_selected: str,
) -> int:
    created_at = datetime.now().astimezone().isoformat(timespec="seconds")
    with _write_lock, _connect() as conn:
        existing = conn.execute(
            "SELECT id, use_count FROM prompt_history WHERE full_prompt = ?",
            (full_prompt.strip(),),
        ).fetchone()
        if existing:
            conn.execute(
                "UPDATE prompt_history SET use_count = ?, routing_score = ?, tier = ?, model_selected = ? WHERE id = ?",
                (existing["use_count"] + 1, routing_score, tier, model_selected, existing["id"]),
            )
            return existing["id"]
        cursor = conn.execute(
            """
            INSERT INTO prompt_history (created_at, full_prompt, routing_score, tier, model_selected)
            VALUES (?, ?, ?, ?, ?)
            """,
            (created_at, full_prompt.strip(), routing_score, tier, model_selected),
        )
        return int(cursor.lastrowid or 0)


def get_prompt_history(limit: int = 50) -> list[dict[str, Any]]:
    with _connect() as conn:
        rows = conn.execute(
            "SELECT id, created_at, full_prompt, routing_score, tier, model_selected, use_count FROM prompt_history ORDER BY use_count DESC, id DESC LIMIT ?",
            (int(limit),),
        ).fetchall()
    return [dict(row) for row in rows]


def search_prompt_history(query: str, limit: int = 20) -> list[dict[str, Any]]:
    with _connect() as conn:
        rows = conn.execute(
            "SELECT id, created_at, full_prompt, routing_score, tier, model_selected, use_count FROM prompt_history WHERE full_prompt LIKE ? ORDER BY use_count DESC LIMIT ?",
            (f"%{query}%", int(limit)),
        ).fetchall()
    return [dict(row) for row in rows]


if __name__ == "__main__":
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
