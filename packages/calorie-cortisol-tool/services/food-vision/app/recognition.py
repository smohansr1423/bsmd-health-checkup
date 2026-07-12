"""Food recognition endpoint with confidence gating (Task 6.1).

Implements the ``POST /recognize`` behaviour described in the design's *Food
Vision Service* section::

    POST /recognize -- image(s) -> detection JSON
    {items:[{label, confidence, bbox}], count} within 5s.
    Confidence gating: <70% -> top-3 candidate list;
    no item >=70% -> "no food recognized".
    Restaurant path uses menu OCR + POS with fallback to standard classification.

Following the convention established by :mod:`app.accuracy_eval`, the endpoint
logic is implemented as a **pure, deterministic** function operating over
*supplied* model detections rather than performing live inference or wiring a
FastAPI route (FastAPI/Triton are runtime concerns layered on top). Callers
run the vision model elsewhere and hand the ranked candidate detections to
:func:`recognize`, which applies the confidence-threshold branching, the
20-item cap, and the restaurant menu-OCR/POS path. This keeps the gating logic
independently verifiable (unit + property tests).

Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Optional, Sequence, Tuple

from app.result import Err, Ok, err, ok, validation_rejection

# ---------------------------------------------------------------------------
# Constants (mirrors cc_contracts.constants for a self-contained service)
# ---------------------------------------------------------------------------

#: Per-item recognition confidence range, inclusive (Req 2.2).
CONFIDENCE_MIN: float = 0.0
CONFIDENCE_MAX: float = 100.0

#: Confidence at/above which a detection is auto-classified (Req 2.3/2.7).
CONFIDENCE_AUTO_THRESHOLD: float = 70.0

#: Maximum number of detected items returned for a single image (Req 2.2).
MAX_DETECTED_ITEMS: int = 20

#: Number of candidate labels surfaced in a low-confidence confirmation
#: prompt (Req 2.3).
TOP_CANDIDATE_COUNT: int = 3

#: Minimum number of food categories the recognizer classifies across (Req 2.1).
MIN_FOOD_CATEGORIES: int = 2000


class RecognitionMode(str, Enum):
    """How the submitted image should be recognized (Req 2.4)."""

    STANDARD = "standard"
    RESTAURANT = "restaurant"


class RecognitionSource(str, Enum):
    """The pathway that produced the returned items (Req 2.4/2.5)."""

    STANDARD = "standard"  # image classification
    MENU_OCR = "menuOCR"  # restaurant menu OCR / point-of-sale data


# ---------------------------------------------------------------------------
# Input / output data model
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class BoundingBox:
    """Axis-aligned bounding box in normalized [0, 1] image coordinates."""

    x: float
    y: float
    width: float
    height: float


@dataclass(frozen=True)
class Candidate:
    """A single candidate label for a detected region with its confidence.

    ``confidence`` is a percentage in the inclusive range 0..100 (Req 2.2).
    """

    label: str
    confidence: float


@dataclass(frozen=True)
class RawDetection:
    """A detected food region with ranked candidate labels (highest first).

    Produced by the vision model / menu-OCR pass. ``candidates`` must be
    non-empty and ordered by descending confidence; ``candidates[0]`` is the
    model's best guess for the region.
    """

    region_id: str
    candidates: Tuple[Candidate, ...]
    bbox: Optional[BoundingBox] = None


@dataclass(frozen=True)
class RecognizedItem:
    """An auto-classified item whose best candidate reached the threshold.

    Emitted when the top candidate confidence is >= 70 (Req 2.2/2.6).
    """

    region_id: str
    label: str
    confidence: float
    bbox: Optional[BoundingBox] = None


@dataclass(frozen=True)
class CandidatePrompt:
    """A low-confidence region requiring user confirmation (Req 2.3).

    Presented instead of auto-classifying when the best candidate confidence is
    below 70. ``top_candidates`` lists up to the top 3 candidates for the region.
    """

    region_id: str
    top_candidates: Tuple[Candidate, ...]
    bbox: Optional[BoundingBox] = None


@dataclass(frozen=True)
class RecognitionResult:
    """The structured outcome of a ``/recognize`` call.

    * ``recognized`` is True iff at least one region was auto-classified with
      confidence >= 70 (Req 2.2). When False, this is the "no food recognized"
      outcome (Req 2.7) and ``image_retained`` is True so the user can retake or
      enter food manually without re-submitting.
    * ``items`` are the auto-classified detections (confidence >= 70).
    * ``prompts`` are the low-confidence detections needing top-3 confirmation
      (Req 2.3). Only populated when at least one item was recognized.
    * ``count`` is ``len(items) + len(prompts)`` and never exceeds 20 (Req 2.2).
    * ``source`` records whether the restaurant menu-OCR/POS path or standard
      classification produced the result (Req 2.4/2.5).
    """

    recognized: bool
    items: Tuple[RecognizedItem, ...]
    prompts: Tuple[CandidatePrompt, ...]
    count: int
    source: RecognitionSource
    image_retained: bool
    message: str


# ---------------------------------------------------------------------------
# Pure helpers
# ---------------------------------------------------------------------------


def _is_valid_confidence(confidence: float) -> bool:
    """Whether a confidence lies within the inclusive 0..100 range (Req 2.2)."""
    return CONFIDENCE_MIN <= confidence <= CONFIDENCE_MAX


def top_candidate(detection: RawDetection) -> Candidate:
    """Return the best (highest-ranked) candidate for a detection."""
    return detection.candidates[0]


def top_confidence(detection: RawDetection) -> float:
    """Return the confidence of a detection's best candidate."""
    return top_candidate(detection).confidence


def is_auto_classified(detection: RawDetection) -> bool:
    """Whether a detection's best candidate reaches the auto threshold (Req 2.3)."""
    return top_confidence(detection) >= CONFIDENCE_AUTO_THRESHOLD


def _cap_detections(detections: Sequence[RawDetection]) -> list[RawDetection]:
    """Cap to at most 20 items, keeping the highest-confidence ones (Req 2.2).

    A stable sort by descending top-candidate confidence preserves the model's
    ordering for ties before truncating to :data:`MAX_DETECTED_ITEMS`.
    """
    if len(detections) <= MAX_DETECTED_ITEMS:
        return list(detections)
    ranked = sorted(detections, key=top_confidence, reverse=True)
    return ranked[:MAX_DETECTED_ITEMS]


# ---------------------------------------------------------------------------
# Recognition endpoint
# ---------------------------------------------------------------------------


def _validate(detections: Sequence[RawDetection]) -> Optional[Err]:
    """Validate the detection payload; return an ``Err`` on rejection, else None."""
    for det in detections:
        if not det.candidates:
            return err(
                validation_rejection(
                    "EMPTY_DETECTION",
                    f"detection {det.region_id!r} has no candidate labels",
                )
            )
        for cand in det.candidates:
            if not _is_valid_confidence(cand.confidence):
                return err(
                    validation_rejection(
                        "INVALID_CONFIDENCE",
                        f"candidate {cand.label!r} in region {det.region_id!r} has "
                        f"confidence {cand.confidence}; must be within "
                        f"{CONFIDENCE_MIN}..{CONFIDENCE_MAX}",
                    )
                )
    return None


def recognize(
    detections: Sequence[RawDetection],
    mode: RecognitionMode = RecognitionMode.STANDARD,
    menu_detections: Optional[Sequence[RawDetection]] = None,
) -> Ok[RecognitionResult] | Err:
    """Apply confidence gating to model detections and return the result.

    Args:
        detections: Ranked candidate detections from standard image
            classification. Used directly in standard mode and as the fallback
            when the restaurant menu-OCR/POS path yields nothing (Req 2.5).
        mode: ``STANDARD`` or ``RESTAURANT``. In restaurant mode the menu-OCR/POS
            detections take precedence when available (Req 2.4).
        menu_detections: Detections derived from restaurant menu OCR /
            point-of-sale data. Only consulted when ``mode`` is ``RESTAURANT``.

    Gating rules:
        * At most 20 items are returned; extras beyond the highest-confidence 20
          are dropped (Req 2.2).
        * Every item carries a 0..100 confidence; out-of-range confidence is a
          validation rejection (Req 2.2).
        * Regions whose best candidate is >= 70 are auto-classified into
          ``items``; regions below 70 become top-3 confirmation ``prompts``
          instead of being auto-classified (Req 2.3).
        * If no region reaches 70, the result is "no food recognized" with the
          image retained for the session (Req 2.7).
        * Restaurant mode uses menu-OCR/POS detections when present, otherwise
          falls back to standard classification (Req 2.4/2.5).

    Returns:
        ``Ok(RecognitionResult)`` on success, or ``Err`` with a validation
        rejection (prior state preserved) for a malformed payload.
    """
    # Select the active detection set and record which path produced it.
    if mode is RecognitionMode.RESTAURANT and menu_detections:
        active: Sequence[RawDetection] = menu_detections
        source = RecognitionSource.MENU_OCR
    else:
        # Standard mode, or restaurant with no menu OCR/POS data -> fallback
        # to standard classification (Req 2.5).
        active = detections
        source = RecognitionSource.STANDARD

    invalid = _validate(active)
    if invalid is not None:
        return invalid

    capped = _cap_detections(active)

    auto = [d for d in capped if is_auto_classified(d)]
    low = [d for d in capped if not is_auto_classified(d)]

    # Req 2.7: no item detected with confidence >= 70 -> "no food recognized",
    # retain the image and prompt retake / manual entry. This holds even when
    # low-confidence detections exist.
    if not auto:
        return ok(
            RecognitionResult(
                recognized=False,
                items=(),
                prompts=(),
                count=0,
                source=source,
                image_retained=True,
                message=(
                    "No food was recognized. Retake the image or enter the food "
                    "manually; the submitted image has been retained."
                ),
            )
        )

    items = tuple(
        RecognizedItem(
            region_id=d.region_id,
            label=top_candidate(d).label,
            confidence=top_candidate(d).confidence,
            bbox=d.bbox,
        )
        for d in auto
    )
    # Req 2.3: low-confidence regions surface a top-3 candidate prompt instead
    # of being auto-classified.
    prompts = tuple(
        CandidatePrompt(
            region_id=d.region_id,
            top_candidates=tuple(d.candidates[:TOP_CANDIDATE_COUNT]),
            bbox=d.bbox,
        )
        for d in low
    )

    count = len(items) + len(prompts)
    if prompts:
        message = (
            f"Recognized {len(items)} item(s); {len(prompts)} low-confidence "
            f"item(s) need confirmation from their top-{TOP_CANDIDATE_COUNT} "
            f"candidates."
        )
    else:
        message = f"Recognized {len(items)} item(s)."

    return ok(
        RecognitionResult(
            recognized=True,
            items=items,
            prompts=prompts,
            count=count,
            source=source,
            image_retained=True,
            message=message,
        )
    )
