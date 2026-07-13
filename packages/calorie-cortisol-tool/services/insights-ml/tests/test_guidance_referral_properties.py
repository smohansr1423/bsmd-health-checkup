"""Property-based tests for guidance referral precedence (Task 11.9).

Exercises the ``POST /guidance`` referral behaviour in ``app.guidance`` against the design's
correctness property:

- **Property 38: Referral card precedence**
  (Task 11.9, Validates: Requirements 13.2)

  *For any* history where cortisol stays above the referral threshold for 3 or more
  consecutive weeks, a professional-referral card is present and ordered above all other
  recommendation cards.

This test isolates the referral condition. It builds histories in which every valid reading
sits strictly above the referral threshold and every one of ``W`` (>= 3) consecutive week
windows counting back from the anchor is populated, so the ``>=3 consecutive elevated weeks``
condition (Req 13.2) always fires. To make the "above all other cards" claim meaningful, the
most-recent reading is classified *outside* the normal range and an approved, matching
template pool is supplied so ordinary recommendation cards are also produced; the referral
card must still lead. Enough distinct days are always generated to clear the readiness gate
(Req 13.4) so the interaction with Property 37 never confounds this property.

The implementation already exists (Task 11.7); these tests only observe it. The property runs
a minimum of 100 generated iterations (``@settings(max_examples=100)``) and is tagged in the
format ``Feature: calorie-cortisol-tool, Property 38``.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import List

from hypothesis import given, settings
from hypothesis import strategies as st

from cc_contracts.constants import GUIDANCE_MAX_CARDS, GUIDANCE_MIN_CARDS
from cc_contracts.domain import Classification, CortisolReading, ReferenceContext

from app.guidance import (
    DEFAULT_REFERRAL_CARD,
    REFERRAL_CONSECUTIVE_WEEKS,
    GuidanceRequest,
    RecommendationTemplate,
    generate_guidance,
)

# Anchor "now"; pinned so the referral week windows are deterministic.
BASE = datetime(2024, 6, 1, 9, 0, 0)

DAYS_PER_WEEK = 7

# Classifications considered "outside the normal reference range" (Req 13.1). The most-recent
# reading carries one of these so ordinary recommendation cards are produced alongside the
# referral card, making the "above all other cards" ordering claim non-vacuous.
_OUTSIDE_NORMAL: List[Classification] = ["below", "above"]

# Approval states other than "approved" — used as noise the engine must reject.
_NON_APPROVED = ["draft", "pending", "revoked"]


def _reading(
    day_offset: int,
    value: float,
    classification: Classification,
    reading_id: str,
) -> CortisolReading:
    """A valid cortisol reading ``day_offset`` whole days before BASE (offset 0 is latest)."""
    ts = BASE - timedelta(days=day_offset)
    ctx = ReferenceContext(
        age_band="30-39",
        sex="F",
        ref_lower=5.0,
        ref_upper=20.0,
        classification=classification,
    )
    return CortisolReading(
        id=reading_id,
        user_id="u1",
        measured_at=ts.isoformat(),
        value_nmol_l=value,
        source="patch",
        time_of_day_bucket="morning",
        valid=True,
        contextualized=ctx,
    )


@st.composite
def _approved_matching_templates(
    draw: st.DrawFn, classification: Classification
) -> List[RecommendationTemplate]:
    """A pool of 1..8 approved templates matching ``classification`` plus ignorable noise.

    Guarantees at least one ordinary recommendation card is produced (so the referral card has
    peers to lead), while proving noise (wrong-classification and non-approved templates) never
    displaces the referral card's precedence.
    """
    m = draw(st.integers(min_value=GUIDANCE_MIN_CARDS, max_value=8))
    other: Classification = "normal" if classification != "normal" else "below"

    templates: List[RecommendationTemplate] = [
        RecommendationTemplate(
            id=f"match-{i}",
            approval_status="approved",
            title=f"Match {i}",
            body=f"Body {i}",
            applicable_classifications=(classification,),
            priority=float(draw(st.integers(min_value=0, max_value=10))),
        )
        for i in range(m)
    ]

    n_wrong = draw(st.integers(min_value=0, max_value=3))
    templates += [
        RecommendationTemplate(
            id=f"wrong-{i}",
            approval_status="approved",
            title=f"Wrong {i}",
            body=f"Body wrong {i}",
            applicable_classifications=(other,),
        )
        for i in range(n_wrong)
    ]

    n_unapproved = draw(st.integers(min_value=0, max_value=3))
    templates += [
        RecommendationTemplate(
            id=f"unapproved-{i}",
            approval_status=draw(st.sampled_from(_NON_APPROVED)),
            title=f"Unapproved {i}",
            body=f"Body unapproved {i}",
            applicable_classifications=(classification,),
        )
        for i in range(n_unapproved)
    ]

    return templates


@st.composite
def _referral_scenario(draw: st.DrawFn):
    """A history that stays above the referral threshold for >= 3 consecutive weeks.

    Builds ``W`` (3..6) consecutive week windows counting back from BASE. Every window is
    populated with 3..7 readings on distinct days, all strictly above the drawn threshold, so
    each window is "elevated" and the run of elevated weeks is exactly ``W`` (>= 3). The
    most-recent reading (offset 0, week 0) carries an outside-normal classification so ordinary
    cards are produced too. With >= 3 days per week the readiness gate (>= 7 distinct days) is
    always cleared.
    """
    threshold = draw(st.floats(min_value=5.0, max_value=50.0, allow_nan=False, allow_infinity=False))
    weeks = draw(st.integers(min_value=REFERRAL_CONSECUTIVE_WEEKS, max_value=6))
    classification = draw(st.sampled_from(_OUTSIDE_NORMAL))

    def above(offset: int, cls: Classification, rid: str) -> CortisolReading:
        delta = draw(st.floats(min_value=0.5, max_value=200.0, allow_nan=False, allow_infinity=False))
        return _reading(offset, threshold + delta, cls, rid)

    readings: List[CortisolReading] = []
    for k in range(weeks):
        base_offset = k * DAYS_PER_WEEK
        candidates = list(range(base_offset, base_offset + DAYS_PER_WEEK))
        # Distinct in-week day offsets; >= 3 per week guarantees the readiness gate is cleared.
        day_offsets = draw(
            st.lists(
                st.sampled_from(candidates),
                min_size=3,
                max_size=DAYS_PER_WEEK,
                unique=True,
            )
        )
        if k == 0 and 0 not in day_offsets:
            # Ensure the latest reading (offset 0) exists so it drives "most recent".
            day_offsets = [0] + [o for o in day_offsets if o != 0][: DAYS_PER_WEEK - 1]
        for off in day_offsets:
            cls: Classification = classification if off == 0 else "above"
            readings.append(above(off, cls, f"w{k}-d{off}"))

    templates = draw(_approved_matching_templates(classification))
    return readings, templates, threshold


# ---------------------------------------------------------------------------
# Property 38: Referral card precedence
# Feature: calorie-cortisol-tool, Property 38
# Validates: Requirements 13.2
# ---------------------------------------------------------------------------


@settings(max_examples=100)
@given(_referral_scenario())
def test_referral_card_present_and_ordered_first(scenario) -> None:
    """Feature: calorie-cortisol-tool, Property 38.

    For any history where cortisol stays above the referral threshold for 3 or more consecutive
    weeks, the guidance engine presents a professional-referral card and orders it above all
    other recommendation cards (Req 13.2).

    Validates: Requirements 13.2
    """
    readings, templates, threshold = scenario
    outcome = generate_guidance(
        GuidanceRequest(
            user_id="u1",
            readings=readings,
            templates=templates,
            referral_threshold_nmol_l=threshold,
        )
    )

    # The >=3-consecutive-elevated-week condition fires.
    assert outcome.referral_triggered is True
    assert outcome.ready is True

    # A referral card is present and it is the first card (above all others).
    assert len(outcome.cards) >= 1
    assert outcome.cards[0].is_referral is True
    assert outcome.cards[0].template_id == DEFAULT_REFERRAL_CARD.template_id

    # Exactly one referral card, and no non-referral card precedes it.
    referral_indices = [i for i, c in enumerate(outcome.cards) if c.is_referral]
    assert referral_indices == [0]
    assert all(not c.is_referral for c in outcome.cards[1:])

    # The referral card leads a non-empty set of ordinary recommendation cards, and the total
    # respects the 1..(referral + 5) bound (referral card + up to GUIDANCE_MAX_CARDS peers).
    ordinary = outcome.cards[1:]
    assert GUIDANCE_MIN_CARDS <= len(ordinary) <= GUIDANCE_MAX_CARDS
