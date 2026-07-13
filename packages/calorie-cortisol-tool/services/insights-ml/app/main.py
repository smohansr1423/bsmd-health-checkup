"""Local "dev mode" FastAPI app for the Insights & ML Service.

ADDITIVE dev wiring only — no existing domain logic is modified. It exposes thin
JSON endpoints over the service's existing entry points
(:func:`correlate`, :func:`generate_guidance`, :func:`handle_digest`) plus a
``/health`` probe, and enables permissive CORS for local development. Everything
runs in-memory over the shared domain types, so no SageMaker / LLM / external
infrastructure is required.

The shared ``cc_contracts`` package is added to ``sys.path`` here (mirroring the
test conftest) so the app runs without a Poetry-managed editable install.

Run:  PORT=8086 uvicorn app.main:app --port 8086
"""

from __future__ import annotations

import sys
from datetime import datetime
from pathlib import Path
from typing import List, Optional

# Ensure cc_contracts is importable without a Poetry editable install.
_SHARED_PYTHON = Path(__file__).resolve().parents[3] / "shared" / "python"
if _SHARED_PYTHON.is_dir() and str(_SHARED_PYTHON) not in sys.path:
    sys.path.insert(0, str(_SHARED_PYTHON))

from fastapi import FastAPI  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from pydantic import BaseModel, Field  # noqa: E402

from cc_contracts.domain import CortisolReading, ReferenceContext  # noqa: E402

from app.correlation import FoodEntry, correlate  # noqa: E402
from app.digest import DigestRequest, handle_digest  # noqa: E402
from app.guidance import GuidanceRequest, generate_guidance  # noqa: E402

SERVICE_NAME = "insights-ml"

app = FastAPI(title="Insights & ML Service — dev mode")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Request schemas
# ---------------------------------------------------------------------------


class ReadingPayload(BaseModel):
    id: str
    user_id: str
    measured_at: str
    value_nmol_l: float
    source: str = "lab"
    time_of_day_bucket: str = "morning"
    valid: bool = True
    # Optional reference context so guidance can classify the reading.
    classification: Optional[str] = None
    ref_lower: float = 0.0
    ref_upper: float = 0.0
    age_band: str = "adult"
    sex: str = "M"

    def to_domain(self) -> CortisolReading:
        contextualized = None
        if self.classification is not None:
            contextualized = ReferenceContext(
                age_band=self.age_band,
                sex=self.sex,  # type: ignore[arg-type]
                ref_lower=self.ref_lower,
                ref_upper=self.ref_upper,
                classification=self.classification,  # type: ignore[arg-type]
            )
        return CortisolReading(
            id=self.id,
            user_id=self.user_id,
            measured_at=self.measured_at,
            value_nmol_l=self.value_nmol_l,
            source=self.source,  # type: ignore[arg-type]
            time_of_day_bucket=self.time_of_day_bucket,  # type: ignore[arg-type]
            valid=self.valid,
            contextualized=contextualized,
        )


class FoodEntryPayload(BaseModel):
    id: str
    logged_at: str
    calories: float


class CorrelateRequest(BaseModel):
    user_id: str = "dev-user"
    entries: List[FoodEntryPayload] = Field(default_factory=list)
    readings: List[ReadingPayload] = Field(default_factory=list)


class GuidancePayload(BaseModel):
    user_id: str = "dev-user"
    readings: List[ReadingPayload] = Field(default_factory=list)
    referral_threshold_nmol_l: float = 0.0


class DigestPayload(BaseModel):
    user_id: str = "dev-user"
    now: Optional[str] = None
    meals_logged: int = 0
    readings_logged: int = 0


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "service": SERVICE_NAME}


@app.post("/correlate")
def post_correlate(body: CorrelateRequest):
    entries = [FoodEntry(id=e.id, logged_at=e.logged_at, calories=e.calories) for e in body.entries]
    readings = [r.to_domain() for r in body.readings]
    outcome = correlate(entries, readings)
    return {
        "more_data_required": outcome.more_data_required,
        "alert": outcome.alert,
        "message": outcome.message,
        "result": {
            "coefficient": outcome.result.coefficient,
            "p_value": outcome.result.p_value,
            "pair_count": outcome.result.pair_count,
            "significant": outcome.result.significant,
        },
        "aligned_pairs": [
            {"meal_id": p.meal_id, "reading_id": p.reading_id, "delta_minutes": p.delta_minutes}
            for p in outcome.aligned_pairs
        ],
    }


@app.post("/guidance")
def post_guidance(body: GuidancePayload):
    request = GuidanceRequest(
        user_id=body.user_id,
        readings=[r.to_domain() for r in body.readings],
        referral_threshold_nmol_l=body.referral_threshold_nmol_l,
    )
    outcome = generate_guidance(request)
    return {
        "ready": outcome.ready,
        "more_readings_required": outcome.more_readings_required,
        "referral_triggered": outcome.referral_triggered,
        "readings_retained": outcome.readings_retained,
        "message": outcome.message,
        "cards": [
            {"template_id": c.template_id, "title": c.title, "body": c.body, "is_referral": c.is_referral}
            for c in outcome.cards
        ],
    }


@app.post("/digest")
def post_digest(body: DigestPayload):
    now = datetime.fromisoformat(body.now.replace("Z", "+00:00")) if body.now else datetime.now()
    request = DigestRequest(
        user_id=body.user_id,
        now=now,
        meals_logged=body.meals_logged,
        readings_logged=body.readings_logged,
    )
    result = handle_digest(request)
    outcome = result.value
    return {
        "digest_id": outcome.digest.digest_id,
        "headline": outcome.digest.headline,
        "scheduled_for": outcome.scheduled_for,
        "next_scheduled_for": outcome.next_scheduled_for,
        "event": outcome.event.to_payload(),
    }
