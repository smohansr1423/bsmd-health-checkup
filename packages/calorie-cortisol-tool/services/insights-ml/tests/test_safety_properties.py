"""Property-based tests for the template-constrained LLM safety layer (Task 11.11).

Exercises the approval gate of ``app.safety`` (Task 11.10) against the design's
correctness property:

- **Property 39: Only clinically approved content is ever displayed**
  (Task 11.11, Validates: Requirements 13.3, 13.5, 29.3, 29.4)

Property 39 states that for *any* candidate insight/recommendation content, it is
displayed only if its clinical-advisory-board approval status is exactly
``"approved"``; ``draft``, ``pending``, and ``revoked`` content is always
excluded. When *nothing* eligible remains, a "no guidance available" message is
shown, and the underlying reading data is retained (never mutated) by the pure
filter (Req 13.5 / 29.4).

To keep this property focused on the *approval* gate (Req 13.3/29.3), the two
sibling gates are held off so they can never confound the approval outcome:

* every candidate's ``content`` is drawn from a benign, non-diagnostic pool
  (so the diagnostic-term gate — Property 41 — never fires), and
* every candidate has ``disclaimer_rendered=True`` (so the disclaimer gate —
  Property 40 — never fires).

With both sibling gates neutralized, "displayed" is equivalent to "approved", and
"withheld" (here) is equivalent to "not approved" — exactly Property 39.

The implementation already exists (Task 11.10); these tests only observe it. Each
property runs a minimum of 100 generated iterations (``@settings(max_examples=100)``)
and is tagged ``Feature: calorie-cortisol-tool, Property 39``.
"""

from __future__ import annotations

import copy
from typing import List

from hypothesis import given, settings
from hypothesis import strategies as st

from cc_contracts.domain import ApprovalStatus, CortisolReading, Insight

from app.safety import (
    APPROVED_STATUS,
    NO_GUIDANCE_AVAILABLE_MESSAGE,
    REASON_NOT_APPROVED,
    CandidateInsight,
    apply_safety_filter,
)

# The full approval lifecycle; only ``"approved"`` may ever be displayed (Req 13.3/29.3).
_ALL_STATUSES: List[ApprovalStatus] = ["approved", "draft", "pending", "revoked"]
_NON_APPROVED: List[ApprovalStatus] = ["draft", "pending", "revoked"]

# Benign, non-diagnostic wellness copy — none of these contain a disallowed term, so
# the diagnostic-term gate (Property 41) can never withhold a candidate here.
_BENIGN_CONTENT = st.sampled_from(
    [
        "A short walk after lunch may help you feel more relaxed.",
        "Consider a consistent wind-down routine before bed.",
        "Staying hydrated through the day supports general wellness.",
        "A few minutes of slow breathing can feel calming.",
        "Gentle stretching in the morning may lift your mood.",
        "Taking regular breaks from screens can feel refreshing.",
    ]
)


@st.composite
def _candidate(draw: st.DrawFn, index: int, status: ApprovalStatus) -> CandidateInsight:
    """A single benign, disclaimer-ready candidate with the given approval status.

    Only ``approval_status`` varies across the approval lifecycle; ``content`` is
    always benign and ``disclaimer_rendered`` is always True so the approval gate
    is the sole determinant of the outcome.
    """
    insight = Insight(
        id=f"i{index}",
        template_id=f"tpl-{index}",
        approval_status=status,
        disclaimer_rendered=True,
        rank_score=draw(st.floats(min_value=0.0, max_value=1.0)),
    )
    return CandidateInsight(insight=insight, content=draw(_BENIGN_CONTENT))


@st.composite
def _candidates(draw: st.DrawFn) -> List[CandidateInsight]:
    """A mixed pool of 0..12 candidates spanning arbitrary approval statuses."""
    statuses = draw(
        st.lists(st.sampled_from(_ALL_STATUSES), min_size=0, max_size=12)
    )
    return [draw(_candidate(i, status)) for i, status in enumerate(statuses)]


def _sample_readings() -> List[CortisolReading]:
    """A small fixed batch of reading data used to assert non-mutation (Req 29.4)."""
    return [
        CortisolReading(
            id=f"r{i}",
            user_id="u1",
            measured_at=f"2024-06-0{i + 1}T09:00:00+00:00",
            value_nmol_l=10.0 + i,
            source="patch",
            time_of_day_bucket="morning",
            valid=True,
            contextualized=None,
        )
        for i in range(3)
    ]


# ---------------------------------------------------------------------------
# Property 39: Only clinically approved content is ever displayed
# Feature: calorie-cortisol-tool, Property 39
# Validates: Requirements 13.3, 13.5, 29.3, 29.4
# ---------------------------------------------------------------------------


@settings(max_examples=100)
@given(_candidates())
def test_only_approved_content_is_ever_displayed(candidates) -> None:
    """Feature: calorie-cortisol-tool, Property 39.

    For any pool of candidate insights spanning the approval lifecycle, every
    displayed insight is exactly ``"approved"`` and every non-approved candidate
    (``draft``/``pending``/``revoked``) is withheld with a ``not_approved``
    reason. Displayed insights are precisely the approved subset (Req 13.3/29.3).

    Validates: Requirements 13.3, 13.5, 29.3, 29.4
    """
    result = apply_safety_filter(candidates)

    # Every displayed insight is approved — nothing else can ever surface.
    assert all(d.insight.approval_status == APPROVED_STATUS for d in result.displayed)

    # No draft/pending/revoked insight is ever displayed.
    displayed_ids = {d.insight.id for d in result.displayed}
    for c in candidates:
        if c.insight.approval_status != APPROVED_STATUS:
            assert c.insight.id not in displayed_ids

    # Displayed set is exactly the approved subset (both gates neutralized here).
    approved_ids = [
        c.insight.id
        for c in candidates
        if c.insight.approval_status == APPROVED_STATUS
    ]
    assert [d.insight.id for d in result.displayed] == approved_ids

    # Every non-approved candidate is withheld for the approval reason.
    withheld_not_approved = {
        w.insight.id for w in result.withheld if w.reason == REASON_NOT_APPROVED
    }
    non_approved_ids = {
        c.insight.id
        for c in candidates
        if c.insight.approval_status != APPROVED_STATUS
    }
    assert non_approved_ids == withheld_not_approved


@settings(max_examples=100)
@given(st.lists(st.sampled_from(_NON_APPROVED), min_size=1, max_size=10))
def test_no_guidance_available_when_nothing_approved(statuses) -> None:
    """Feature: calorie-cortisol-tool, Property 39.

    When no candidate is approved, nothing is displayed and the "no guidance
    available" message is surfaced, while the underlying reading data is retained
    unchanged (the pure filter never mutates readings). Req 13.5 / 29.4.

    Validates: Requirements 13.3, 13.5, 29.3, 29.4
    """
    candidates = [
        CandidateInsight(
            insight=Insight(
                id=f"i{i}",
                template_id=f"tpl-{i}",
                approval_status=status,
                disclaimer_rendered=True,
                rank_score=0.5,
            ),
            content="A short walk after lunch may help you feel more relaxed.",
        )
        for i, status in enumerate(statuses)
    ]

    readings = _sample_readings()
    readings_snapshot = copy.deepcopy(readings)

    result = apply_safety_filter(candidates)

    assert result.displayed == ()
    assert result.has_guidance is False
    assert result.message == NO_GUIDANCE_AVAILABLE_MESSAGE
    # Reading data is untouched by the pure safety filter (Req 29.4).
    assert readings == readings_snapshot
