"""Offline calorie-accuracy evaluation harness (Task 6.8).

Implements the MAPE benchmark described in the design's *Accuracy Evaluation
Harness (Req 22)* section:

    Offline batch evaluates against a dietitian-verified dataset (>=500 items),
    computing MAPE per capture mode, recording MAPE + mode + item count, and
    flagging runs at/above threshold (15% single / 5% multi) as failed while
    retaining results.

The harness is a **pure, testable** function operating over a *supplied*
dataset of ``(estimated_kcal, ground_truth_kcal)`` pairs. It does NOT load a
live model or perform inference -- callers produce estimates elsewhere and hand
the labelled results to this module, which keeps the accuracy scoring
deterministic and independently verifiable (e.g. as a scheduled CI job).

Ground truth is the dietitian-verified calorie value.

Requirements: 22.3, 22.4, 22.5
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Iterable, Sequence

from app.result import Err, Ok, err, ok, validation_rejection

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

#: The validation dataset must contain at least this many labelled items per
#: the requirement ("at least 500 labeled food items", Req 22.1/22.2).
MIN_DATASET_SIZE = 500


class CaptureMode(str, Enum):
    """The capture mode a calorie estimate was produced from (Req 22.3)."""

    SINGLE_ANGLE = "single-angle"
    MULTI_ANGLE = "multi-angle"


#: Applicable MAPE threshold (percent) per capture mode. A run is flagged
#: failed when its measured MAPE is *at or above* the threshold (Req 22.4);
#: the target is to stay *below* it (Req 22.1 single / 22.2 multi).
MAPE_THRESHOLDS: dict[CaptureMode, float] = {
    CaptureMode.SINGLE_ANGLE: 15.0,
    CaptureMode.MULTI_ANGLE: 5.0,
}


# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ValidationItem:
    """A single labelled item in the dietitian-verified validation dataset.

    ``estimated_kcal`` is the module's calorie estimate; ``ground_truth_kcal``
    is the dietitian-verified value that serves as ground truth.
    """

    item_id: str
    capture_mode: CaptureMode
    estimated_kcal: float
    ground_truth_kcal: float


@dataclass(frozen=True)
class AccuracyRunResult:
    """The recorded, retained outcome of one accuracy evaluation run.

    Records the computed MAPE, the capture mode, and the item count (Req 22.3).
    ``failed`` is set iff ``mape >= threshold`` (Req 22.4). The result is always
    returned/retained regardless of ``failed`` so failing runs still record
    their measurements.
    """

    capture_mode: CaptureMode
    mape: float
    item_count: int
    threshold: float
    failed: bool
    message: str


# ---------------------------------------------------------------------------
# Pure scoring helpers
# ---------------------------------------------------------------------------


def threshold_for(capture_mode: CaptureMode) -> float:
    """Return the applicable MAPE threshold (percent) for ``capture_mode``."""
    return MAPE_THRESHOLDS[capture_mode]


def is_non_negative_estimate(kcal: float) -> bool:
    """Whether a calorie estimate satisfies the >= 0 kcal rule (Req 22.5)."""
    return kcal >= 0


def absolute_percentage_error(estimated_kcal: float, ground_truth_kcal: float) -> float:
    """Absolute percentage error of one estimate against ground truth.

    ``|estimated - ground_truth| / ground_truth * 100``. Requires a positive
    ground-truth value (percentage error is undefined at zero).
    """
    if ground_truth_kcal <= 0:
        raise ValueError("ground_truth_kcal must be > 0 to compute percentage error")
    return abs(estimated_kcal - ground_truth_kcal) / ground_truth_kcal * 100.0


def compute_mape(items: Sequence[ValidationItem]) -> float:
    """Mean Absolute Percentage Error (percent) over ``items``.

    Assumes ``items`` is non-empty and every ground-truth value is positive;
    callers should validate via :func:`evaluate_capture_mode`.
    """
    if not items:
        raise ValueError("cannot compute MAPE over an empty dataset")
    total = sum(
        absolute_percentage_error(it.estimated_kcal, it.ground_truth_kcal)
        for it in items
    )
    return total / len(items)


def is_run_failed(mape: float, capture_mode: CaptureMode) -> bool:
    """Whether a run is flagged failed: ``mape >= threshold`` (Req 22.4)."""
    return mape >= threshold_for(capture_mode)


# ---------------------------------------------------------------------------
# Evaluation harness
# ---------------------------------------------------------------------------


def evaluate_capture_mode(
    items: Iterable[ValidationItem],
    capture_mode: CaptureMode,
    min_dataset_size: int = MIN_DATASET_SIZE,
) -> Ok[AccuracyRunResult] | Err:
    """Evaluate one capture mode's items and record a retained run result.

    Filters the supplied dataset to ``capture_mode`` and, on a valid dataset,
    returns ``Ok(AccuracyRunResult)`` recording the MAPE, capture mode and item
    count (Req 22.3), with ``failed`` set iff MAPE is at/above the applicable
    threshold (Req 22.4). The result is retained (returned) whether the run
    passed or failed.

    Rejects (validation rejection, prior state preserved) when:
      * the mode's dataset is smaller than ``min_dataset_size`` (Req 22.1/22.2),
      * any estimate is negative (enforces Req 22.5), or
      * any ground-truth value is not positive (MAPE undefined).
    """
    mode_items = [it for it in items if it.capture_mode == capture_mode]

    if len(mode_items) < min_dataset_size:
        return err(
            validation_rejection(
                "DATASET_TOO_SMALL",
                f"{capture_mode.value} dataset has {len(mode_items)} items; "
                f"at least {min_dataset_size} are required",
            )
        )

    negative = next(
        (it for it in mode_items if not is_non_negative_estimate(it.estimated_kcal)),
        None,
    )
    if negative is not None:
        return err(
            validation_rejection(
                "NEGATIVE_CALORIE_ESTIMATE",
                f"item {negative.item_id!r} has a negative calorie estimate "
                f"({negative.estimated_kcal}); estimates must be >= 0 kcal",
            )
        )

    non_positive_gt = next(
        (it for it in mode_items if it.ground_truth_kcal <= 0), None
    )
    if non_positive_gt is not None:
        return err(
            validation_rejection(
                "INVALID_GROUND_TRUTH",
                f"item {non_positive_gt.item_id!r} has non-positive ground truth "
                f"({non_positive_gt.ground_truth_kcal}); MAPE requires > 0",
            )
        )

    mape = compute_mape(mode_items)
    threshold = threshold_for(capture_mode)
    failed = is_run_failed(mape, capture_mode)

    if failed:
        message = (
            f"Accuracy run FAILED for {capture_mode.value}: measured MAPE "
            f"{mape:.2f}% >= threshold {threshold:.1f}%"
        )
    else:
        message = (
            f"Accuracy run passed for {capture_mode.value}: measured MAPE "
            f"{mape:.2f}% < threshold {threshold:.1f}%"
        )

    return ok(
        AccuracyRunResult(
            capture_mode=capture_mode,
            mape=mape,
            item_count=len(mode_items),
            threshold=threshold,
            failed=failed,
            message=message,
        )
    )


def evaluate_dataset(
    items: Iterable[ValidationItem],
    min_dataset_size: int = MIN_DATASET_SIZE,
) -> dict[CaptureMode, Ok[AccuracyRunResult] | Err]:
    """Evaluate every capture mode present in ``items``, one run per mode.

    Returns a mapping from each capture mode found in the dataset to its
    :func:`evaluate_capture_mode` outcome, so a failing/invalid run for one mode
    never suppresses the recorded result of another.
    """
    dataset = list(items)
    modes = {it.capture_mode for it in dataset}
    return {
        mode: evaluate_capture_mode(dataset, mode, min_dataset_size) for mode in modes
    }
