"""
ModelPilot — DifficultyRouter
=============================

The routing brain of ModelPilot. Scores every prompt on a 0-100 difficulty
scale and maps the score to the cheapest capable model tier:

    Score  0-33  ->  Tier 1  (openai/gpt-oss-20b)                 $0.10 / 1M tokens
    Score 34-66  ->  Tier 2  (meta/llama-3.1-70b-instruct)          $0.40 / 1M tokens
    Score 67-100 ->  Tier 3  (meta/llama-3.1-70b-instruct)          $0.80 / 1M tokens

Core scoring rules (heuristic v1):
    +20  prompt longer than 500 words            (extended context)
    +30  contains code blocks / programming keywords
    +20  asks for JSON or other strict formatting constraints
    +15  complex-reasoning keywords ("explain why", "analyze", "compare", ...)
    Supplementary granularity signals that refine the same scale:
    +10  prompt longer than 200 words            (medium context)
     +8  explicit fenced code blocks (```), on top of keyword matches
     +8  three or more *distinct* reasoning signals (deep multi-step analysis)

The score is capped at 100.

Swapping in a trained model: `DifficultyRouter(model_path="router_model.pkl")`
will load a pickled estimator (e.g. a fitted XGBoost pipeline) and call
`predict()` on the numeric feature vector produced by `extract_features()`.
The feature contract is declared in `_FEATURE_ORDER`, so a training job simply
has to produce the same columns. If the pickle is missing or fails to load,
the router transparently falls back to the heuristic engine.
"""

from __future__ import annotations

import os
import pickle
import re
from dataclasses import dataclass, field
from typing import Any, Callable, Optional

# ---------------------------------------------------------------------------
# Model registry (routing policy layer — nvidia_client.py is pure transport)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ModelSpec:
    """A routable model and its (dummy) per-1M-token price."""

    tier: int
    model_id: str
    label: str
    price_per_mtok: float
    blurb: str


MODEL_REGISTRY: dict[int, ModelSpec] = {
    1: ModelSpec(
        tier=1,
        model_id="openai/gpt-oss-20b",
        label="GPT-OSS 20B",
        price_per_mtok=0.10,
        blurb="Fast & frugal — everyday questions, drafts, lookups",
    ),
    2: ModelSpec(
        tier=2,
        model_id="meta/llama-3.1-70b-instruct",
        label="Llama 3.1 70B",
        price_per_mtok=0.40,
        blurb="Balanced — structured output, code helpers, summaries",
    ),
    3: ModelSpec(
        tier=3,
        model_id="meta/llama-3.1-70b-instruct",
        label="Llama 3.1 70B (Deep)",
        price_per_mtok=0.80,
        blurb="Deep reasoning — debugging, architecture, trade-off analysis",
    ),
}

# Score bands -> tier (0-33 / 34-66 / 67-100)
TIER_THRESHOLDS: tuple[tuple[int, int, int], ...] = ((0, 33, 1), (34, 66, 2), (67, 100, 3))


@dataclass
class Signal:
    """One scoring rule and whether it fired for a given prompt."""

    key: str
    label: str
    points: int
    matched: bool


@dataclass
class RoutingDecision:
    """Everything the API layer needs after routing a prompt."""

    score: int
    tier: int
    model: ModelSpec
    signals: list[Signal] = field(default_factory=list)
    engine: str = "heuristic"  # or "pickle:<name>" when a trained model scored it


# ---------------------------------------------------------------------------
# Signal patterns
# ---------------------------------------------------------------------------

CODE_BLOCK_RE = re.compile(r"```[a-zA-Z0-9+#-]*", re.IGNORECASE)
CODE_KEYWORD_RE = re.compile(
    r"\b(?:python|def|javascript|typescript|java|c\+\+|c#|rust|golang|go lang|sql|"
    r"function|class|import|compile|debug|refactor|stack ?trace|api|endpoint|"
    r"react|node|docker|regex|algorithm)\b",
    re.IGNORECASE,
)
FORMAT_CONSTRAINT_RE = re.compile(
    r"\b(?:json|csv|yaml|xml|markdown|schema|table|bullet(?:\s points?)?|"
    r"format(?:ted|ting)?|template|tab separated|strict output)\b",
    re.IGNORECASE,
)
REASONING_RE = re.compile(
    r"\b(?:explain(?:\s+why)?|analy[sz]e|analy[sz]is|compare|step[- ]by[- ]step|"
    r"evaluate|derive|prove|trade[- ]?offs?|reason(?:ing)? through|why\s+does|"
    r"root cause|critique|justify)\b",
    re.IGNORECASE,
)


def _count_matches(pattern: re.Pattern[str], text: str) -> int:
    return len(pattern.findall(text))


# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------


class DifficultyRouter:
    """Scores prompt difficulty (0-100) and selects the target model tier.

    Heuristic by default; pass ``model_path`` to a pickled estimator to let a
    trained model (e.g. XGBoost) produce the score instead. The pickle must
    expose ``predict(features: list[float]) -> array-like`` where features
    follow ``_FEATURE_ORDER``.
    """

    # Numeric feature contract shared by the heuristic engine and any
    # pickled estimator that replaces it. Keep the order stable.
    _FEATURE_ORDER = (
        "word_count",
        "char_count",
        "line_count",
        "code_block_count",
        "code_keyword_count",
        "format_keyword_count",
        "reasoning_keyword_count",
        "question_count",
        "has_code",
        "has_format_constraint",
        "has_reasoning",
    )

    def __init__(self, model_path: Optional[str] = None) -> None:
        self._model: Any = None
        self._engine_name = "heuristic"
        if model_path and os.path.exists(model_path):
            try:
                with open(model_path, "rb") as fh:
                    self._model = pickle.load(fh)
                self._engine_name = f"pickle:{os.path.basename(model_path)}"
            except Exception as exc:  # noqa: BLE001 - degrade to heuristics
                print(f"[router] failed to load model '{model_path}': {exc} — using heuristics")
                self._model = None
                self._engine_name = "heuristic"

    # -- feature extraction -------------------------------------------------

    def extract_features(self, prompt: str) -> dict[str, float]:
        """Turn raw prompt text into a numeric feature vector."""
        text = prompt.strip()
        code_block_count = _count_matches(CODE_BLOCK_RE, text)
        code_keyword_count = _count_matches(CODE_KEYWORD_RE, text)
        format_keyword_count = _count_matches(FORMAT_CONSTRAINT_RE, text)
        reasoning_keyword_count = _count_matches(REASONING_RE, text)
        return {
            "word_count": float(len(text.split())),
            "char_count": float(len(text)),
            "line_count": float(len(text.splitlines())),
            "code_block_count": float(code_block_count),
            "code_keyword_count": float(code_keyword_count),
            "format_keyword_count": float(format_keyword_count),
            "reasoning_keyword_count": float(reasoning_keyword_count),
            "question_count": float(text.count("?")),
            "has_code": float(code_block_count > 0 or code_keyword_count > 0),
            "has_format_constraint": float(format_keyword_count > 0),
            "has_reasoning": float(reasoning_keyword_count > 0),
        }

    # -- scoring ------------------------------------------------------------

    def score(self, prompt: str) -> tuple[int, list[Signal]]:
        """Return the 0-100 difficulty score plus the fired-signal breakdown."""
        features = self.extract_features(prompt)
        if self._model is not None:
            return self._score_with_model(features)
        return self._heuristic_score(features)

    def _heuristic_score(self, features: dict[str, float]) -> tuple[int, list[Signal]]:
        rules: list[tuple[str, str, int, Callable[[dict[str, float]], bool]]] = [
            (
                "long_context",
                "Extended context · >500 words",
                20,
                lambda f: f["word_count"] > 500,
            ),
            (
                "medium_context",
                "Medium context · >200 words",
                10,
                lambda f: f["word_count"] > 200,
            ),
            (
                "code_content",
                "Code blocks / programming keywords",
                30,
                lambda f: f["has_code"] > 0,
            ),
            (
                "explicit_code_fence",
                "Explicit fenced code block (```)",
                8,
                lambda f: f["code_block_count"] > 0,
            ),
            (
                "format_constraints",
                "JSON / strict formatting constraints",
                20,
                lambda f: f["has_format_constraint"] > 0,
            ),
            (
                "complex_reasoning",
                "Complex reasoning keywords",
                15,
                lambda f: f["has_reasoning"] > 0,
            ),
            (
                "deep_reasoning",
                "Deep multi-signal reasoning · 3+ distinct cues",
                8,
                lambda f: f["reasoning_keyword_count"] >= 3,
            ),
        ]
        signals = [
            Signal(key=key, label=label, points=points, matched=bool(check(features)))
            for key, label, points, check in rules
        ]
        total = sum(s.points for s in signals if s.matched)
        return min(100, total), signals

    def _score_with_model(self, features: dict[str, float]) -> tuple[int, list[Signal]]:
        """Score with a pickled estimator (XGBoost / sklearn pipeline)."""
        vector = [[features[name] for name in self._FEATURE_ORDER]]
        try:
            prediction = self._model.predict(vector)[0]
        except Exception as exc:  # noqa: BLE001 - model shape mismatch etc.
            print(f"[router] model prediction failed ({exc}) — falling back to heuristics")
            return self._heuristic_score(features)
        score = int(round(float(prediction)))
        return max(0, min(100, score)), []

    # -- tier / model selection ----------------------------------------------

    @staticmethod
    def select_tier(score: int) -> int:
        for low, high, tier in TIER_THRESHOLDS:
            if low <= score <= high:
                return tier
        return 3  # defensive: anything above 100 lands on the strong model

    @staticmethod
    def model_for_tier(tier: int) -> ModelSpec:
        return MODEL_REGISTRY.get(tier, MODEL_REGISTRY[3])

    # -- public API -----------------------------------------------------------

    def route(self, prompt: str) -> RoutingDecision:
        """Score a prompt and pick the cheapest capable model for it."""
        score, signals = self.score(prompt)
        tier = self.select_tier(score)
        return RoutingDecision(
            score=score,
            tier=tier,
            model=self.model_for_tier(tier),
            signals=signals,
            engine=self._engine_name,
        )


if __name__ == "__main__":  # quick manual sanity check: python router.py
    demo_prompts = [
        "What is the capital of Australia?",
        "Write a Python function called validate_email and return the result as JSON.",
        "```python\nimport threading\n```\nAnalyze this race condition step-by-step, explain why it "
        "happens, compare two fixes and format the trade-offs as a table.",
    ]
    router = DifficultyRouter()
    for demo in demo_prompts:
        decision = router.route(demo)
        fired = [f"{s.label} (+{s.points})" for s in decision.signals if s.matched]
        print(f"score={decision.score:3d} tier={decision.tier} model={decision.model.model_id}")
        for line in fired:
            print(f"          - {line}")
