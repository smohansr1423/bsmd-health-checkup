"""Property-based tests for the safety layer's diagnostic-language gate (Task 11.13).

Exercises the diagnostic/condition/treatment term-exclusion gate of ``app.safety``
(Task 11.10) against the design's correctness property:

- **Property 41: Insight content excludes diagnostic language**
  (Task 11.13, Validates: Requirements 29.1)

Property 41 states that *for any* generated insight in v1.0, the content that is ever
displayed contains no diagnostic claim, medical condition name, or treatment recommendation
from the disallowed-term set. The safety layer is the deterministic gate that enforces this:
candidate content is scanned for disallowed language and any match is withheld, so nothing
carrying such a term can reach ``displayed``.

Sibling properties live elsewhere: the approval gate (Property 39) is covered by
``test_safety_properties.py`` and the disclaimer gate (Property 40) by
``test_safety_disclaimer_properties.py``. This module focuses on the diagnostic-term gate.

The generator deliberately mixes benign wellness phrasing with disallowed terms (single words
and multi-word phrases, in varied casing and with surrounding punctuation) so that a
non-trivial fraction of generated candidates *do* contain diagnostic language. This makes the
"never displayed" guarantee meaningful rather than vacuous: the test proves the gate excludes
the offending content rather than the content simply never containing it. Approval status and
disclaimer-rendered flags are also generated so the term gate is exercised alongside — but
independently of — the other two gates; regardless of those, the invariant is unconditional:
displayed content is always clean.

Each property runs a minimum of 100 generated iterations (``@settings(max_examples=100)``) and
is tagged ``Feature: calorie-cortisol-tool, Property 41``.
"""

from __future__ import annotations

from typing import List

from hypothesis import given, settings
from hypothesis import strategies as st

from cc_contracts.domain import Insight

from app.safety import (
    DISALLOWED_TERMS,
    REASON_DISALLOWED_TERMS,
    CandidateInsight,
    apply_safety_filter,
    can_render_disclaimer,
    contains_disallowed_language,
    find_disallowed_terms,
    is_approved,
)

# Benign wellness vocabulary that must never trip the disallowed-term gate. These are the
# building blocks of legitimate general-wellness copy (Req 29.1).
_BENIGN_WORDS: List[str] = [
    "a",
    "short",
    "walk",
    "after",
    "lunch",
    "may",
    "help",
    "you",
    "feel",
    "more",
    "relaxed",
    "hydrate",
    "sleep",
    "breathe",
    "gently",
    "stretch",
    "sunlight",
    "morning",
    "evening",
    "calm",
    "steady",
    "balance",
    "routine",
    "mindful",
    "rest",
]

# Disallowed vocabulary drawn straight from the module's own default set, so the test tracks
# the implementation's notion of what is diagnostic. Includes multi-word phrases.
_DISALLOWED_WORDS: List[str] = list(DISALLOWED_TERMS)

# Punctuation/casing decorations applied around a chosen token, to ensure word-boundary
# matching still catches decorated occurrences and benign look-alikes stay clean.
_DECORATIONS = ["{}", "{}.", "{},", "({})", "{}!", "{}?", '"{}"', "{};"]

_APPROVAL_STATES = ["approved", "draft", "pending", "revoked"]


@st.composite
def _recased(draw: st.DrawFn, word: str) -> str:
    """Randomly re-case a word (matching is case-insensitive, Req 29.1)."""
    choice = draw(st.sampled_from(["lower", "upper", "title", "as_is"]))
    if choice == "lower":
        return word.lower()
    if choice == "upper":
        return word.upper()
    if choice == "title":
        return word.title()
    return word


@st.composite
def _token(draw: st.DrawFn) -> str:
    """One content token: usually benign, sometimes a (decorated, re-cased) disallowed term."""
    # ~35% of tokens are disallowed terms so a healthy fraction of generated content is dirty.
    if draw(st.integers(min_value=0, max_value=99)) < 35:
        word = draw(st.sampled_from(_DISALLOWED_WORDS))
    else:
        word = draw(st.sampled_from(_BENIGN_WORDS))
    word = draw(_recased(word))
    decoration = draw(st.sampled_from(_DECORATIONS))
    return decoration.format(word)


@st.composite
def _content(draw: st.DrawFn) -> str:
    """A short content string built from 1..12 mixed tokens."""
    tokens = draw(st.lists(_token(), min_size=1, max_size=12))
    return " ".join(tokens)


@st.composite
def _candidate(draw: st.DrawFn) -> CandidateInsight:
    """A candidate insight with generated content, approval status, and disclaimer flag."""
    idx = draw(st.integers(min_value=0, max_value=1_000_000))
    insight = Insight(
        id=f"i{idx}",
        template_id=f"tpl-{idx}",
        approval_status=draw(st.sampled_from(_APPROVAL_STATES)),  # type: ignore[arg-type]
        disclaimer_rendered=draw(st.booleans()),
        rank_score=draw(
            st.floats(min_value=0.0, max_value=1.0, allow_nan=False, allow_infinity=False)
        ),
    )
    return CandidateInsight(insight=insight, content=draw(_content()))


# ---------------------------------------------------------------------------
# Property 41: Insight content excludes diagnostic language
# Feature: calorie-cortisol-tool, Property 41
# Validates: Requirements 29.1
# ---------------------------------------------------------------------------


@settings(max_examples=100)
@given(st.lists(_candidate(), min_size=0, max_size=10))
def test_displayed_content_excludes_diagnostic_language(candidates) -> None:
    """Feature: calorie-cortisol-tool, Property 41.

    For any set of candidate insights, no insight that the safety layer clears for display
    contains a diagnostic claim, medical condition name, or treatment recommendation from the
    disallowed-term set. Any approved, disclaimer-renderable candidate whose content *does*
    contain such language is instead withheld with the disallowed-terms reason (Req 29.1).

    Validates: Requirements 29.1
    """
    result = apply_safety_filter(candidates)

    # Core invariant: every displayed insight's content is free of disallowed language.
    for displayed in result.displayed:
        assert find_disallowed_terms(displayed.content) == ()
        assert not contains_disallowed_language(displayed.content)

    # Complementary guarantee: a candidate that would otherwise pass (approved + disclaimer)
    # but carries disallowed language is excluded specifically by the diagnostic-language gate.
    withheld_for_terms = {
        w.insight.id for w in result.withheld if w.reason == REASON_DISALLOWED_TERMS
    }
    displayed_ids = {d.insight.id for d in result.displayed}
    for candidate in candidates:
        insight = candidate.insight
        if (
            is_approved(insight)
            and can_render_disclaimer(insight)
            and contains_disallowed_language(candidate.content)
        ):
            assert insight.id not in displayed_ids
            assert insight.id in withheld_for_terms
