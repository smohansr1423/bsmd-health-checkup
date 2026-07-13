"""Property-based tests for the guidance engine (Task 11.8).

Exercises the ``POST /guidance`` core logic in ``app.guidance`` against the design's
correctness property:

- **Property 37: Guidance card count and readiness gate**
  (Task 11.8, Validates: Requirements 13.1, 13.4)

Property 37 has two halves that mirror the readiness gate:

* *Ready half (Req 13.1)* — with at least 7 distinct days of readings and a most-recent
  reading classified *outside* the normal reference range, the engine presents between 1 and
  5 approved recommendation cards drawn from templates matching that classification.
* *Gate half (Req 13.4)* — with fewer than 7 distinct days of readings, the engine withholds
  all cards, surfaces a "more readings required" message, and retains the collected readings.

To keep this property focused on the card-count/readiness behaviour, the referral condition
(Req 13.2 / Property 38) is deliberately held *off*: the referral threshold is pinned far
above every generated reading value so no referral card is ever prepended. The implementation
already exists (Task 11.7); these tests only observe it.

Each property runs a minimum of 100 generated iterations (``@settings(max_examples=100)``) and
is tagged in the format ``Feature: calorie-cortisol-tool, Property {number}``.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import List, Optional

from hypothesis import given, settings
from hypothesis import strategies as st

from cc_contracts.constants import GUIDANCE_MAX_CARDS, GUIDANCE_MIN_CARDS
from cc_contracts.domain import Classification, CortisolReading, ReferenceContext

from app.guidance import (
    GUIDANCE_MIN_READING_DAYS,
    GuidanceRequest,
    RecommendationTemplate,
    generate_guidance,
)

BASE = datetime(2024, 6, 1, 9, 0, 0)

# A referral threshold pinned far above any generated reading value, so the ≥3-consecutive-week
# referral condition (Req 13.2 / Property 38) never fires and can never confound the
# 1..5 card-count bound under test here.
NO_REFERRAL_THRESHOLD = 1_000_000.0

# Bounded, always-below-``NO_REFERRAL_THRESHOLD`` reading values.
_READING_VALUES = st.floats(
    min_value=1.0, max_value=40.0, allow_nan=False, allow_infinity=False
)

# The two classifications considered "outside the normal reference range" (Req 13.1).
_OUTSIDE_NORMAL: List[Classification] = ["below", "above"]

# All classifications, used to label non-latest readings (which do not affect the outcome).
_ALL_CLASSIFICATIONS: List[Classification] = ["below", "normal", "above"]

# Approval states other than "approved" — these templates must never yield a card.
_NON_APPROVED = ["draft", "pending", "revoked"]


def _reading(
    day_offset: float,
    value: float,
    classification: Classification,
    reading_id: str,
) -> CortisolReading:
    """A valid cortisol reading ``day_offset`` days before BASE (offset 0 is the latest)."""
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
def _matching_templates(
    draw: st.DrawFn, classification: Classification
) -> List[RecommendationTemplate]:
    """A pool guaranteeing 1..8 *approved matching* templates, plus ignorable noise.

    The pool contains ``m`` approved templates that apply to ``classification`` (so the
    engine can always draw at least one card), interleaved with noise the engine must reject:
    approved-but-non-matching templates and non-approved templates. The exact selected count
    is therefore ``min(m, GUIDANCE_MAX_CARDS)``.
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

    # Noise 1: approved but applies to a different classification -> must be excluded.
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

    # Noise 2: matches the classification but is not approved -> must be excluded.
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
def _ready_scenario(draw: st.DrawFn):
    """A ready scenario: >=7 distinct days, latest reading outside the normal range."""
    n_days = draw(st.integers(min_value=GUIDANCE_MIN_READING_DAYS, max_value=20))
    classification = draw(st.sampled_from(_OUTSIDE_NORMAL))

    readings: List[CortisolReading] = []
    for offset in range(n_days):
        # The latest reading (offset 0) carries the chosen outside-normal classification;
        # earlier readings carry arbitrary classifications (they do not affect the outcome).
        cls = classification if offset == 0 else draw(st.sampled_from(_ALL_CLASSIFICATIONS))
        value = draw(_READING_VALUES)
        readings.append(_reading(offset, value, cls, f"d{offset}"))

    templates = draw(_matching_templates(classification))
    # Count of approved matching templates == number of "match-*" ids in the pool.
    n_matching = sum(1 for t in templates if t.id.startswith("match-"))
    expected = min(n_matching, GUIDANCE_MAX_CARDS)
    return readings, templates, expected


@st.composite
def _gate_scenario(draw: st.DrawFn):
    """A gate scenario: 1..6 distinct days of readings (below the readiness threshold)."""
    n_days = draw(st.integers(min_value=1, max_value=GUIDANCE_MIN_READING_DAYS - 1))
    classification = draw(st.sampled_from(_ALL_CLASSIFICATIONS))
    readings = [
        _reading(offset, draw(_READING_VALUES), classification, f"d{offset}")
        for offset in range(n_days)
    ]
    # Provide a rich, matching, approved template pool to prove the gate — not template
    # scarcity — is what withholds cards.
    templates = [
        RecommendationTemplate(
            id=f"match-{i}",
            approval_status="approved",
            title=f"Match {i}",
            body=f"Body {i}",
            applicable_classifications=("below", "normal", "above"),
        )
        for i in range(3)
    ]
    return readings, templates


# ---------------------------------------------------------------------------
# Property 37: Guidance card count and readiness gate
# Feature: calorie-cortisol-tool, Property 37
# Validates: Requirements 13.1, 13.4
# ---------------------------------------------------------------------------


@settings(max_examples=100)
@given(_ready_scenario())
def test_ready_presents_one_to_five_cards(scenario) -> None:
    """Feature: calorie-cortisol-tool, Property 37.

    For any classification with at least 7 distinct days of readings and a most-recent reading
    outside the normal reference range, the guidance engine is ready and presents between 1 and
    5 approved recommendation cards matching that classification (Req 13.1).

    Validates: Requirements 13.1, 13.4
    """
    readings, templates, expected = scenario
    outcome = generate_guidance(
        GuidanceRequest(
            user_id="u1",
            readings=readings,
            templates=templates,
            referral_threshold_nmol_l=NO_REFERRAL_THRESHOLD,
        )
    )

    assert outcome.ready is True
    assert outcome.more_readings_required is False
    assert outcome.readings_retained is True
    # No referral card can be present because the threshold is unreachable.
    assert outcome.referral_triggered is False
    assert all(not c.is_referral for c in outcome.cards)
    # 1..5 card bound (Req 13.1), matching the count of approved matching templates (clamped).
    assert GUIDANCE_MIN_CARDS <= len(outcome.cards) <= GUIDANCE_MAX_CARDS
    assert len(outcome.cards) == expected


@settings(max_examples=100)
@given(_gate_scenario())
def test_gate_withholds_cards_and_retains_readings(scenario) -> None:
    """Feature: calorie-cortisol-tool, Property 37.

    For any history with fewer than 7 distinct days of readings, the guidance engine withholds
    all cards, flags that more readings are required with an explanatory message, and retains
    the collected readings (Req 13.4).

    Validates: Requirements 13.1, 13.4
    """
    readings, templates = scenario
    outcome = generate_guidance(
        GuidanceRequest(
            user_id="u1",
            readings=readings,
            templates=templates,
            referral_threshold_nmol_l=NO_REFERRAL_THRESHOLD,
        )
    )

    assert outcome.ready is False
    assert outcome.more_readings_required is True
    assert outcome.cards == []
    assert outcome.readings_retained is True
    assert "more readings required" in (outcome.message or "").lower()
