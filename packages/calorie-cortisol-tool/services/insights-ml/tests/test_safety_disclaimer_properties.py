"""Property-based tests for the mandatory-disclaimer gate (Task 11.12).

Exercises the disclaimer-rendering stage of ``app.safety.apply_safety_filter``
(the Insights & ML Service "LLM Insight Layer" guardrail, Task 11.10) against the
design's correctness property:

- **Property 40: Displayed insights always carry a rendered disclaimer**
  (Task 11.12, Validates: Requirements 29.2, 29.5)

Property 40 (design "Property 40"): *for any* displayed health insight, a
wellness disclaimer is rendered within the same view; if the disclaimer cannot
be rendered, the insight is withheld and an unavailable indication is shown.

The two halves this test pins down:

* *Displayed half (Req 29.2)* — every insight the safety filter clears for
  display carries a non-empty, rendered wellness disclaimer, and the underlying
  insight actually had ``disclaimer_rendered`` set. No insight whose disclaimer
  could not be rendered ever appears among the displayed set.
* *Withheld half (Req 29.5)* — any approved, non-diagnostic insight whose
  disclaimer cannot be rendered is withheld with an "insight unavailable"
  indication — never silently dropped, never displayed.

This is the sibling of Property 39 (Task 11.11, approval gate) and Property 41
(Task 11.13, diagnostic-term gate); here the disclaimer gate is the subject.
The implementation already exists (Task 11.10); these tests only observe it.
Each property runs a minimum of 100 generated iterations
(``@settings(max_examples=100)``) and is tagged
``Feature: calorie-cortisol-tool, Property 40``.
"""

from __future__ import annotations

from typing import List

from hypothesis import given, settings
from hypothesis import strategies as st

from cc_contracts.domain import ApprovalStatus, Insight

from app.safety import (
    APPROVED_STATUS,
    INSIGHT_UNAVAILABLE_MESSAGE,
    REASON_DISALLOWED_TERMS,
    REASON_DISCLAIMER_UNAVAILABLE,
    REASON_NOT_APPROVED,
    WELLNESS_DISCLAIMER,
    CandidateInsight,
    apply_safety_filter,
)

# The full approval lifecycle — the approval gate runs before the disclaimer gate.
_ALL_STATUSES: List[ApprovalStatus] = ["approved", "draft", "pending", "revoked"]

# Content free of any disallowed diagnostic/condition/treatment language (Req 29.1),
# so for these candidates the disclaimer gate — not the term gate — decides the outcome.
_BENIGN_CONTENT = st.sampled_from(
    [
        "A short walk after lunch may help you feel more relaxed.",
        "Consider a consistent sleep schedule to support general wellbeing.",
        "Staying hydrated through the day can support how you feel.",
        "Gentle stretching in the morning is a nice way to start the day.",
        "Taking mindful breaks may help you feel more balanced.",
    ]
)

# Content carrying disallowed language (Req 29.1); mixed in to prove the disclaimer
# guarantee still holds amid candidates the earlier term gate rejects.
_DISALLOWED_CONTENT = st.sampled_from(
    [
        "This looks like a diagnosis of a serious disease.",
        "You may need medication to treat this disorder.",
        "This suggests Cushing's syndrome and requires therapy.",
    ]
)


@st.composite
def _candidate(draw: st.DrawFn, index: int) -> CandidateInsight:
    """A candidate insight with arbitrary approval status, disclaimer flag, and content."""
    insight = Insight(
        id=f"i{index}",
        template_id=f"tpl-{index}",
        approval_status=draw(st.sampled_from(_ALL_STATUSES)),
        disclaimer_rendered=draw(st.booleans()),
        rank_score=draw(st.floats(min_value=0.0, max_value=1.0)),
    )
    content = draw(st.one_of(_BENIGN_CONTENT, _DISALLOWED_CONTENT))
    return CandidateInsight(insight=insight, content=content)


@st.composite
def _candidates(draw: st.DrawFn) -> List[CandidateInsight]:
    """A pool of 0..12 candidates spanning every approval/disclaimer/content combination."""
    n = draw(st.integers(min_value=0, max_value=12))
    return [draw(_candidate(i)) for i in range(n)]


# ---------------------------------------------------------------------------
# Property 40: Displayed insights always carry a rendered disclaimer
# Feature: calorie-cortisol-tool, Property 40
# Validates: Requirements 29.2, 29.5
# ---------------------------------------------------------------------------


@settings(max_examples=100)
@given(_candidates())
def test_displayed_insights_always_carry_a_rendered_disclaimer(
    candidates: List[CandidateInsight],
) -> None:
    """Feature: calorie-cortisol-tool, Property 40.

    For any pool of candidate insights, every insight cleared for display carries a
    non-empty rendered wellness disclaimer within the same view, and no insight whose
    disclaimer could not be rendered is ever displayed (Req 29.2).

    Validates: Requirements 29.2, 29.5
    """
    result = apply_safety_filter(candidates)

    for displayed in result.displayed:
        # A non-empty wellness disclaimer is rendered within the same view (Req 29.2).
        assert displayed.disclaimer == WELLNESS_DISCLAIMER
        assert displayed.disclaimer.strip() != ""
        # It is only ever attached to an insight that actually had its disclaimer rendered.
        assert displayed.insight.disclaimer_rendered is True

    # No insight whose disclaimer could not be rendered slips into the displayed set.
    assert all(d.insight.disclaimer_rendered for d in result.displayed)

    # Every candidate is accounted for exactly once (nothing silently vanishes).
    assert len(result.displayed) + len(result.withheld) == len(candidates)

    # Displayed and withheld id sets are disjoint (no candidate is both).
    displayed_ids = {d.insight.id for d in result.displayed}
    withheld_ids = {w.insight.id for w in result.withheld}
    assert displayed_ids.isdisjoint(withheld_ids)

    # Withheld half (Req 29.5): a disclaimer-unavailable withhold always shows the
    # "insight unavailable" indication, and only reaches that gate after passing the
    # approval and disallowed-term gates.
    for w in result.withheld:
        if w.reason == REASON_DISCLAIMER_UNAVAILABLE:
            assert w.indication == INSIGHT_UNAVAILABLE_MESSAGE
            assert w.insight.disclaimer_rendered is False
            assert w.insight.approval_status == APPROVED_STATUS


@settings(max_examples=100)
@given(
    st.lists(
        st.sampled_from(_ALL_STATUSES),
        min_size=1,
        max_size=10,
    )
)
def test_unrenderable_disclaimer_withholds_with_unavailable_indication(
    statuses: List[ApprovalStatus],
) -> None:
    """Feature: calorie-cortisol-tool, Property 40.

    For any approved, non-diagnostic insight whose disclaimer cannot be rendered, the
    insight is withheld from display and an "insight unavailable" indication is shown
    instead — it is never displayed (Req 29.5).

    Validates: Requirements 29.2, 29.5
    """
    # Every candidate is benign and has an unrenderable disclaimer; only approval varies.
    candidates = [
        CandidateInsight(
            insight=Insight(
                id=f"i{i}",
                template_id=f"tpl-{i}",
                approval_status=status,
                disclaimer_rendered=False,
                rank_score=0.5,
            ),
            content="A short walk after lunch may help you feel more relaxed.",
        )
        for i, status in enumerate(statuses)
    ]

    result = apply_safety_filter(candidates)

    # Nothing can be displayed: no disclaimer can be rendered for any candidate.
    assert result.displayed == ()

    # Every approved candidate is withheld specifically for the unrenderable disclaimer,
    # with the "insight unavailable" indication (Req 29.5). Non-approved candidates are
    # withheld earlier at the approval gate.
    by_id = {w.insight.id: w for w in result.withheld}
    for i, status in enumerate(statuses):
        withheld = by_id[f"i{i}"]
        if status == APPROVED_STATUS:
            assert withheld.reason == REASON_DISCLAIMER_UNAVAILABLE
            assert withheld.indication == INSIGHT_UNAVAILABLE_MESSAGE
        else:
            assert withheld.reason == REASON_NOT_APPROVED
