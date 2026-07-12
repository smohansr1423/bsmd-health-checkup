"""Unit tests for the template-constrained LLM safety layer (Task 11.10).

Covers approval filtering (Req 13.3, 29.3, 29.4), the "no guidance available"
fallback (Req 13.5), mandatory disclaimer rendering (Req 29.2, 29.5), and
disallowed diagnostic/condition/treatment term exclusion (Req 29.1). Property
tests 11.11/11.12/11.13 are implemented separately.
"""

from __future__ import annotations

from cc_contracts.domain import Insight

from app.safety import (
    APPROVED_STATUS,
    DISALLOWED_TERMS,
    INSIGHT_UNAVAILABLE_MESSAGE,
    NO_GUIDANCE_AVAILABLE_MESSAGE,
    REASON_DISALLOWED_TERMS,
    REASON_DISCLAIMER_UNAVAILABLE,
    REASON_NOT_APPROVED,
    WELLNESS_DISCLAIMER,
    CandidateInsight,
    apply_safety_filter,
    can_render_disclaimer,
    contains_disallowed_language,
    find_disallowed_terms,
    is_approved,
)

BENIGN = "A short walk after lunch may help you feel more relaxed."


def _insight(
    id_: str = "i1",
    approval_status: str = "approved",
    disclaimer_rendered: bool = True,
    rank_score: float = 0.5,
) -> Insight:
    return Insight(
        id=id_,
        template_id="tpl-" + id_,
        approval_status=approval_status,  # type: ignore[arg-type]
        disclaimer_rendered=disclaimer_rendered,
        rank_score=rank_score,
    )


def _candidate(content: str = BENIGN, **kwargs) -> CandidateInsight:
    return CandidateInsight(insight=_insight(**kwargs), content=content)


# ---------------------------------------------------------------------------
# Gate 1: approval filtering (Req 13.3, 29.3, 29.4)
# ---------------------------------------------------------------------------


def test_is_approved_only_for_approved_status():
    assert is_approved(_insight(approval_status="approved"))
    for status in ("draft", "pending", "revoked"):
        assert not is_approved(_insight(approval_status=status))


def test_approved_content_is_displayed():
    result = apply_safety_filter([_candidate(id_="ok")])
    assert result.has_guidance
    assert len(result.displayed) == 1
    assert result.displayed[0].insight.id == "ok"
    assert result.message is None


def test_unapproved_statuses_are_all_excluded():
    candidates = [
        _candidate(id_="d", approval_status="draft"),
        _candidate(id_="p", approval_status="pending"),
        _candidate(id_="r", approval_status="revoked"),
    ]
    result = apply_safety_filter(candidates)
    assert result.displayed == ()
    assert {w.reason for w in result.withheld} == {REASON_NOT_APPROVED}
    # No approved template matched -> "no guidance available" (Req 13.5).
    assert result.message == NO_GUIDANCE_AVAILABLE_MESSAGE


def test_no_guidance_message_only_when_nothing_displayable():
    mixed = [
        _candidate(id_="approved"),
        _candidate(id_="draft", approval_status="draft"),
    ]
    result = apply_safety_filter(mixed)
    assert result.has_guidance
    assert result.message is None
    assert len(result.withheld) == 1


# ---------------------------------------------------------------------------
# Gate 2: diagnostic / condition / treatment term exclusion (Req 29.1)
# ---------------------------------------------------------------------------


def test_find_disallowed_terms_is_case_insensitive_and_deduped():
    found = find_disallowed_terms("You may have a DISORDER; a disorder indeed.")
    assert found == ("disorder",)


def test_find_disallowed_terms_matches_multiword_phrase():
    assert "adrenal fatigue" in find_disallowed_terms(
        "This looks like adrenal fatigue to me."
    )


def test_word_boundary_prevents_false_positives():
    # "cure" must not match inside "manicure"; "dose" not inside "doselike".
    assert not contains_disallowed_language("A relaxing manicure can be pleasant.")
    assert find_disallowed_terms("manicure secure obscure") == ()


def test_diagnostic_content_is_withheld_even_when_approved():
    candidate = _candidate(
        content="This may indicate a thyroid disorder you should treat.",
        id_="diag",
    )
    result = apply_safety_filter([candidate])
    assert result.displayed == ()
    assert len(result.withheld) == 1
    w = result.withheld[0]
    assert w.reason == REASON_DISALLOWED_TERMS
    assert w.indication == INSIGHT_UNAVAILABLE_MESSAGE
    assert "disorder" in w.matched_terms and "treat" in w.matched_terms
    assert result.message == NO_GUIDANCE_AVAILABLE_MESSAGE


def test_custom_disallowed_terms_override():
    candidate = _candidate(content="Try more sunlight.", id_="c")
    result = apply_safety_filter([candidate], disallowed_terms=("sunlight",))
    assert result.displayed == ()
    assert result.withheld[0].reason == REASON_DISALLOWED_TERMS


# ---------------------------------------------------------------------------
# Gate 3: mandatory disclaimer rendering (Req 29.2, 29.5)
# ---------------------------------------------------------------------------


def test_displayed_insight_carries_rendered_disclaimer():
    result = apply_safety_filter([_candidate()])
    assert result.displayed[0].disclaimer == WELLNESS_DISCLAIMER


def test_custom_disclaimer_is_used():
    result = apply_safety_filter([_candidate()], disclaimer="Wellness only.")
    assert result.displayed[0].disclaimer == "Wellness only."


def test_insight_withheld_when_disclaimer_cannot_render():
    candidate = _candidate(id_="nd", disclaimer_rendered=False)
    result = apply_safety_filter([candidate])
    assert result.displayed == ()
    assert result.withheld[0].reason == REASON_DISCLAIMER_UNAVAILABLE
    assert result.withheld[0].indication == INSIGHT_UNAVAILABLE_MESSAGE
    assert result.message == NO_GUIDANCE_AVAILABLE_MESSAGE


def test_can_render_disclaimer_reflects_flag():
    assert can_render_disclaimer(_insight(disclaimer_rendered=True))
    assert not can_render_disclaimer(_insight(disclaimer_rendered=False))


# ---------------------------------------------------------------------------
# Gate ordering & determinism
# ---------------------------------------------------------------------------


def test_approval_gate_takes_precedence_over_term_gate():
    # Unapproved AND diagnostic -> reported as not_approved (first gate).
    candidate = _candidate(
        content="A disease diagnosis.", id_="x", approval_status="draft"
    )
    result = apply_safety_filter([candidate])
    assert result.withheld[0].reason == REASON_NOT_APPROVED


def test_term_gate_takes_precedence_over_disclaimer_gate():
    # Approved, diagnostic, and no disclaimer -> reported as disallowed_terms.
    candidate = _candidate(
        content="Signs of a syndrome.", id_="y", disclaimer_rendered=False
    )
    result = apply_safety_filter([candidate])
    assert result.withheld[0].reason == REASON_DISALLOWED_TERMS


def test_displayed_preserves_input_order_and_is_deterministic():
    candidates = [
        _candidate(id_="a", rank_score=0.1),
        _candidate(id_="skip", approval_status="pending"),
        _candidate(id_="b", rank_score=0.9),
        _candidate(id_="c", rank_score=0.5),
    ]
    result = apply_safety_filter(candidates)
    assert [d.insight.id for d in result.displayed] == ["a", "b", "c"]
    # Deterministic across repeated calls.
    again = apply_safety_filter(candidates)
    assert [d.insight.id for d in again.displayed] == ["a", "b", "c"]


def test_empty_input_yields_no_guidance():
    result = apply_safety_filter([])
    assert result.displayed == ()
    assert result.withheld == ()
    assert result.message == NO_GUIDANCE_AVAILABLE_MESSAGE


def test_default_disallowed_set_is_nonempty_and_lowercase():
    assert len(DISALLOWED_TERMS) > 0
    assert all(t == t.lower() for t in DISALLOWED_TERMS)
    assert APPROVED_STATUS == "approved"
