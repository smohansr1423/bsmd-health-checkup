"""Property-based tests for the recognition endpoint (Tasks 6.2, 6.3).

Implements two design correctness properties for the Food Vision Service's
confidence-gating logic using Hypothesis (>=100 generated examples each):

  * Property 6: Detection output bounds (Validates: Requirements 2.2)
  * Property 7: Confidence-threshold branching (Validates: Requirements 2.3, 2.7)

The unit-level examples for this area live in ``test_recognition.py``; these
tests assert the universal properties hold across randomly generated
detections.
"""

from __future__ import annotations

from hypothesis import given, settings
from hypothesis import strategies as st

from app.recognition import (
    CONFIDENCE_AUTO_THRESHOLD,
    CONFIDENCE_MAX,
    CONFIDENCE_MIN,
    MAX_DETECTED_ITEMS,
    TOP_CANDIDATE_COUNT,
    Candidate,
    RawDetection,
    RecognitionMode,
    is_auto_classified,
    recognize,
)
from app.result import Ok, is_ok

# ---------------------------------------------------------------------------
# Generators
# ---------------------------------------------------------------------------

# Valid per-item confidences lie in the inclusive 0..100 range (Req 2.2).
confidences = st.floats(
    min_value=CONFIDENCE_MIN,
    max_value=CONFIDENCE_MAX,
    allow_nan=False,
    allow_infinity=False,
)

labels = st.text(
    alphabet=st.characters(min_codepoint=97, max_codepoint=122),
    min_size=1,
    max_size=8,
)


@st.composite
def raw_detections(draw: st.DrawFn) -> RawDetection:
    """A valid detection: >=1 candidate, ordered by descending confidence."""
    region_id = draw(st.text(min_size=1, max_size=6))
    confs = draw(st.lists(confidences, min_size=1, max_size=5))
    # Candidates must be ranked highest-first (contract of RawDetection).
    confs.sort(reverse=True)
    cands = tuple(
        Candidate(label=draw(labels), confidence=c) for c in confs
    )
    return RawDetection(region_id=region_id, candidates=cands)


detection_lists = st.lists(raw_detections(), min_size=0, max_size=30)


def _unwrap(result: Ok | object):
    assert is_ok(result), f"expected Ok, got {result}"
    return result.value  # type: ignore[attr-defined]


# ---------------------------------------------------------------------------
# Property 6: Detection output bounds
# Feature: calorie-cortisol-tool, Property 6
# Validates: Requirements 2.2
# ---------------------------------------------------------------------------


@settings(max_examples=100)
@given(detections=detection_lists)
def test_property_6_detection_output_bounds(detections: list[RawDetection]) -> None:
    """For any recognition result, the number of detected items is at most 20
    and every per-item confidence lies within the inclusive range 0..100.

    Feature: calorie-cortisol-tool, Property 6
    Validates: Requirements 2.2
    """
    result = recognize(detections)
    res = _unwrap(result)

    # At most 20 items are ever returned (items + prompts).
    assert res.count <= MAX_DETECTED_ITEMS
    assert res.count == len(res.items) + len(res.prompts)
    assert len(res.items) + len(res.prompts) <= MAX_DETECTED_ITEMS

    # Every auto-classified item carries a valid 0..100 confidence.
    for item in res.items:
        assert CONFIDENCE_MIN <= item.confidence <= CONFIDENCE_MAX

    # Every surfaced candidate confidence is also within range.
    for prompt in res.prompts:
        for cand in prompt.top_candidates:
            assert CONFIDENCE_MIN <= cand.confidence <= CONFIDENCE_MAX


# ---------------------------------------------------------------------------
# Property 7: Confidence-threshold branching
# Feature: calorie-cortisol-tool, Property 7
# Validates: Requirements 2.3, 2.7
# ---------------------------------------------------------------------------


@settings(max_examples=100)
@given(detections=detection_lists, mode=st.sampled_from(list(RecognitionMode)))
def test_property_7_confidence_threshold_branching(
    detections: list[RawDetection], mode: RecognitionMode
) -> None:
    """For any detection, an item with confidence below 70 yields a top-3
    candidate confirmation prompt rather than automatic classification; and if
    no item reaches 70, the result is "no food recognized" with the image
    retained for the session.

    Feature: calorie-cortisol-tool, Property 7
    Validates: Requirements 2.3, 2.7
    """
    result = recognize(detections, mode=mode)
    res = _unwrap(result)

    any_auto = any(is_auto_classified(d) for d in detections)

    if not any_auto:
        # Req 2.7: no item >= 70 -> "no food recognized" + image retained.
        assert res.recognized is False
        assert res.items == ()
        assert res.prompts == ()
        assert res.count == 0
        assert res.image_retained is True
    else:
        assert res.recognized is True
        # Every auto-classified item is >= threshold (Req 2.3).
        for item in res.items:
            assert item.confidence >= CONFIDENCE_AUTO_THRESHOLD
        # Every prompt is a below-threshold region, surfaced for confirmation
        # rather than auto-classified, with at most top-3 candidates (Req 2.3).
        for prompt in res.prompts:
            assert prompt.top_candidates[0].confidence < CONFIDENCE_AUTO_THRESHOLD
            assert 1 <= len(prompt.top_candidates) <= TOP_CANDIDATE_COUNT
