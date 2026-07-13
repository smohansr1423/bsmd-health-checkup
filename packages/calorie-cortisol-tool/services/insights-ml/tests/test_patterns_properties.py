"""Property-based tests for milestone insight ranking (Task 11.6).

This optional property test exercises the milestone insight-ranking core logic in
``app.patterns`` against the design's correctness property:

- **Property 36: Insight ranking is sorted by descending correlation strength**
  (Task 11.6, Validates: Requirements 15.8)

The property runs a minimum of 100 generated iterations
(``@settings(max_examples=100)``) and is tagged in the format
``Feature: calorie-cortisol-tool, Property {number}``.

The implementation already exists (Task 11.4); this test only observes it.
"""

from __future__ import annotations

from typing import List

from hypothesis import given, settings
from hypothesis import strategies as st

from cc_contracts.domain import Insight

from app.patterns import (
    MILESTONE_DAYS,
    rank_insights,
    rank_surfaced_insights,
)

# ---------------------------------------------------------------------------
# Shared generators
# ---------------------------------------------------------------------------


def _insight_strategy() -> st.SearchStrategy[Insight]:
    """A single surfaced insight with an arbitrary id and correlation strength.

    ``rank_score`` spans the full well-formed strength range [0, 1]; ids are drawn
    from a small alphabet so ties (equal scores across different ids) are exercised
    frequently, stressing the deterministic tie-break.
    """
    return st.builds(
        Insight,
        id=st.text(alphabet="abcde", min_size=1, max_size=4),
        template_id=st.just("tpl"),
        approval_status=st.just("approved"),
        disclaimer_rendered=st.just(True),
        rank_score=st.floats(
            min_value=0.0, max_value=1.0, allow_nan=False, allow_infinity=False
        ),
    )


def _insights_strategy() -> st.SearchStrategy[List[Insight]]:
    """A list of surfaced insights whose ids are unique within the list.

    Uniqueness on id keeps the tie-break total (no two insights compare equal on
    both keys) so the expected ordering is well-defined for the assertions.
    """
    return st.lists(_insight_strategy(), min_size=0, max_size=12).map(
        lambda items: list({i.id: i for i in items}.values())
    )


def _is_sorted_by_descending_strength(insights: List[Insight]) -> bool:
    """Whether ``insights`` is ordered by non-increasing rank_score, ties broken by id."""
    for a, b in zip(insights, insights[1:]):
        if a.rank_score < b.rank_score:
            return False
        if a.rank_score == b.rank_score and a.id > b.id:
            return False
    return True


# ---------------------------------------------------------------------------
# Property 36: Insight ranking is sorted by descending correlation strength
# Feature: calorie-cortisol-tool, Property 36
#
# Validates: Requirements 15.8
# ---------------------------------------------------------------------------


@settings(max_examples=100)
@given(insights=_insights_strategy())
def test_rank_insights_is_sorted_by_descending_strength(
    insights: List[Insight],
) -> None:
    """Feature: calorie-cortisol-tool, Property 36.

    For any collection of surfaced insights, ``rank_insights`` returns a permutation
    ordered by non-increasing correlation strength (``rank_score``), with a
    deterministic ascending-``id`` tie-break, and never mutates its input.

    Validates: Requirements 15.8
    """
    original = list(insights)
    ranked = rank_insights(insights)

    # Ordering: non-increasing strength with ascending-id tie-break.
    assert _is_sorted_by_descending_strength(ranked)

    # Permutation: same multiset of insights, nothing added or dropped.
    assert sorted(id(x) for x in ranked) == sorted(id(x) for x in original)
    assert len(ranked) == len(original)

    # Purity: the input list is left untouched.
    assert insights == original


@settings(max_examples=100)
@given(
    usage_days=st.integers(min_value=min(MILESTONE_DAYS), max_value=400),
    insights=_insights_strategy(),
)
def test_rank_surfaced_insights_ranks_at_milestone(
    usage_days: int,
    insights: List[Insight],
) -> None:
    """Feature: calorie-cortisol-tool, Property 36.

    When a usage milestone has been reached, ``rank_surfaced_insights`` marks the
    outcome as triggered and returns the accumulated insights sorted by descending
    correlation strength.

    Validates: Requirements 15.8
    """
    outcome = rank_surfaced_insights(usage_days, insights)

    assert outcome.triggered
    assert outcome.milestone is not None
    assert _is_sorted_by_descending_strength(outcome.ranked_insights)
    assert len(outcome.ranked_insights) == len(insights)
