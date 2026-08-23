"""
ModelPilot — Cost-Aware Multi-Model AI Routing System
=====================================================

FastAPI backend that scores every prompt for complexity, routes it to the
cheapest capable NVIDIA-hosted model (via the OpenAI SDK against NIM),
tracks latency/tokens/cost, and logs each request to a local SQLite DB.

How to run
----------
    pip install -r requirements.txt
    uvicorn main:app --reload

Then open http://127.0.0.1:8000
"""

from __future__ import annotations

import json
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

import config
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

import database
from nvidia_client import NVIDIAAuthError, NVIDIARequestError, generate, generate_stream
from router import DifficultyRouter

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"

# Routing engine. To swap in a trained model later:
#   DifficultyRouter(model_path="router_model.pkl")
ROUTER = DifficultyRouter()


@asynccontextmanager
async def lifespan(_: FastAPI):
    database.init_db()
    yield


app = FastAPI(title="ModelPilot", version="1.0.0", description="Cost-aware multi-model AI routing", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class RouteRequest(BaseModel):
    api_key: Optional[str] = Field(
        default=None,
        description="Optional per-request override; falls back to the server-side key in config.py",
    )
    prompt: str = Field(..., min_length=1, max_length=32_000, description="The prompt to route")


class RouteResponse(BaseModel):
    response: str
    routing_score: int
    model_selected: str
    tier: int
    latency_ms: float
    tokens_in: int
    tokens_out: int
    cost_usd: float


# ---------------------------------------------------------------------------
# API endpoints
# ---------------------------------------------------------------------------


@app.post("/api/route", response_model=RouteResponse)
def route_prompt(payload: RouteRequest) -> RouteResponse:
    """Score the prompt, call the selected NVIDIA model, log and return."""
    prompt = payload.prompt.strip()
    api_key = (payload.api_key or "").strip() or (config.NVIDIA_API_KEY or "").strip()
    if not api_key:
        raise HTTPException(
            status_code=400,
            detail="No API key configured. Set NVIDIA_API_KEY in config.py and restart.",
        )

    decision = ROUTER.route(prompt)

    started = time.perf_counter()
    try:
        result = generate(api_key=api_key, model_id=decision.model.model_id, prompt=prompt)
    except NVIDIAAuthError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    except NVIDIARequestError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    latency_ms = (time.perf_counter() - started) * 1000.0

    total_tokens = result.tokens_in + result.tokens_out
    cost_usd = decision.model.price_per_mtok * total_tokens / 1_000_000.0

    database.insert_log(
        full_prompt=prompt,
        routing_score=decision.score,
        tier=decision.tier,
        model_selected=decision.model.model_id,
        latency_ms=latency_ms,
        tokens_in=result.tokens_in,
        tokens_out=result.tokens_out,
        cost_usd=cost_usd,
    )

    return RouteResponse(
        response=result.text,
        routing_score=decision.score,
        model_selected=decision.model.model_id,
        tier=decision.tier,
        latency_ms=round(latency_ms, 2),
        tokens_in=result.tokens_in,
        tokens_out=result.tokens_out,
        cost_usd=round(cost_usd, 6),
    )


@app.post("/api/route/stream")
def route_prompt_stream(payload: RouteRequest) -> StreamingResponse:
    """Streaming variant of /api/route (SSE): meta -> deltas -> done.

    Lets the UI render tokens as they generate — critical for slower NIM
    models where a full answer can take well over a minute.
    """
    prompt = payload.prompt.strip()
    api_key = (payload.api_key or "").strip() or (config.NVIDIA_API_KEY or "").strip()
    if not api_key:
        raise HTTPException(
            status_code=400,
            detail="No API key configured. Set NVIDIA_API_KEY in config.py and restart.",
        )

    decision = ROUTER.route(prompt)

    def sse(event: dict) -> str:
        return f"data: {json.dumps(event)}\n\n"

    def event_stream():
        yield sse(
            {
                "type": "meta",
                "routing_score": decision.score,
                "tier": decision.tier,
                "model_selected": decision.model.model_id,
                "model_name": decision.model.label,
            }
        )
        for event in generate_stream(api_key=api_key, model_id=decision.model.model_id, prompt=prompt):
            if event["type"] == "done":
                total_tokens = event["tokens_in"] + event["tokens_out"]
                cost_usd = decision.model.price_per_mtok * total_tokens / 1_000_000.0
                database.insert_log(
                    full_prompt=prompt,
                    routing_score=decision.score,
                    tier=decision.tier,
                    model_selected=decision.model.model_id,
                    latency_ms=event["latency_ms"],
                    tokens_in=event["tokens_in"],
                    tokens_out=event["tokens_out"],
                    cost_usd=cost_usd,
                )
                yield sse(
                    {
                        "type": "done",
                        "text": event["text"],
                        "routing_score": decision.score,
                        "model_selected": decision.model.model_id,
                        "tier": decision.tier,
                        "latency_ms": event["latency_ms"],
                        "tokens_in": event["tokens_in"],
                        "tokens_out": event["tokens_out"],
                        "cost_usd": round(cost_usd, 6),
                    }
                )
            else:
                yield sse(event)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/api/logs")
def recent_logs(limit: int = 20) -> list[dict]:
    """Last N logged requests (newest first) for the dashboard table."""
    clamped = max(1, min(limit, 100))
    return database.get_recent_logs(limit=clamped)


@app.get("/api/stats")
def aggregate_stats() -> dict:
    """Totals for the dashboard header (requests, tokens, spend, tier mix)."""
    return database.get_aggregate_stats()


@app.get("/api/key-status")
def key_status() -> dict:
    """Tell the UI whether a server-side key is active (masked, never full)."""
    key = (config.NVIDIA_API_KEY or "").strip()
    masked = f"{key[:10]}…{key[-4:]}" if len(key) > 16 else "•••"
    return {"configured": bool(key), "masked": masked if key else ""}


@app.get("/")
def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")
