"""Unit tests for recurring-pattern surfacing and milestone ranking (Task 11.4).

Covers Req 15.5 (recurring same-direction significant relationship on >=3 separate
days within a rolling 30-day window) and Req 15.8 (milestone insight ranking by
descending correlation strength). Property tests 11.5/11.6 are implemented separately.
"""

from __future__ import annotations

from datetime import date, timedelta

from cc_contracts.domain import Insight

from app.patterns import (
    MILESTONE_DAYS,
    RECURRING_MIN_DISTINCT_DAYS,
    DailyDetection,
    detect_recurring_patterns,
    is_milestone_day,
    latest_milestone_reached,
    rank_insights,
    rank_score_from_coefficient,
    rank_surfaced_insights,
)

BASE = date(2024, 6, 1)


def _det(day_offset: int, coefficient: float, significant: bool = True, key: str = "calories~cortisol") -> DailyDetection:
    return DailyDetection(
        day=BASE + timedelta(days=day_offset),
        significant=significant,
        coefficient=coefficient,
        relationship_key=key,
    )


# ---------------------------------------------------------------------------
# Recurring-pattern surfacing (Req 15.5)
# ---------------------------------------------------------------------------


def test_recurring_surfaced_at_three_distinct_days() -> None:
    detections = [_det(0, 0.6), _det(2, 0.7), _det(5, 0.55)]
    patterns = detect_recurring_patterns(detections)
    assert len(patterns) == 1
    assert patterns[0].direction == "positive"
    assert patterns[0].distinct_days == 3
    assert "recurring" in patterns[0].message.lower()


def test_not_surfaced_below_three_distinct_days() -> None:
    detections = [_det(0, 0.6), _det(2, 0.7)]
    assert detect_recurring_patterns(detections) == []


def test_multiple_detections_same_day_count_once() -> None:
    # Four detections but only on two distinct days -> not recurring.
    detections = [_det(0, 0.6), _det(0, 0.8), _det(3, 0.7), _det(3, 0.9)]
    assert detect_recurring_patterns(detections) == []


def test_opposite_directions_counted_independently() -> None:
    # Three positive days and three negative days -> two separate patterns.
    detections = [
        _det(0, 0.6), _det(1, 0.7), _det(2, 0.55),
        _det(3, -0.6), _det(4, -0.7), _det(5, -0.8),
    ]
    patterns = detect_recurring_patterns(detections)
    directions = sorted(p.direction for p in patterns)
    assert directions == ["negative", "positive"]


def test_non_significant_detections_ignored() -> None:
    detections = [_det(0, 0.6), _det(1, 0.7, significant=False), _det(2, 0.55, significant=False)]
    assert detect_recurring_patterns(detections) == []


def test_detections_outside_rolling_window_excluded() -> None:
    # Two in-window days plus one 40 days earlier (outside the 30-day window).
    detections = [_det(0, 0.6), _det(-2, 0.7), _det(-40, 0.8)]
    # reference day is the latest (offset 0); the -40 day is out of window.
    assert detect_recurring_patterns(detections) == []


def test_reference_day_defines_window_end() -> None:
    detections = [_det(0, 0.6), _det(10, 0.7), _det(20, 0.55)]
    # Explicit reference day 20 keeps all three within the trailing 30 days.
    patterns = detect_recurring_patterns(detections, reference_day=BASE + timedelta(days=20))
    assert len(patterns) == 1 and patterns[0].distinct_days == 3


def test_distinct_relationships_surfaced_separately() -> None:
    detections = [
        _det(0, 0.6, key="a"), _det(1, 0.7, key="a"), _det(2, 0.55, key="a"),
        _det(0, 0.6, key="b"), _det(1, 0.7, key="b"), _det(2, 0.55, key="b"),
    ]
    patterns = detect_recurring_patterns(detections)
    assert [p.relationship_key for p in patterns] == ["a", "b"]  # deterministic sort


def test_empty_detections_returns_empty() -> None:
    assert detect_recurring_patterns([]) == []


def test_recurring_threshold_constant() -> None:
    assert RECURRING_MIN_DISTINCT_DAYS == 3


# ---------------------------------------------------------------------------
# Milestone insight ranking (Req 15.8)
# ---------------------------------------------------------------------------


def _insight(insight_id: str, rank_score: float) -> Insight:
    return Insight(
        id=insight_id,
        template_id="tpl",
        approval_status="approved",
        disclaimer_rendered=True,
        rank_score=rank_score,
    )


def test_milestone_days_are_30_90_180() -> None:
    assert MILESTONE_DAYS == (30, 90, 180)


def test_is_milestone_day_exact() -> None:
    assert is_milestone_day(30)
    assert is_milestone_day(90)
    assert is_milestone_day(180)
    assert not is_milestone_day(29)
    assert not is_milestone_day(100)


def test_latest_milestone_reached() -> None:
    assert latest_milestone_reached(29) is None
    assert latest_milestone_reached(30) == 30
    assert latest_milestone_reached(89) == 30
    assert latest_milestone_reached(90) == 90
    assert latest_milestone_reached(200) == 180


def test_rank_insights_descending_strength() -> None:
    insights = [_insight("a", 0.2), _insight("b", 0.9), _insight("c", 0.5)]
    ranked = rank_insights(insights)
    assert [i.id for i in ranked] == ["b", "c", "a"]
    scores = [i.rank_score for i in ranked]
    assert scores == sorted(scores, reverse=True)


def test_rank_insights_tie_break_on_id() -> None:
    insights = [_insight("z", 0.5), _insight("a", 0.5), _insight("m", 0.5)]
    assert [i.id for i in rank_insights(insights)] == ["a", "m", "z"]


def test_rank_insights_does_not_mutate_input() -> None:
    insights = [_insight("a", 0.2), _insight("b", 0.9)]
    original = list(insights)
    rank_insights(insights)
    assert insights == original


def test_rank_surfaced_insights_triggers_at_milestone() -> None:
    insights = [_insight("a", 0.2), _insight("b", 0.9)]
    outcome = rank_surfaced_insights(90, insights)
    assert outcome.triggered and outcome.milestone == 90
    assert [i.id for i in outcome.ranked_insights] == ["b", "a"]


def test_rank_surfaced_insights_untriggered_before_milestone() -> None:
    insights = [_insight("a", 0.2), _insight("b", 0.9)]
    outcome = rank_surfaced_insights(10, insights)
    assert not outcome.triggered and outcome.milestone is None
    # Original order preserved when no milestone reached.
    assert [i.id for i in outcome.ranked_insights] == ["a", "b"]


def test_rank_score_from_coefficient_is_magnitude_clamped() -> None:
    assert rank_score_from_coefficient(-0.7) == 0.7
    assert rank_score_from_coefficient(0.4) == 0.4
    assert rank_score_from_coefficient(1.5) == 1.0
    assert rank_score_from_coefficient(0.0) == 0.0
