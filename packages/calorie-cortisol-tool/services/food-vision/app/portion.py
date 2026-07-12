"""Portion-size estimation core logic (Task 6.4).

Framework-agnostic domain logic backing the Food Vision Service's
``POST /portion`` endpoint and personal plate-calibration persistence. The
FastAPI wiring lives in :mod:`app.portion_router` so this module stays free of
any web-framework dependency and can be exercised directly by unit / property
tests. Recognition (Task 6.1) owns its own module and the shared app entrypoint;
portion logic is intentionally self-contained here.

Design references:
    * ``POST /portion`` — image(s) + detections →
      ``{volume_ml, error_band, scaled, reference_object}`` (design "Food Vision
      Service").
    * ``PortionEstimate`` shape: ``volumeMl ≥ 0``, ``errorPct`` (±15% single /
      ±8% multi), ``scaled`` boolean, optional ``referenceObject``.
    * "Volume→mass: density lookup ... personal plate calibration overrides
      reference scale" (design "Volume / Portion Estimation").

Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Optional, Protocol

from app.accuracy_eval import CaptureMode
from app.result import Err, Ok, atomic_failure, err, ok, validation_rejection

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

#: Error band (percent) of the returned volume estimate, by capture mode.
#: Single-angle monocular depth is within ±15% of ground truth (Req 3.1);
#: multi-angle photogrammetry is within ±8% (Req 3.2).
SINGLE_ANGLE_ERROR_PCT = 15.0
MULTI_ANGLE_ERROR_PCT = 8.0

ERROR_BAND_PCT: dict[CaptureMode, float] = {
    CaptureMode.SINGLE_ANGLE: SINGLE_ANGLE_ERROR_PCT,
    CaptureMode.MULTI_ANGLE: MULTI_ANGLE_ERROR_PCT,
}

#: Minimum processable resolution; anything below is rejected (Req 3.5).
MIN_WIDTH = 640
MIN_HEIGHT = 480


class ReferenceObject(str, Enum):
    """A physical object of known size used to scale the volume estimate.

    Detected reference objects (Req 3.3). When none is present the estimate is
    returned unscaled rather than discarded (Req 3.4).
    """

    PLATE = "plate"
    HAND = "hand"
    UTENSIL = "utensil"


#: Nominal scale factor contributed by each reference object. These convert the
#: CV-derived raw volume signal into real-world millilitres. A persisted
#: personal plate calibration overrides these when present (Req 3.6).
REFERENCE_SCALE_FACTORS: dict[ReferenceObject, float] = {
    ReferenceObject.PLATE: 1.0,
    ReferenceObject.HAND: 0.9,
    ReferenceObject.UTENSIL: 0.8,
}


# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class PortionRequest:
    """Inputs the CV pipeline hands to portion estimation.

    We model the *outputs* of upstream recognition / detection rather than raw
    pixels so the estimation logic is deterministic and independently testable:

    * ``width`` / ``height`` — submitted image resolution (Req 3.5 gate).
    * ``has_food_region`` — whether a food region was detected (Req 3.5 gate).
    * ``raw_volume_ml`` — the un-scaled volume signal from monocular depth
      (single-angle) or photogrammetric reconstruction (multi-angle).
    * ``capture_mode`` — selects the ±15% / ±8% error band (Req 3.1/3.2).
    * ``reference_object`` — the reference object detected, if any (Req 3.3/3.4).
    """

    user_id: str
    capture_mode: CaptureMode
    width: int
    height: int
    has_food_region: bool
    raw_volume_ml: float
    reference_object: Optional[ReferenceObject] = None


@dataclass(frozen=True)
class PortionEstimate:
    """A returned volume estimate (design ``PortionEstimate``)."""

    volume_ml: float  # always >= 0
    error_pct: float  # ±15% single / ±8% multi
    scaled: bool  # False → accuracy reduced (Req 3.4)
    reference_object: Optional[ReferenceObject]
    calibration_applied: bool
    accuracy_reduced: bool
    message: str


@dataclass(frozen=True)
class PlateCalibration:
    """A user's persisted personal-plate reference scale (design type)."""

    user_id: str
    reference_scale: float  # > 0
    updated_at: str


# ---------------------------------------------------------------------------
# Calibration persistence
# ---------------------------------------------------------------------------


class CalibrationStore(Protocol):
    """Persistence boundary for personal plate calibrations."""

    def get(self, user_id: str) -> Optional[PlateCalibration]:
        """Return the stored calibration for ``user_id`` or ``None``."""
        ...

    def save(self, calibration: PlateCalibration) -> bool:
        """Persist ``calibration``.

        Return ``True`` on success. On failure the store MUST leave any prior
        calibration unchanged and return ``False`` (Req 3.7).
        """
        ...

    def delete(self, user_id: str) -> None:
        """Remove any stored calibration for ``user_id`` (Req 3.6 "removed")."""
        ...


class InMemoryCalibrationStore:
    """Simple in-memory :class:`CalibrationStore` for tests / local runs.

    ``fail_saves`` simulates a persistence failure (Req 3.7): while set, every
    :meth:`save` returns ``False`` without mutating the stored value.
    """

    def __init__(self) -> None:
        self._by_user: dict[str, PlateCalibration] = {}
        self.fail_saves = False

    def get(self, user_id: str) -> Optional[PlateCalibration]:
        return self._by_user.get(user_id)

    def save(self, calibration: PlateCalibration) -> bool:
        if self.fail_saves:
            return False  # prior state preserved, no partial write
        self._by_user[calibration.user_id] = calibration
        return True

    def delete(self, user_id: str) -> None:
        self._by_user.pop(user_id, None)


# ---------------------------------------------------------------------------
# Pure helpers
# ---------------------------------------------------------------------------


def error_band_for(capture_mode: CaptureMode) -> float:
    """Return the error band (percent) for ``capture_mode`` (Req 3.1/3.2)."""
    return ERROR_BAND_PCT[capture_mode]


def is_resolution_processable(width: int, height: int) -> bool:
    """Whether resolution meets the 640×480 minimum (Req 3.5)."""
    return width >= MIN_WIDTH and height >= MIN_HEIGHT


def scale_factor_for(
    reference_object: Optional[ReferenceObject],
    calibration: Optional[PlateCalibration],
) -> tuple[float, bool, bool]:
    """Resolve the scale factor and scaling flags.

    Returns ``(scale_factor, scaled, calibration_applied)``. A persisted plate
    calibration overrides any detected reference object (Req 3.6). When neither
    is available the estimate is unscaled (factor 1.0, ``scaled=False``) but is
    still produced (Req 3.4).
    """
    if calibration is not None:
        return calibration.reference_scale, True, True
    if reference_object is not None:
        return REFERENCE_SCALE_FACTORS[reference_object], True, False
    return 1.0, False, False


# ---------------------------------------------------------------------------
# Estimation
# ---------------------------------------------------------------------------


def estimate_portion(
    request: PortionRequest, store: CalibrationStore
) -> Ok[PortionEstimate] | Err:
    """Estimate food volume for a submitted image (Req 3.1–3.6).

    Rejects atomically — with a reason and **no** retained partial estimate —
    when no food region is detected or resolution is below 640×480 (Req 3.5).
    Otherwise returns an estimate whose ``error_pct`` reflects the capture mode
    (Req 3.1/3.2), scaled by a persisted plate calibration (Req 3.6) or a
    detected reference object (Req 3.3), or flagged unscaled / accuracy-reduced
    when neither is present without discarding the estimate (Req 3.4).
    """
    if request.raw_volume_ml < 0:
        return err(
            validation_rejection(
                "INVALID_VOLUME_SIGNAL",
                "raw volume signal must be non-negative",
            )
        )

    if not request.has_food_region:
        return err(
            validation_rejection(
                "NO_FOOD_REGION",
                "no food region detected in the submitted image",
            )
        )

    if not is_resolution_processable(request.width, request.height):
        return err(
            validation_rejection(
                "RESOLUTION_TOO_LOW",
                f"image resolution {request.width}x{request.height} is below the "
                f"{MIN_WIDTH}x{MIN_HEIGHT} minimum",
            )
        )

    calibration = store.get(request.user_id)
    scale, scaled, calibration_applied = scale_factor_for(
        request.reference_object, calibration
    )

    volume_ml = max(0.0, request.raw_volume_ml * scale)
    error_pct = error_band_for(request.capture_mode)

    if scaled:
        if calibration_applied:
            message = "Volume scaled using your saved plate calibration."
        else:
            message = (
                f"Volume scaled using detected reference object "
                f"({request.reference_object.value})."  # type: ignore[union-attr]
            )
    else:
        message = (
            "No reference object detected; portion accuracy is reduced. "
            "Estimate retained."
        )

    return ok(
        PortionEstimate(
            volume_ml=volume_ml,
            error_pct=error_pct,
            scaled=scaled,
            reference_object=request.reference_object,
            calibration_applied=calibration_applied,
            accuracy_reduced=not scaled,
            message=message,
        )
    )


def calibrate_plate(
    user_id: str,
    reference_scale: float,
    store: CalibrationStore,
    updated_at: str,
) -> Ok[PlateCalibration] | Err:
    """Persist (or override) a user's personal plate calibration (Req 3.6/3.7).

    On success the calibration is stored and applied to all subsequent
    estimations until changed or removed (Req 3.6). If persistence fails, an
    atomic-failure error is returned and the previously stored calibration (or
    none) remains in effect (Req 3.7) — no partial write occurs.
    """
    if reference_scale <= 0:
        return err(
            validation_rejection(
                "INVALID_CALIBRATION_SCALE",
                "plate reference scale must be greater than zero",
            )
        )

    calibration = PlateCalibration(
        user_id=user_id, reference_scale=reference_scale, updated_at=updated_at
    )

    if not store.save(calibration):
        return err(
            atomic_failure(
                "CALIBRATION_NOT_SAVED",
                "plate calibration could not be saved; the previous calibration "
                "(if any) remains in effect",
            )
        )

    return ok(calibration)


def remove_calibration(user_id: str, store: CalibrationStore) -> Ok[bool] | Err:
    """Remove a user's stored plate calibration (Req 3.6 "changed or removed")."""
    store.delete(user_id)
    return ok(True)
