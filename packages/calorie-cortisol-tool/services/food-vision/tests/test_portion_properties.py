"""Property-based tests for portion estimation & calibration (Tasks 6.5-6.7).

Implements three design correctness properties for the Food Vision Service's
portion logic using Hypothesis (>=100 generated examples each):

  * Property 8:  Scaling reflects reference-object presence
                 (Validates: Requirements 3.3, 3.4)
  * Property 9:  Unprocessable images are rejected atomically
                 (Validates: Requirements 3.5)
  * Property 10: Plate calibration persistence and application
                 (Validates: Requirements 3.6, 3.7)

Unit-level examples for this area live in ``test_portion.py``; these tests
assert the universal properties hold across randomly generated inputs.
"""

from __future__ import annotations

from hypothesis import assume, given, settings
from hypothesis import strategies as st

from app.accuracy_eval import CaptureMode
from app.portion import (
    MIN_HEIGHT,
    MIN_WIDTH,
    REFERENCE_SCALE_FACTORS,
    InMemoryCalibrationStore,
    PortionRequest,
    ReferenceObject,
    calibrate_plate,
    estimate_portion,
    remove_calibration,
)
from app.result import Err, Ok, is_err, is_ok

# ---------------------------------------------------------------------------
# Generators
# ---------------------------------------------------------------------------

user_ids = st.text(
    alphabet=st.characters(min_codepoint=97, max_codepoint=122),
    min_size=1,
    max_size=8,
)

capture_modes = st.sampled_from(list(CaptureMode))

reference_objects = st.sampled_from(list(ReferenceObject))
optional_reference = st.one_of(st.none(), reference_objects)

raw_volumes = st.floats(
    min_value=0.0, max_value=5000.0, allow_nan=False, allow_infinity=False
)

# Resolutions at or above the 640x480 minimum -> processable.
processable_widths = st.integers(min_value=MIN_WIDTH, max_value=8000)
processable_heights = st.integers(min_value=MIN_HEIGHT, max_value=8000)


@st.composite
def processable_requests(draw: st.DrawFn) -> PortionRequest:
    """A request that clears the Req 3.5 gate (food region + resolution)."""
    return PortionRequest(
        user_id=draw(user_ids),
        capture_mode=draw(capture_modes),
        width=draw(processable_widths),
        height=draw(processable_heights),
        has_food_region=True,
        raw_volume_ml=draw(raw_volumes),
        reference_object=draw(optional_reference),
    )


def _unwrap(result: Ok | Err):
    assert is_ok(result), f"expected Ok, got {result}"
    return result.value  # type: ignore[attr-defined]


# ---------------------------------------------------------------------------
# Property 8: Scaling reflects reference-object presence
# Feature: calorie-cortisol-tool, Property 8
# Validates: Requirements 3.3, 3.4
# ---------------------------------------------------------------------------


@settings(max_examples=100)
@given(request=processable_requests())
def test_property_8_scaling_reflects_reference_object(
    request: PortionRequest,
) -> None:
    """For any processable image (with no stored calibration), the returned
    volume estimate is flagged scaled if and only if a reference object is
    detected, and the estimate is never discarded when unscaled.

    Feature: calorie-cortisol-tool, Property 8
    Validates: Requirements 3.3, 3.4
    """
    store = InMemoryCalibrationStore()  # no calibration for this user
    result = estimate_portion(request, store)
    estimate = _unwrap(result)

    has_reference = request.reference_object is not None

    # scaled iff a reference object was detected (Req 3.3).
    assert estimate.scaled is has_reference
    assert estimate.calibration_applied is False

    # The estimate is always produced (never discarded), even when unscaled,
    # and accuracy-reduced is the complement of scaled (Req 3.4).
    assert estimate.volume_ml >= 0.0
    assert estimate.accuracy_reduced is (not has_reference)

    if has_reference:
        expected = request.raw_volume_ml * REFERENCE_SCALE_FACTORS[
            request.reference_object
        ]
        assert estimate.volume_ml == max(0.0, expected)
    else:
        # Unscaled estimate keeps the raw signal rather than being discarded.
        assert estimate.volume_ml == max(0.0, request.raw_volume_ml)


# ---------------------------------------------------------------------------
# Property 9: Unprocessable images are rejected atomically
# Feature: calorie-cortisol-tool, Property 9
# Validates: Requirements 3.5
# ---------------------------------------------------------------------------


@settings(max_examples=100)
@given(
    user_id=user_ids,
    capture_mode=capture_modes,
    width=st.integers(min_value=1, max_value=8000),
    height=st.integers(min_value=1, max_value=8000),
    has_food_region=st.booleans(),
    raw_volume_ml=raw_volumes,
    reference_object=optional_reference,
)
def test_property_9_unprocessable_images_rejected_atomically(
    user_id: str,
    capture_mode: CaptureMode,
    width: int,
    height: int,
    has_food_region: bool,
    raw_volume_ml: float,
    reference_object: ReferenceObject | None,
) -> None:
    """For any image with no detectable food region or resolution below
    640x480, the portion submission is rejected with a reason and no partial
    estimate is retained.

    Feature: calorie-cortisol-tool, Property 9
    Validates: Requirements 3.5
    """
    unprocessable = (not has_food_region) or width < MIN_WIDTH or height < MIN_HEIGHT
    assume(unprocessable)

    request = PortionRequest(
        user_id=user_id,
        capture_mode=capture_mode,
        width=width,
        height=height,
        has_food_region=has_food_region,
        raw_volume_ml=raw_volume_ml,
        reference_object=reference_object,
    )
    result = estimate_portion(request, InMemoryCalibrationStore())

    # Rejected atomically: an Err with a reason, no partial estimate returned.
    assert is_err(result)
    assert isinstance(result, Err)
    assert result.error.code in {"NO_FOOD_REGION", "RESOLUTION_TOO_LOW"}
    assert result.error.message  # a non-empty reason is provided
    assert result.error.retained_state is True

    # The missing-food-region gate takes precedence over the resolution gate.
    if not has_food_region:
        assert result.error.code == "NO_FOOD_REGION"


# ---------------------------------------------------------------------------
# Property 10: Plate calibration persistence and application
# Feature: calorie-cortisol-tool, Property 10
# Validates: Requirements 3.6, 3.7
# ---------------------------------------------------------------------------


@settings(max_examples=100)
@given(
    request=processable_requests(),
    reference_scale=st.floats(
        min_value=0.1, max_value=10.0, allow_nan=False, allow_infinity=False
    ),
    n_estimations=st.integers(min_value=1, max_value=5),
)
def test_property_10_calibration_persistence_and_application(
    request: PortionRequest, reference_scale: float, n_estimations: int
) -> None:
    """For any user who successfully calibrates a plate, all subsequent
    estimations use the stored calibration as the reference scale until it is
    changed or removed; and if persistence fails, the previously stored
    calibration (or none) remains in effect.

    Feature: calorie-cortisol-tool, Property 10
    Validates: Requirements 3.6, 3.7
    """
    store = InMemoryCalibrationStore()

    saved = calibrate_plate(
        request.user_id, reference_scale, store, updated_at="2024-01-01T00:00:00Z"
    )
    assert is_ok(saved)

    # Every subsequent estimation applies the stored calibration, regardless of
    # any detected reference object, until the calibration changes (Req 3.6).
    for _ in range(n_estimations):
        estimate = _unwrap(estimate_portion(request, store))
        assert estimate.calibration_applied is True
        assert estimate.scaled is True
        assert estimate.volume_ml == max(0.0, request.raw_volume_ml * reference_scale)

    # Req 3.7: a failed persistence attempt leaves the prior calibration intact.
    store.fail_saves = True
    failed = calibrate_plate(
        request.user_id, reference_scale * 2, store, updated_at="2024-02-02T00:00:00Z"
    )
    assert is_err(failed)
    assert isinstance(failed, Err)
    assert failed.error.retained_state is True
    # The previously stored calibration is still applied unchanged.
    still = _unwrap(estimate_portion(request, store))
    assert still.calibration_applied is True
    assert still.volume_ml == max(0.0, request.raw_volume_ml * reference_scale)
    store.fail_saves = False

    # Once removed, subsequent estimations fall back to reference-object scaling
    # (or unscaled) -- the calibration is no longer applied (Req 3.6).
    remove_calibration(request.user_id, store)
    after_removal = _unwrap(estimate_portion(request, store))
    assert after_removal.calibration_applied is False
    assert after_removal.scaled is (request.reference_object is not None)
