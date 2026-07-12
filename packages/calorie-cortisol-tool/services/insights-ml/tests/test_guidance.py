"""Unit tests for the actionable cortisol guidance engine (Task 11.7).

Covers the readiness gate (Req 13.4), 1–5 approved recommendation cards drawn from
clinically approved templates matching the most-recent classification (Req 13.1), and
professional-referral precedence when cortisol stays above the referral threshold for ≥3
consecutive weeks (Req 13.2). Approval-status filtering / disclaimer / diagnostic-term
exclusion (Req 13.3/13.5/29.x) are owned by Task 11.10 and only exercised here through the
injectable template-filter seam. Property tests 11.8/11.9 are implemented separately.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import List, Optional, Sequence

from cc_contracts.domain import Classification, CortisolReading, ReferenceContext

from app.guidance import (
    DEFAULT_REFERRAL_CARD,
    GUIDANCE_MIN_READING_DAYS,
    REFERRAL_CONSECUTIVE_WEEKS,
    GuidanceRequest,
    RecommendationTemplate,
    consecutive_elevated_weeks,
    distinct_reading_days,
    generate_guidance,
    handle_guidance,
    most_recent_classification,
    select_approved,
    select_recommendation_cards,
)

BASE = datetime(2024, 6, 1, 9, 0, 0)


def _reading(
    day_offset: float,
    value: float = 12.0,
    classification: Optional[Classification] = None,
    valid: bool = True,
    reading_id: Optional[str] = None,
) -> CortisolReading:
    """Build a cortisol reading ``day_offset`` days after BASE."""
    ts = BASE + timedelta(days=day_offset)
    ctx = (
        ReferenceContext(
            age_band="30-39",
            sex="F",
            ref_lower=5.0,
            ref_upper=20.0,
            classification=classification,
        )
        if classification is not None
        else None
    )
    return CortisolReading(
        id=reading_id or f"r{day_offset}",
        user_id="u1",
        measured_at=ts.isoformat(),
        value_nmol_l=value,
        source="patch",
        time_of_day_bucket="morning",
        valid=valid,
        contextualized=ctx,
    )


def _template(
    template_id: str,
    classifications: Sequence[Classification] = ("below", "normal", "above"),
    approval_status: str = "approved",
    priority: float = 0.0,
) -> RecommendationTemplate:
    return RecommendationTemplate(
        id=template_id,
        approval_status=approval_status,
        title=f"Title {template_id}",
        body=f"Body {template_id}",
        applicable_classifications=tuple(classifications),
        priority=priority,
    )


def _days_of_readings(
    n_days: int, value: float = 12.0, classification: Optional[Classification] = None
) -> List[CortisolReading]:
    """One reading per day for ``n_days`` distinct days ending at BASE."""
    return [
        _reading(-offset, value=value, classification=classification, reading_id=f"d{offset}")
        for offset in range(n_days)
    ]


# ---------------------------------------------------------------------------
# Readiness gate (Req 13.4)
# ---------------------------------------------------------------------------


def test_withholds_cards_below_seven_days() -> None:
    readings = _days_of_readings(6, classification="above")
    templates = [_template("t1", ["above"])]
    outcome = generate_guidance(
        GuidanceRequest(user_id="u1", readings=readings, templates=templates)
    )
    assert outcome.ready is False
    assert outcome.more_readings_required is True
    assert outcome.cards == []
    assert outcome.readings_retained is True  # readings kept, not discarded
    assert "more readings required" in (outcome.message or "").lower()


def test_ready_exactly_at_seven_days() -> None:
    readings = _days_of_readings(GUIDANCE_MIN_READING_DAYS, classification="above")
    templates = [_template("t1", ["above"])]
    outcome = generate_guidance(
        GuidanceRequest(user_id="u1", readings=readings, templates=templates)
    )
    assert outcome.ready is True
    assert outcome.more_readings_required is False
    assert len(outcome.cards) >= 1


def test_distinct_days_counts_days_not_readings() -> None:
    # Ten readings but all on the same calendar day -> one distinct day.
    readings = [_reading(0.0 + i * 0.01, reading_id=f"r{i}") for i in range(10)]
    assert distinct_reading_days(readings) == 1


def test_distinct_days_ignores_invalid_readings() -> None:
    readings = [
        _reading(0, reading_id="a"),
        _reading(-1, reading_id="b", valid=False),
        _reading(-2, reading_id="c"),
    ]
    assert distinct_reading_days(readings) == 2


# ---------------------------------------------------------------------------
# Recommendation cards (Req 13.1)
# ---------------------------------------------------------------------------


def test_cards_presented_for_outside_normal_classification() -> None:
    readings = _days_of_readings(7, classification="above")
    templates = [_template("t1", ["above"]), _template("t2", ["above"])]
    outcome = generate_guidance(
        GuidanceRequest(user_id="u1", readings=readings, templates=templates)
    )
    assert 1 <= len(outcome.cards) <= 5
    assert {c.template_id for c in outcome.cards} == {"t1", "t2"}


def test_no_cards_when_most_recent_is_normal() -> None:
    readings = _days_of_readings(7, classification="normal")
    templates = [_template("t1", ["above"]), _template("t2", ["normal"])]
    outcome = generate_guidance(
        GuidanceRequest(user_id="u1", readings=readings, templates=templates)
    )
    # Most recent classification is normal -> no recommendation cards (Req 13.1 gate).
    assert outcome.ready is True
    assert outcome.cards == []


def test_card_count_clamped_to_five() -> None:
    readings = _days_of_readings(7, classification="above")
    templates = [_template(f"t{i}", ["above"]) for i in range(8)]
    cards = select_recommendation_cards(templates, "above")
    assert len(cards) == 5


def test_cards_only_match_classification() -> None:
    templates = [
        _template("above1", ["above"]),
        _template("below1", ["below"]),
        _template("normal1", ["normal"]),
    ]
    cards = select_recommendation_cards(templates, "above")
    assert [c.template_id for c in cards] == ["above1"]


def test_cards_ordered_by_priority_then_id() -> None:
    templates = [
        _template("b", ["above"], priority=1.0),
        _template("a", ["above"], priority=1.0),
        _template("c", ["above"], priority=5.0),
    ]
    cards = select_recommendation_cards(templates, "above")
    assert [c.template_id for c in cards] == ["c", "a", "b"]


# ---------------------------------------------------------------------------
# Approval seam (default port) — full policy owned by Task 11.10
# ---------------------------------------------------------------------------


def test_default_port_excludes_non_approved_templates() -> None:
    templates = [
        _template("ok", ["above"], approval_status="approved"),
        _template("draft", ["above"], approval_status="draft"),
        _template("pending", ["above"], approval_status="pending"),
        _template("revoked", ["above"], approval_status="revoked"),
    ]
    cards = select_recommendation_cards(templates, "above")
    assert [c.template_id for c in cards] == ["ok"]


def test_custom_filter_port_is_honored() -> None:
    templates = [_template("t1", ["above"]), _template("t2", ["above"])]

    def only_t2(ts: Sequence[RecommendationTemplate]) -> List[RecommendationTemplate]:
        return [t for t in ts if t.id == "t2"]

    readings = _days_of_readings(7, classification="above")
    outcome = generate_guidance(
        GuidanceRequest(user_id="u1", readings=readings, templates=templates),
        filter_port=only_t2,
    )
    assert [c.template_id for c in outcome.cards] == ["t2"]


def test_select_approved_directly() -> None:
    templates = [
        _template("a", approval_status="approved"),
        _template("b", approval_status="draft"),
    ]
    assert [t.id for t in select_approved(templates)] == ["a"]


# ---------------------------------------------------------------------------
# Referral precedence (Req 13.2)
# ---------------------------------------------------------------------------


def _three_weeks_above(threshold: float) -> List[CortisolReading]:
    """Readings on multiple days across three consecutive weeks, all above ``threshold``."""
    readings: List[CortisolReading] = []
    # 21 days back to today, two readings per day, all above threshold.
    for offset in range(21):
        readings.append(
            _reading(-offset, value=threshold + 5.0, classification="above", reading_id=f"w{offset}")
        )
    return readings


def test_referral_triggered_after_three_consecutive_weeks() -> None:
    threshold = 20.0
    readings = _three_weeks_above(threshold)
    templates = [_template("t1", ["above"])]
    outcome = generate_guidance(
        GuidanceRequest(
            user_id="u1",
            readings=readings,
            templates=templates,
            referral_threshold_nmol_l=threshold,
        )
    )
    assert outcome.referral_triggered is True
    # Referral card is present and ordered above all other cards.
    assert outcome.cards[0].is_referral is True
    assert outcome.cards[0].template_id == DEFAULT_REFERRAL_CARD.template_id
    assert all(not c.is_referral for c in outcome.cards[1:])


def test_referral_uses_supplied_template() -> None:
    threshold = 20.0
    readings = _three_weeks_above(threshold)
    referral_tpl = _template("ref.custom", ["above"])
    outcome = generate_guidance(
        GuidanceRequest(
            user_id="u1",
            readings=readings,
            templates=[],
            referral_threshold_nmol_l=threshold,
            referral_template=referral_tpl,
        )
    )
    assert outcome.cards[0].is_referral is True
    assert outcome.cards[0].template_id == "ref.custom"


def test_referral_not_triggered_with_two_weeks() -> None:
    threshold = 20.0
    # Only 13 days (< 3 full weeks) above threshold, but enough distinct days to be ready.
    readings = [
        _reading(-offset, value=threshold + 5.0, classification="above", reading_id=f"w{offset}")
        for offset in range(13)
    ]
    outcome = generate_guidance(
        GuidanceRequest(
            user_id="u1",
            readings=readings,
            templates=[_template("t1", ["above"])],
            referral_threshold_nmol_l=threshold,
        )
    )
    assert outcome.referral_triggered is False
    assert all(not c.is_referral for c in outcome.cards)


def test_referral_run_broken_by_week_below_threshold() -> None:
    threshold = 20.0
    readings: List[CortisolReading] = []
    # Weeks 0 and 1 above, week 2 contains a dip below threshold -> run breaks at 2.
    for offset in range(21):
        value = threshold + 5.0
        if offset == 17:  # a day inside week 2 drops below threshold
            value = threshold - 5.0
        readings.append(_reading(-offset, value=value, reading_id=f"w{offset}"))
    assert consecutive_elevated_weeks(readings, threshold) == 2


def test_referral_run_broken_by_empty_week() -> None:
    threshold = 20.0
    # Readings only in week 0 and week 2 (week 1 has no data) -> longest run is 1.
    readings = [
        _reading(-2, value=threshold + 5.0, reading_id="a"),
        _reading(-16, value=threshold + 5.0, reading_id="b"),
    ]
    assert consecutive_elevated_weeks(readings, threshold) == 1


def test_consecutive_weeks_empty_readings() -> None:
    assert consecutive_elevated_weeks([], 20.0) == 0


def test_referral_can_trigger_even_when_recent_is_normal() -> None:
    # Cortisol stayed above threshold 3 weeks, but the most recent reading is normal.
    # Referral (Req 13.2) is independent of the classification card gate (Req 13.1).
    # The referral threshold is a distinct clinical threshold from the reference-range
    # classification, so a reading can sit above the referral threshold yet still be
    # classified "normal" for the user's age/sex band. Every day stays above the threshold.
    threshold = 20.0
    readings = [
        _reading(-offset, value=threshold + 5.0, classification="above", reading_id=f"w{offset}")
        for offset in range(1, 21)
    ]
    readings.append(
        _reading(0, value=threshold + 5.0, classification="normal", reading_id="latest")
    )
    outcome = generate_guidance(
        GuidanceRequest(
            user_id="u1",
            readings=readings,
            templates=[_template("t1", ["above"])],
            referral_threshold_nmol_l=threshold,
        )
    )
    assert outcome.referral_triggered is True
    assert outcome.cards[0].is_referral is True
    # No classification cards because the most recent reading is normal.
    assert len(outcome.cards) == 1


# ---------------------------------------------------------------------------
# Classification helper + handler
# ---------------------------------------------------------------------------


def test_most_recent_classification_picks_latest() -> None:
    readings = [
        _reading(-2, classification="below", reading_id="old"),
        _reading(0, classification="above", reading_id="new"),
        _reading(-1, classification="normal", reading_id="mid"),
    ]
    assert most_recent_classification(readings) == "above"


def test_most_recent_classification_respects_reference_time() -> None:
    readings = [
        _reading(-2, classification="below", reading_id="old"),
        _reading(0, classification="above", reading_id="new"),
    ]
    # Pin reference before the newest reading -> the older reading is "most recent".
    ref = BASE - timedelta(days=1)
    assert most_recent_classification(readings, reference_time=ref) == "below"


def test_most_recent_classification_none_without_context() -> None:
    readings = [_reading(0, classification=None)]
    assert most_recent_classification(readings) is None


def test_handle_guidance_delegates_to_generate() -> None:
    readings = _days_of_readings(7, classification="above")
    templates = [_template("t1", ["above"])]
    req = GuidanceRequest(user_id="u1", readings=readings, templates=templates)
    assert handle_guidance(req) == generate_guidance(req)


def test_constants() -> None:
    assert GUIDANCE_MIN_READING_DAYS == 7
    assert REFERRAL_CONSECUTIVE_WEEKS == 3
