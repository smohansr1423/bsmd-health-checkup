"""Actionable cortisol guidance engine (Task 11.7).

Implements the ``POST /guidance`` core of the Insights & ML Service's
Guidance_Engine (design: "Insights & ML Service", ``POST /guidance`` — classification
→ clinically approved recommendation cards). This module is deliberately kept separate
from ``app/correlation.py`` (Task 11.1) and ``app/patterns.py`` (Task 11.4): it neither
imports nor mutates their state.

Scope of this task (Req 13.1, 13.2, 13.4):

1. **Readiness gate (Req 13.4)** — when fewer than ``GUIDANCE_MIN_READING_DAYS`` (7)
   *distinct calendar days* of cortisol readings are available, recommendation cards are
   withheld and a "more readings required" message is surfaced. The collected readings are
   always retained (``readings_retained`` stays True); nothing is discarded.

2. **Recommendation cards (Req 13.1)** — once the readiness gate is met and the most recent
   reading is classified *outside* the normal reference range (``below``/``above``), between
   ``GUIDANCE_MIN_CARDS`` (1) and ``GUIDANCE_MAX_CARDS`` (5) recommendation cards are drawn
   from clinically approved templates that match the classification.

3. **Referral precedence (Req 13.2)** — when cortisol stays above the referral threshold for
   at least ``REFERRAL_CONSECUTIVE_WEEKS`` (3) consecutive weeks, a professional-referral card
   is placed *above all other* recommendation cards.

**Coordination seam.** Approval-status filtering, mandatory wellness-disclaimer injection, and
disallowed diagnostic/condition/treatment-term exclusion (Req 13.3, 13.5, 29.x) are owned by
Task 11.10. This module does not duplicate that logic; instead it selects from an
already-approved template pool via an injectable :data:`TemplateFilter` *port*. The default
port (:func:`select_approved`) applies only the minimal ``approval_status == "approved"``
guard so the engine is safe standalone, and Task 11.10 injects its richer filter without any
change here. The authoritative "no guidance available" messaging of Req 13.5 also belongs to
Task 11.10, so this module leaves the message empty when the gate is met but no card is
produced.

Requirements: 13.1, 13.2, 13.4
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Callable, List, Optional, Sequence, Tuple

from cc_contracts.constants import GUIDANCE_MAX_CARDS
from cc_contracts.domain import Classification, CortisolReading

# Minimum number of distinct calendar days of readings before guidance is generated (Req 13.4).
GUIDANCE_MIN_READING_DAYS: int = 7

# Number of consecutive elevated weeks that triggers a professional referral (Req 13.2).
REFERRAL_CONSECUTIVE_WEEKS: int = 3

# Length of a single week bucket, in days, used for the referral analysis.
DAYS_PER_WEEK: int = 7

# Classifications considered "outside the normal reference range" (Req 13.1).
OUTSIDE_NORMAL: Tuple[Classification, ...] = ("below", "above")

# Surfaced when the readiness gate is not met (Req 13.4). Retains readings.
MORE_READINGS_REQUIRED_MESSAGE = (
    "More readings required: at least {required} days of cortisol readings are needed "
    "before guidance can be generated (currently {have}). Your readings have been kept."
)


# ---------------------------------------------------------------------------
# Data models
# ---------------------------------------------------------------------------


@dataclass
class RecommendationTemplate:
    """A clinically curated recommendation template eligible for card generation.

    ``approval_status`` mirrors the shared :class:`cc_contracts.domain.ApprovalStatus`
    lifecycle; only ``"approved"`` templates are eligible (the default port enforces this,
    Task 11.10 enforces the full policy). ``applicable_classifications`` restricts a template
    to the cortisol classifications it addresses (Req 13.1/13.5 "matches the user's cortisol
    classification"). ``priority`` orders templates when more than
    ``GUIDANCE_MAX_CARDS`` match (higher first); ties break on ``id`` for determinism.
    """

    id: str
    approval_status: str
    title: str
    body: str
    applicable_classifications: Tuple[Classification, ...] = ("below", "normal", "above")
    priority: float = 0.0


@dataclass
class RecommendationCard:
    """A single recommendation card presented to the user.

    ``is_referral`` marks the professional-referral card, which is ordered above all other
    cards when present (Req 13.2).
    """

    template_id: str
    title: str
    body: str
    is_referral: bool = False


@dataclass
class GuidanceRequest:
    """Input to ``POST /guidance``.

    ``readings`` are the user's normalized cortisol readings; ``templates`` is the candidate
    pool (filtered through ``filter_port`` before selection). ``referral_threshold_nmol_l`` is
    the clinical referral threshold in nmol/L. ``reference_time`` optionally pins "now" (the
    end of the referral week windows and the anchor for "most recent" — defaults to the latest
    reading). ``referral_template`` optionally supplies approved referral-card content; when
    omitted a built-in non-diagnostic default is used.
    """

    user_id: str
    readings: Sequence[CortisolReading]
    templates: Sequence[RecommendationTemplate] = field(default_factory=list)
    referral_threshold_nmol_l: float = 0.0
    reference_time: Optional[datetime] = None
    referral_template: Optional[RecommendationTemplate] = None


@dataclass
class GuidanceOutcome:
    """The result of a ``POST /guidance`` evaluation.

    ``cards`` is the ordered list to present (referral card first when triggered). ``ready``
    is False only when the readiness gate withholds guidance, in which case
    ``more_readings_required`` is True and ``message`` explains it. ``readings_retained`` is
    always True — the engine never discards readings (Req 13.4). ``referral_triggered``
    reflects the ≥3-consecutive-week referral condition (Req 13.2).
    """

    cards: List[RecommendationCard]
    ready: bool
    more_readings_required: bool
    referral_triggered: bool
    readings_retained: bool = True
    message: Optional[str] = None


# The approval/eligibility seam owned by Task 11.10. A port takes the candidate templates and
# returns the subset eligible for card generation.
TemplateFilter = Callable[[Sequence[RecommendationTemplate]], List[RecommendationTemplate]]


def select_approved(
    templates: Sequence[RecommendationTemplate],
) -> List[RecommendationTemplate]:
    """Default template port: keep only ``approval_status == "approved"`` templates.

    This is the minimal safety guard so the guidance engine is correct standalone. Task 11.10
    injects a richer port (disclaimer injection, diagnostic-term exclusion, Req 29.x) in place
    of this default without any change to :func:`generate_guidance`.
    """
    return [t for t in templates if t.approval_status == "approved"]


# Built-in, non-diagnostic professional-referral card used when the request supplies no
# approved referral template. Framed as a general-wellness prompt (design principle 2).
DEFAULT_REFERRAL_CARD = RecommendationCard(
    template_id="referral.default",
    title="Consider connecting with a licensed professional",
    body=(
        "Your recent cortisol readings have stayed elevated for several weeks in a row. "
        "Consider discussing these trends with a licensed healthcare professional. This is a "
        "general-wellness prompt, not a medical diagnosis."
    ),
    is_referral=True,
)


# ---------------------------------------------------------------------------
# Timestamp helpers
# ---------------------------------------------------------------------------


def _parse_ts(value: str) -> datetime:
    """Parse an ISO-8601 timestamp, tolerating a trailing ``Z``."""
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _valid(readings: Sequence[CortisolReading]) -> List[CortisolReading]:
    """Only readings flagged ``valid`` feed guidance (invalid excluded, Req 9.4)."""
    return [r for r in readings if r.valid]


# ---------------------------------------------------------------------------
# Readiness gate (Req 13.4)
# ---------------------------------------------------------------------------


def distinct_reading_days(readings: Sequence[CortisolReading]) -> int:
    """Number of distinct calendar days covered by valid readings.

    The readiness gate counts *days*, not readings, so several readings on one day still count
    as a single day toward the ``GUIDANCE_MIN_READING_DAYS`` threshold (Req 13.4).
    """
    days: set[date] = {_parse_ts(r.measured_at).date() for r in _valid(readings)}
    return len(days)


# ---------------------------------------------------------------------------
# Classification of the most recent reading (Req 13.1)
# ---------------------------------------------------------------------------


def most_recent_classification(
    readings: Sequence[CortisolReading],
    reference_time: Optional[datetime] = None,
) -> Optional[Classification]:
    """Classification of the most recent valid reading at/before ``reference_time``.

    Returns the ``classification`` carried by the reading's reference context, or ``None`` when
    there is no eligible reading or it lacks a contextual classification.
    """
    eligible = [
        (r, _parse_ts(r.measured_at))
        for r in _valid(readings)
        if reference_time is None or _parse_ts(r.measured_at) <= reference_time
    ]
    if not eligible:
        return None
    latest, _ = max(eligible, key=lambda pair: pair[1])
    if latest.contextualized is None:
        return None
    return latest.contextualized.classification


# ---------------------------------------------------------------------------
# Referral analysis (Req 13.2)
# ---------------------------------------------------------------------------


def consecutive_elevated_weeks(
    readings: Sequence[CortisolReading],
    threshold: float,
    reference_time: Optional[datetime] = None,
) -> int:
    """Longest run of consecutive weeks that stay above ``threshold``.

    Valid readings at/before the anchor (``reference_time`` or the latest reading) are bucketed
    into consecutive 7-day windows counting back from the anchor: week 0 is ``(anchor-7d,
    anchor]``, week 1 is ``(anchor-14d, anchor-7d]``, and so on. A week is *elevated* iff it
    contains at least one reading and **every** reading in it is strictly above ``threshold``
    (cortisol "stays above" — it never dips below). A week with no readings breaks a run,
    because staying-above cannot be confirmed without data.

    Returns the length of the longest consecutive elevated run; the caller triggers a referral
    when this reaches :data:`REFERRAL_CONSECUTIVE_WEEKS`.

    Requirements: 13.2
    """
    parsed = [(_parse_ts(r.measured_at), r.value_nmol_l) for r in _valid(readings)]
    if not parsed:
        return 0

    anchor = reference_time if reference_time is not None else max(ts for ts, _ in parsed)
    week_seconds = DAYS_PER_WEEK * 24 * 60 * 60

    weeks: dict[int, List[float]] = {}
    for ts, value in parsed:
        if ts > anchor:
            continue
        idx = int((anchor - ts).total_seconds() // week_seconds)
        weeks.setdefault(idx, []).append(value)

    if not weeks:
        return 0

    best = run = 0
    for idx in range(0, max(weeks) + 1):
        values = weeks.get(idx)
        if values and all(v > threshold for v in values):
            run += 1
            best = max(best, run)
        else:
            run = 0
    return best


def _referral_card(template: Optional[RecommendationTemplate]) -> RecommendationCard:
    """Build the professional-referral card from ``template`` or the built-in default."""
    if template is None:
        return DEFAULT_REFERRAL_CARD
    return RecommendationCard(
        template_id=template.id,
        title=template.title,
        body=template.body,
        is_referral=True,
    )


# ---------------------------------------------------------------------------
# Card selection (Req 13.1)
# ---------------------------------------------------------------------------


def select_recommendation_cards(
    templates: Sequence[RecommendationTemplate],
    classification: Classification,
    filter_port: TemplateFilter = select_approved,
    max_cards: int = GUIDANCE_MAX_CARDS,
) -> List[RecommendationCard]:
    """Select up to ``max_cards`` approved cards matching ``classification``.

    Templates are first passed through ``filter_port`` (the approval/eligibility seam), then
    narrowed to those whose ``applicable_classifications`` include ``classification``, ordered
    by descending ``priority`` with an ``id`` tie-break, and finally clamped to ``max_cards``
    (Req 13.1's 1–5 bound; the lower bound of ``GUIDANCE_MIN_CARDS`` is naturally satisfied
    whenever at least one template matches).

    Requirements: 13.1
    """
    approved = filter_port(templates)
    matching = [t for t in approved if classification in t.applicable_classifications]
    matching.sort(key=lambda t: (-t.priority, t.id))
    selected = matching[:max_cards]
    return [
        RecommendationCard(template_id=t.id, title=t.title, body=t.body)
        for t in selected
    ]


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def generate_guidance(
    request: GuidanceRequest,
    filter_port: TemplateFilter = select_approved,
) -> GuidanceOutcome:
    """Produce guidance for a user: readiness gate, cards, and referral precedence.

    Flow:

    1. **Readiness gate (Req 13.4)** — if fewer than ``GUIDANCE_MIN_READING_DAYS`` distinct
       days of readings exist, withhold all cards, surface the "more readings required"
       message, and retain the readings.
    2. **Recommendation cards (Req 13.1)** — when the most recent reading is classified outside
       the normal range, draw 1–5 approved cards matching that classification.
    3. **Referral precedence (Req 13.2)** — when cortisol stays above the referral threshold for
       ≥3 consecutive weeks, prepend a professional-referral card above all other cards.

    The authoritative "no guidance available" message (Req 13.5) is intentionally left to Task
    11.10, so a ready evaluation that yields no card returns an empty ``message`` here.

    Requirements: 13.1, 13.2, 13.4
    """
    days = distinct_reading_days(request.readings)
    if days < GUIDANCE_MIN_READING_DAYS:
        return GuidanceOutcome(
            cards=[],
            ready=False,
            more_readings_required=True,
            referral_triggered=False,
            readings_retained=True,
            message=MORE_READINGS_REQUIRED_MESSAGE.format(
                required=GUIDANCE_MIN_READING_DAYS, have=days
            ),
        )

    classification = most_recent_classification(request.readings, request.reference_time)
    cards: List[RecommendationCard] = []
    if classification in OUTSIDE_NORMAL:
        cards = select_recommendation_cards(
            request.templates, classification, filter_port=filter_port
        )

    run = consecutive_elevated_weeks(
        request.readings, request.referral_threshold_nmol_l, request.reference_time
    )
    referral_triggered = run >= REFERRAL_CONSECUTIVE_WEEKS
    if referral_triggered:
        cards = [_referral_card(request.referral_template)] + cards

    return GuidanceOutcome(
        cards=cards,
        ready=True,
        more_readings_required=False,
        referral_triggered=referral_triggered,
        readings_retained=True,
        message=None,
    )


def handle_guidance(
    request: GuidanceRequest,
    filter_port: TemplateFilter = select_approved,
) -> GuidanceOutcome:
    """Transport-agnostic handler for ``POST /guidance``.

    Thin wrapper over :func:`generate_guidance` mirroring the ``handle_correlate`` seam in
    ``app/api.py`` so a FastAPI route can bind directly to it when the web app is wired.

    Requirements: 13.1, 13.2, 13.4
    """
    return generate_guidance(request, filter_port=filter_port)
