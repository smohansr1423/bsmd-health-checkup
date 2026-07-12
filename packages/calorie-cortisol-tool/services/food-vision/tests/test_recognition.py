"""Unit tests for the recognition endpoint with confidence gating (Task 6.1).

Covers the confidence-threshold branching, the 20-item detection cap, the
"no food recognized" outcome with image retention, and the restaurant
menu-OCR/POS path with fallback to standard classification.

The design correctness properties for this area (Property 6: detection output
bounds; Property 7: confidence-threshold branching) are implemented separately
in the optional PBT tasks 6.2 and 6.3.

Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7
"""

from app.recognition import (
    CONFIDENCE_AUTO_THRESHOLD,
    MAX_DETECTED_ITEMS,
    TOP_CANDIDATE_COUNT,
    BoundingBox,
    Candidate,
    RawDetection,
    RecognitionMode,
    RecognitionSource,
    recognize,
)
from app.result import Err, Ok, is_err, is_ok


def _det(region_id: str, *pairs: tuple[str, float], bbox: BoundingBox | None = None) -> RawDetection:
    """Build a RawDetection from (label, confidence) pairs, highest first."""
    return RawDetection(
        region_id=region_id,
        candidates=tuple(Candidate(label=lbl, confidence=conf) for lbl, conf in pairs),
        bbox=bbox,
    )


def _unwrap(result: Ok | Err):
    assert is_ok(result), f"expected Ok, got {result}"
    return result.value


# ---------------------------------------------------------------------------
# Auto-classification (confidence >= 70)
# ---------------------------------------------------------------------------


def test_high_confidence_item_is_auto_classified() -> None:
    res = _unwrap(recognize([_det("r1", ("apple", 92.0))]))
    assert res.recognized is True
    assert res.count == 1
    assert len(res.items) == 1 and len(res.prompts) == 0
    assert res.items[0].label == "apple"
    assert res.items[0].confidence == 92.0
    assert res.image_retained is True
    assert res.source is RecognitionSource.STANDARD


def test_confidence_exactly_at_threshold_is_auto_classified() -> None:
    # Req 2.3: "below 70" needs confirmation; exactly 70 auto-classifies.
    res = _unwrap(recognize([_det("r1", ("rice", CONFIDENCE_AUTO_THRESHOLD))]))
    assert res.recognized is True
    assert len(res.items) == 1 and len(res.prompts) == 0


def test_bbox_is_preserved_on_recognized_item() -> None:
    box = BoundingBox(0.1, 0.2, 0.3, 0.4)
    res = _unwrap(recognize([_det("r1", ("steak", 80.0), bbox=box)]))
    assert res.items[0].bbox == box


# ---------------------------------------------------------------------------
# Low-confidence branch (< 70 -> top-3 candidate prompt)  (Req 2.3)
# ---------------------------------------------------------------------------


def test_low_confidence_item_yields_top3_prompt_when_another_item_recognized() -> None:
    res = _unwrap(
        recognize(
            [
                _det("hi", ("pizza", 88.0)),
                _det(
                    "lo",
                    ("burrito", 55.0),
                    ("taco", 30.0),
                    ("wrap", 10.0),
                    ("quesadilla", 5.0),
                ),
            ]
        )
    )
    assert res.recognized is True
    assert len(res.items) == 1
    assert len(res.prompts) == 1
    prompt = res.prompts[0]
    assert prompt.region_id == "lo"
    # Only the top 3 candidates are surfaced.
    assert len(prompt.top_candidates) == TOP_CANDIDATE_COUNT
    assert [c.label for c in prompt.top_candidates] == ["burrito", "taco", "wrap"]


def test_prompt_with_fewer_than_three_candidates_returns_all() -> None:
    res = _unwrap(
        recognize([_det("hi", ("pizza", 88.0)), _det("lo", ("soup", 40.0), ("broth", 20.0))])
    )
    assert len(res.prompts) == 1
    assert len(res.prompts[0].top_candidates) == 2


# ---------------------------------------------------------------------------
# No food recognized (no item >= 70)  (Req 2.7)
# ---------------------------------------------------------------------------


def test_no_item_above_threshold_yields_no_food_recognized_and_retains_image() -> None:
    res = _unwrap(recognize([_det("r1", ("mystery", 40.0)), _det("r2", ("blur", 12.0))]))
    assert res.recognized is False
    assert res.count == 0
    assert res.items == () and res.prompts == ()
    assert res.image_retained is True
    assert "no food" in res.message.lower()


def test_empty_detection_set_is_no_food_recognized() -> None:
    res = _unwrap(recognize([]))
    assert res.recognized is False
    assert res.image_retained is True


# ---------------------------------------------------------------------------
# 20-item cap (Req 2.2)
# ---------------------------------------------------------------------------


def test_detection_count_capped_at_twenty_keeping_highest_confidence() -> None:
    # 25 items with descending confidence from 99 down to 75 (all >= 70).
    dets = [_det(f"r{i}", (f"food{i}", 99.0 - i)) for i in range(25)]
    res = _unwrap(recognize(dets))
    assert res.count == MAX_DETECTED_ITEMS
    assert len(res.items) == MAX_DETECTED_ITEMS
    # The 5 lowest-confidence detections (r20..r24) are dropped.
    kept = {item.region_id for item in res.items}
    assert "r0" in kept
    assert "r24" not in kept


# ---------------------------------------------------------------------------
# Restaurant menu-OCR / POS path with fallback (Req 2.4, 2.5)
# ---------------------------------------------------------------------------


def test_restaurant_mode_uses_menu_ocr_detections_when_available() -> None:
    standard = [_det("s1", ("generic bowl", 85.0))]
    menu = [_det("m1", ("Chef's Special Ramen", 90.0))]
    res = _unwrap(
        recognize(standard, mode=RecognitionMode.RESTAURANT, menu_detections=menu)
    )
    assert res.source is RecognitionSource.MENU_OCR
    assert res.items[0].label == "Chef's Special Ramen"


def test_restaurant_mode_falls_back_to_standard_when_menu_unavailable() -> None:
    standard = [_det("s1", ("pasta", 82.0))]
    res = _unwrap(
        recognize(standard, mode=RecognitionMode.RESTAURANT, menu_detections=None)
    )
    assert res.source is RecognitionSource.STANDARD
    assert res.items[0].label == "pasta"
    assert res.items[0].confidence == 82.0


def test_restaurant_mode_falls_back_when_menu_detections_empty() -> None:
    standard = [_det("s1", ("salad", 76.0))]
    res = _unwrap(
        recognize(standard, mode=RecognitionMode.RESTAURANT, menu_detections=[])
    )
    assert res.source is RecognitionSource.STANDARD
    assert res.items[0].label == "salad"


# ---------------------------------------------------------------------------
# Validation rejections (prior state preserved)
# ---------------------------------------------------------------------------


def test_confidence_above_100_is_rejected() -> None:
    result = recognize([_det("r1", ("apple", 120.0))])
    assert is_err(result)
    assert result.error.code == "INVALID_CONFIDENCE"
    assert result.error.retained_state is True


def test_negative_confidence_is_rejected() -> None:
    result = recognize([_det("r1", ("apple", -1.0))])
    assert is_err(result)
    assert result.error.code == "INVALID_CONFIDENCE"


def test_detection_with_no_candidates_is_rejected() -> None:
    result = recognize([RawDetection(region_id="r1", candidates=(), bbox=None)])
    assert is_err(result)
    assert result.error.code == "EMPTY_DETECTION"
