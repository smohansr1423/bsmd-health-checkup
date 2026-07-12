"""FastAPI wiring for portion estimation and plate calibration (Task 6.4).

Exposes:
    * ``POST /portion``              — estimate food volume (Req 3.1–3.5).
    * ``PUT  /portion/calibration``  — persist/override plate calibration (Req 3.6/3.7).
    * ``DELETE /portion/calibration/{user_id}`` — remove calibration (Req 3.6).

The router owns a process-local :class:`~app.portion.CalibrationStore` by
default; a different store can be injected via :func:`build_portion_router` /
:func:`create_portion_app` for tests or for wiring into the shared app the
recognition endpoint (Task 6.1) sets up — this module deliberately does not
create or mutate that shared entrypoint.

Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, FastAPI
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app.accuracy_eval import CaptureMode
from app.portion import (
    CalibrationStore,
    InMemoryCalibrationStore,
    PortionRequest,
    ReferenceObject,
    calibrate_plate,
    estimate_portion,
    remove_calibration,
)
from app.result import Ok

# HTTP status codes used for the structured error contract.
_HTTP_UNPROCESSABLE = 422
_HTTP_ATOMIC_FAILURE = 500


# ---------------------------------------------------------------------------
# Request / response schemas
# ---------------------------------------------------------------------------


class PortionEstimateRequest(BaseModel):
    """``POST /portion`` request body."""

    user_id: str = Field(..., min_length=1)
    capture_mode: CaptureMode
    width: int = Field(..., ge=0)
    height: int = Field(..., ge=0)
    has_food_region: bool
    raw_volume_ml: float
    reference_object: Optional[ReferenceObject] = None


class PortionEstimateResponse(BaseModel):
    """``POST /portion`` success body (design ``PortionEstimate``)."""

    volume_ml: float
    error_pct: float
    scaled: bool
    reference_object: Optional[ReferenceObject]
    calibration_applied: bool
    accuracy_reduced: bool
    message: str


class CalibrationRequest(BaseModel):
    """``PUT /portion/calibration`` request body."""

    user_id: str = Field(..., min_length=1)
    reference_scale: float


class CalibrationResponse(BaseModel):
    user_id: str
    reference_scale: float
    updated_at: str


class ErrorResponse(BaseModel):
    """The shared structured error contract surfaced over HTTP."""

    code: str
    message: str
    retryable: bool
    retained_state: bool


def _error_body(error) -> dict:
    return {
        "code": error.code,
        "message": error.message,
        "retryable": error.retryable,
        "retained_state": error.retained_state,
    }


# ---------------------------------------------------------------------------
# Router factory
# ---------------------------------------------------------------------------


def build_portion_router(store: Optional[CalibrationStore] = None) -> APIRouter:
    """Build the portion router, optionally backed by an injected ``store``."""
    calibration_store: CalibrationStore = store or InMemoryCalibrationStore()
    router = APIRouter(tags=["portion"])

    @router.post(
        "/portion",
        response_model=PortionEstimateResponse,
        responses={_HTTP_UNPROCESSABLE: {"model": ErrorResponse}},
    )
    def post_portion(body: PortionEstimateRequest):
        result = estimate_portion(
            PortionRequest(
                user_id=body.user_id,
                capture_mode=body.capture_mode,
                width=body.width,
                height=body.height,
                has_food_region=body.has_food_region,
                raw_volume_ml=body.raw_volume_ml,
                reference_object=body.reference_object,
            ),
            calibration_store,
        )
        if isinstance(result, Ok):
            return result.value
        # Atomic rejection: no partial estimate retained (Req 3.5).
        return JSONResponse(
            status_code=_HTTP_UNPROCESSABLE, content=_error_body(result.error)
        )

    @router.put(
        "/portion/calibration",
        response_model=CalibrationResponse,
        responses={_HTTP_ATOMIC_FAILURE: {"model": ErrorResponse}},
    )
    def put_calibration(body: CalibrationRequest):
        updated_at = datetime.now(timezone.utc).isoformat()
        result = calibrate_plate(
            body.user_id, body.reference_scale, calibration_store, updated_at
        )
        if isinstance(result, Ok):
            cal = result.value
            return CalibrationResponse(
                user_id=cal.user_id,
                reference_scale=cal.reference_scale,
                updated_at=cal.updated_at,
            )
        # Persistence failure → prior calibration remains in effect (Req 3.7).
        status = (
            _HTTP_UNPROCESSABLE
            if result.error.code == "INVALID_CALIBRATION_SCALE"
            else _HTTP_ATOMIC_FAILURE
        )
        return JSONResponse(status_code=status, content=_error_body(result.error))

    @router.delete("/portion/calibration/{user_id}")
    def delete_calibration(user_id: str):
        remove_calibration(user_id, calibration_store)
        return {"removed": True, "user_id": user_id}

    return router


def create_portion_app(store: Optional[CalibrationStore] = None) -> FastAPI:
    """Create a standalone FastAPI app mounting only the portion router.

    Used for isolated tests; the production app (owned by the recognition task)
    can instead call :func:`build_portion_router` and ``include_router`` it.
    """
    app = FastAPI(title="Food Vision — Portion Estimation")
    app.include_router(build_portion_router(store))
    return app
