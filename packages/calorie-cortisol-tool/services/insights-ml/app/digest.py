"""Automated weekly digest generation (Task 11.14).

Third slice of the Insights & ML Service's Correlation_Engine (design: "Insights &
ML Service" — ``GET /digest`` weekly digest generation, Sunday 08:00 local). This
module is deliberately kept separate from ``app/correlation.py`` (Task 11.1) and
``app/patterns.py`` (Task 11.4): it *consumes* their outputs read-only (a
:class:`~app.correlation.CorrelationOutcome`, surfaced
:class:`~app.patterns.RecurringPattern` values, and approved
:class:`cc_contracts.domain.Insight` records) but never mutates them.

Two pure, deterministic responsibilities plus a loosely-coupled delivery event:

1. **Scheduling (Req 15.6)** — compute the Sunday 08:00 *local-time* delivery slot
   relative to an injected "now". ``next_weekly_digest_time`` returns the next
   Sunday 08:00 strictly after ``now``; ``is_digest_due`` reports whether ``now`` is
   itself a Sunday-08:00 slot; ``digest_slot_for`` returns the slot a digest
   generated at ``now`` belongs to. All three preserve ``now``'s timezone, so
   "local time" is whatever offset the caller supplies — no wall-clock reads here.

2. **Digest assembly (Req 15.6)** — assemble a plain-value :class:`WeeklyDigest`
   over the rolling 7-day window ending at generation, from data the caller injects.
   Only *approved*, disclaimer-rendered insights are included (Req 13.3/29.x), and
   all text is general-wellness framing, never diagnostic.

3. **Delivery event modelling** — the emitted :class:`DigestDeliveryEvent` models the
   payload handed to the Notification Service (design: Notification Service consumes
   SQS events). It is a plain data/payload contract; this module does *not* import or
   call the Notification Service, keeping the two decoupled.

The ``GET /digest`` entry point (:func:`handle_digest`) is a transport-agnostic
function over plain values returning the shared :class:`~app.result.Ok` contract, so
a FastAPI route can bind to it later and the logic stays directly unit-testable.

Requirements: 15.6
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Dict, List, Optional, Sequence

from cc_contracts.domain import Insight

# Read-only reuse of the sibling engine slices. Imported, never mutated.
from app.correlation import CorrelationOutcome
from app.patterns import RecurringPattern
from app.result import Ok, ok

# Sunday 08:00 local delivery slot (Req 15.6). ``datetime.weekday()`` is Mon=0..Sun=6.
SUNDAY_WEEKDAY: int = 6
DIGEST_HOUR: int = 8
DIGEST_MINUTE: int = 0

# The digest reports on the rolling 7-day window ending at generation.
DIGEST_PERIOD_DAYS: int = 7

# Event type for the payload emitted to the Notification Service. A stable,
# namespaced string is the entire coupling surface — the consumer keys off this.
DIGEST_DELIVERY_EVENT_TYPE: str = "insights.weekly_digest.ready"


# ---------------------------------------------------------------------------
# Scheduling (Req 15.6) — pure functions over an injected "now"
# ---------------------------------------------------------------------------


def _at_digest_time(moment: datetime) -> datetime:
    """Return ``moment``'s date at the 08:00 delivery time, preserving tz."""
    return moment.replace(
        hour=DIGEST_HOUR, minute=DIGEST_MINUTE, second=0, microsecond=0
    )


def is_digest_due(now: datetime) -> bool:
    """Whether ``now`` lands exactly on a Sunday 08:00 (to the minute) delivery slot.

    Timezone-agnostic: the check is against ``now``'s own local calendar/clock, so a
    caller in any offset gets its own Sunday-08:00 slot (Req 15.6).
    """
    return (
        now.weekday() == SUNDAY_WEEKDAY
        and now.hour == DIGEST_HOUR
        and now.minute == DIGEST_MINUTE
    )


def next_weekly_digest_time(now: datetime) -> datetime:
    """The next Sunday 08:00 delivery slot strictly after ``now`` (same tz).

    Deterministic and pure: derives the slot purely from ``now``. When ``now`` is
    before this week's Sunday 08:00, that slot is returned; otherwise (including when
    ``now`` is exactly a slot) the following week's slot is returned so a scheduler
    never re-emits the slot it is currently firing.

    Requirements: 15.6
    """
    days_ahead = (SUNDAY_WEEKDAY - now.weekday()) % 7
    candidate = _at_digest_time(now) + timedelta(days=days_ahead)
    if candidate <= now:
        candidate += timedelta(days=DIGEST_PERIOD_DAYS)
    return candidate


def digest_slot_for(now: datetime) -> datetime:
    """The Sunday 08:00 slot a digest generated at ``now`` belongs to (same tz).

    If ``now`` is itself a slot (Sunday 08:00), that slot is returned; otherwise the
    upcoming slot is returned. This is the ``scheduled_for`` stamped on the emitted
    delivery event.

    Requirements: 15.6
    """
    if is_digest_due(now):
        return _at_digest_time(now)
    return next_weekly_digest_time(now)


# ---------------------------------------------------------------------------
# Digest assembly (Req 15.6) — pure over injected data
# ---------------------------------------------------------------------------


@dataclass
class WeeklyDigest:
    """An assembled weekly digest for one user over a rolling 7-day window.

    ``digest_id`` is deterministic (``digest-{user_id}-{week_end}``) so re-generating
    the same week yields a stable identifier. ``insight_ids`` lists only the
    approved, disclaimer-rendered insights included; ``recurring_pattern_messages``
    and ``correlation_summary`` carry the surfacing text produced by the sibling
    engine slices. ``headline`` is a plain-language, non-clinical summary line.
    """

    digest_id: str
    user_id: str
    week_start: date
    week_end: date
    generated_at: str
    meals_logged: int
    readings_logged: int
    significant_relationship: bool
    correlation_summary: Optional[str]
    recurring_pattern_messages: List[str] = field(default_factory=list)
    insight_ids: List[str] = field(default_factory=list)
    headline: str = ""


def _digest_id(user_id: str, week_end: date) -> str:
    """Deterministic identifier for a user's digest for the week ending ``week_end``."""
    return f"digest-{user_id}-{week_end.isoformat()}"


def _approved_insight_ids(insights: Sequence[Insight]) -> List[str]:
    """Ids of insights safe to surface: approved AND disclaimer rendered (Req 13/29).

    Ordered by ``id`` for a deterministic digest body.
    """
    eligible = [
        i.id
        for i in insights
        if i.approval_status == "approved" and i.disclaimer_rendered
    ]
    return sorted(eligible)


def _headline(
    meals_logged: int,
    readings_logged: int,
    significant: bool,
    recurring_count: int,
) -> str:
    """Compose a plain-language, non-clinical digest headline."""
    parts = [
        f"This week you logged {meals_logged} meal(s) and {readings_logged} "
        f"cortisol reading(s)."
    ]
    if significant:
        parts.append("A significant food–cortisol pattern was noted.")
    if recurring_count:
        parts.append(
            f"{recurring_count} recurring pattern(s) continued to show up."
        )
    parts.append("These are general-wellness observations, not a medical diagnosis.")
    return " ".join(parts)


def assemble_weekly_digest(
    user_id: str,
    generated_at: datetime,
    insights: Sequence[Insight] = (),
    recurring_patterns: Sequence[RecurringPattern] = (),
    correlation: Optional[CorrelationOutcome] = None,
    meals_logged: int = 0,
    readings_logged: int = 0,
) -> WeeklyDigest:
    """Assemble a weekly digest over the 7-day window ending at ``generated_at``.

    Pure and deterministic: given identical inputs the output (including
    ``digest_id`` and the ordered ``insight_ids`` body) is identical. Only approved,
    disclaimer-rendered insights are surfaced; the correlation summary and recurring
    patterns are taken read-only from the sibling engine slices.

    Requirements: 15.6
    """
    week_end = generated_at.date()
    week_start = week_end - timedelta(days=DIGEST_PERIOD_DAYS - 1)

    significant = bool(correlation and correlation.result.significant)
    correlation_summary: Optional[str] = None
    if correlation is not None:
        # Prefer the smart alert when significant, else the "more data / none" note.
        correlation_summary = correlation.alert or correlation.message

    pattern_messages = [p.message for p in recurring_patterns]
    insight_ids = _approved_insight_ids(insights)

    return WeeklyDigest(
        digest_id=_digest_id(user_id, week_end),
        user_id=user_id,
        week_start=week_start,
        week_end=week_end,
        generated_at=generated_at.isoformat(),
        meals_logged=meals_logged,
        readings_logged=readings_logged,
        significant_relationship=significant,
        correlation_summary=correlation_summary,
        recurring_pattern_messages=pattern_messages,
        insight_ids=insight_ids,
        headline=_headline(
            meals_logged, readings_logged, significant, len(pattern_messages)
        ),
    )


# ---------------------------------------------------------------------------
# Delivery event modelling (loose coupling to the Notification Service)
# ---------------------------------------------------------------------------


@dataclass
class DigestDeliveryEvent:
    """The delivery event emitted to the Notification Service for a ready digest.

    Models only the payload contract (design: Notification Service consumes SQS
    events). ``scheduled_for`` is the Sunday 08:00 local slot the digest belongs to,
    ``generated_at`` is when it was assembled, and ``summary`` is the digest headline.
    The Notification Service keys off ``event_type``; this module never calls it.
    """

    event_type: str
    user_id: str
    digest_id: str
    scheduled_for: str  # ISO-8601 Sunday 08:00 in the user's local offset
    generated_at: str
    summary: str

    def to_payload(self) -> Dict[str, str]:
        """Serialize to the flat string payload placed on the delivery queue."""
        return {
            "event_type": self.event_type,
            "user_id": self.user_id,
            "digest_id": self.digest_id,
            "scheduled_for": self.scheduled_for,
            "generated_at": self.generated_at,
            "summary": self.summary,
        }


def build_delivery_event(digest: WeeklyDigest, scheduled_for: datetime) -> DigestDeliveryEvent:
    """Model the Notification Service delivery event for an assembled digest."""
    return DigestDeliveryEvent(
        event_type=DIGEST_DELIVERY_EVENT_TYPE,
        user_id=digest.user_id,
        digest_id=digest.digest_id,
        scheduled_for=scheduled_for.isoformat(),
        generated_at=digest.generated_at,
        summary=digest.headline,
    )


# ---------------------------------------------------------------------------
# GET /digest entry point
# ---------------------------------------------------------------------------


@dataclass
class DigestRequest:
    """Input to ``GET /digest``.

    ``now`` is the injected local time (tz-aware or naive; its offset defines "local"
    for the Sunday-08:00 slot, Req 15.6). The remaining fields are the read-only data
    the digest is assembled from.
    """

    user_id: str
    now: datetime
    insights: Sequence[Insight] = ()
    recurring_patterns: Sequence[RecurringPattern] = ()
    correlation: Optional[CorrelationOutcome] = None
    meals_logged: int = 0
    readings_logged: int = 0


@dataclass
class DigestGenerationOutcome:
    """Result of ``GET /digest``: the assembled digest, the emitted delivery event,
    and the next Sunday-08:00 slot the recurring schedule will fire at.
    """

    digest: WeeklyDigest
    event: DigestDeliveryEvent
    scheduled_for: str
    next_scheduled_for: str


def handle_digest(request: DigestRequest) -> Ok[DigestGenerationOutcome]:
    """Handle ``GET /digest``: assemble the weekly digest and emit its delivery event.

    Digest generation is a non-error outcome, so the handler always returns a success
    result. The digest is assembled from the injected data (Req 15.6), a delivery
    event is modelled for the Notification Service, and both the current delivery slot
    and the next Sunday-08:00 slot are reported.

    Requirements: 15.6
    """
    slot = digest_slot_for(request.now)
    digest = assemble_weekly_digest(
        user_id=request.user_id,
        generated_at=request.now,
        insights=request.insights,
        recurring_patterns=request.recurring_patterns,
        correlation=request.correlation,
        meals_logged=request.meals_logged,
        readings_logged=request.readings_logged,
    )
    event = build_delivery_event(digest, scheduled_for=slot)
    return ok(
        DigestGenerationOutcome(
            digest=digest,
            event=event,
            scheduled_for=slot.isoformat(),
            next_scheduled_for=next_weekly_digest_time(request.now).isoformat(),
        )
    )
