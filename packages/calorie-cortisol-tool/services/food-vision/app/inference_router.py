"""FastAPI wiring that drives recognition/portion through the model runtime (Task 17.1).

Exposes the runtime-integrated endpoints that select an on-device vs. cloud
runtime via the LaunchDarkly-style feature flag, run the injected inference /
depth / reference adapters, and return the result produced by the existing pure
gating logic:

    * ``POST /recognize``        — full recognition pipeline (Req 2.1).
    * ``POST /portion/estimate`` — full portion pipeline (Req 3.1/3.2/3.3).

These endpoints operate on :class:`~app.model_runtime.ImageInput` handles and run
the whole runtime pipeline, complementing :mod:`app.portion_router` (whose
``POST /portion`` operates on already-extracted detections/signals). The
:class:`~app.model_runtime.RuntimeRouter` is injectable via
:func:`build_inference_router` / :func:`create_inference_app` so production can
supply real Triton / Core ML / TFLite / DPT / YOLOv9 / MLflow / LaunchDarkly
clients without touching the pure recognition/portion modules.

Requirements: 2.1, 3.1, 3.2, 3.3
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, FastAPI
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app.accuracy_eval import CaptureMode
from app.model_runtime import (
    ImageInput,
    RolloutContext,
    RuntimeRouter,
    build_default_runtime_router,
)
from app.recognition import RecognitionMode
from app.result import Ok

_HTTP_UNPROCESSABLE = 422


# ---------------------------------------------------------------------------
# Request / response schemas
# ---------------------------------------------------------------------------


class ImagePayload(BaseModel):
    """A submitted image handle (a single shot or one of a multi-angle set)."""

    image_id: str = Field(..., min_length=1)
    width: int = Field(..., ge=0)
    height: int = Field(..., ge=0)
    angles_deg: list[float] = Field(default_factory=list)


class RolloutPayload(BaseModel):
    """Rollout context used by the feature flag to pick a runtime."""

    user_id: str = Field(..., min_length=1)
    online: bool = True
    cloud_rollout_override: Optional[bool] = None


class RecognizeRequest(BaseModel):
    image: ImagePayload
    context: RolloutPayload
    mode: RecognitionMode = RecognitionMode.STANDARD


class PortionEstimateRequest(BaseModel):
    images: list[ImagePayload] = Field(..., min_length=1)
    context: RolloutPayload
    capture_mode: CaptureMode
    user_id: str = Field(..., min_length=1)


class ErrorResponse(BaseModel):
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


def _to_image(payload: ImagePayload) -> ImageInput:
    return ImageInput(
        image_id=payload.image_id,
        width=payload.width,
        height=payload.height,
        angles_deg=tuple(payload.angles_deg),
    )


def _to_context(payload: RolloutPayload) -> RolloutContext:
    return RolloutContext(
        user_id=payload.user_id,
        online=payload.online,
        cloud_rollout_override=payload.cloud_rollout_override,
    )


# ---------------------------------------------------------------------------
# Router factory
# ---------------------------------------------------------------------------


def build_inference_router(router: Optional[RuntimeRouter] = None) -> APIRouter:
    """Build the inference router backed by an injectable :class:`RuntimeRouter`."""
    runtime_router = router or build_default_runtime_router()
    api = APIRouter(tags=["inference"])

    @api.post("/recognize", responses={_HTTP_UNPROCESSABLE: {"model": ErrorResponse}})
    def post_recognize(body: RecognizeRequest):
        result = runtime_router.recognize_image(
            _to_image(body.image), _to_context(body.context), body.mode
        )
        if isinstance(result, Ok):
            outcome = result.value
            r = outcome.result
            return {
                "recognized": r.recognized,
                "items": [
                    {
                        "region_id": it.region_id,
                        "label": it.label,
                        "confidence": it.confidence,
                    }
                    for it in r.items
                ],
                "prompts": [
                    {
                        "region_id": p.region_id,
                        "top_candidates": [
                            {"label": c.label, "confidence": c.confidence}
                            for c in p.top_candidates
                        ],
                    }
                    for p in r.prompts
                ],
                "count": r.count,
                "source": r.source.value,
                "image_retained": r.image_retained,
                "message": r.message,
                "runtime": {
                    "location": outcome.location.value,
                    "model": outcome.model.name,
                    "version": outcome.model.version,
                    "format": outcome.model.model_format.value,
                },
            }
        return JSONResponse(
            status_code=_HTTP_UNPROCESSABLE, content=_error_body(result.error)
        )

    @api.post(
        "/portion/estimate",
        responses={_HTTP_UNPROCESSABLE: {"model": ErrorResponse}},
    )
    def post_portion_estimate(body: PortionEstimateRequest):
        result = runtime_router.estimate_portion_image(
            [_to_image(img) for img in body.images],
            _to_context(body.context),
            body.capture_mode,
            body.user_id,
        )
        if isinstance(result, Ok):
            outcome = result.value
            est = outcome.estimate
            return {
                "volume_ml": est.volume_ml,
                "error_pct": est.error_pct,
                "scaled": est.scaled,
                "reference_object": (
                    est.reference_object.value if est.reference_object else None
                ),
                "calibration_applied": est.calibration_applied,
                "accuracy_reduced": est.accuracy_reduced,
                "message": est.message,
                "runtime": {
                    "location": outcome.location.value,
                    "depth_backend": outcome.depth_backend.value,
                    "model": outcome.model.name,
                    "version": outcome.model.version,
                    "format": outcome.model.model_format.value,
                },
            }
        # Atomic rejection: no partial estimate retained (Req 3.5).
        return JSONResponse(
            status_code=_HTTP_UNPROCESSABLE, content=_error_body(result.error)
        )

    return api


def create_inference_app(router: Optional[RuntimeRouter] = None) -> FastAPI:
    """Create a standalone FastAPI app mounting the runtime-integrated router."""
    app = FastAPI(title="Food Vision — Model Runtime Integration")
    app.include_router(build_inference_router(router))
    return app
