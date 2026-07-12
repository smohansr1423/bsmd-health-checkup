"""Recurring-pattern surfacing and milestone insight ranking (Task 11.4).

Second half of the Insights & ML Service's Correlation_Engine / Personalization_Model
(design: "Insights & ML Service"). This module is deliberately kept separate from
``app/correlation.py`` (Task 11.1, which owns alignment + significance gating): it
consumes the *significance* concept produced there but never mutates it. Where a
correlation result is needed it is imported read-only.

Two pure, deterministic responsibilities:

1. **Recurring-pattern surfacing (Req 15.5)** — given per-day significant-relationship
   detections, surface a relationship as *recurring* iff a same-direction significant
   relationship is detected on at least ``RECURRING_MIN_DISTINCT_DAYS`` (3) *separate
   calendar days* within a rolling ``ROLLING_WINDOW_DAYS`` (30) day window. Direction is
   the sign of the correlation coefficient, so a positive-direction streak and a
   negative-direction streak are counted independently.

2. **Milestone insight ranking (Req 15.8)** — when the user reaches a 30/90/180-day usage
   milestone, rank the surfaced insights by descending correlation strength (the
   ``rank_score`` carried by :class:`cc_contracts.domain.Insight`). Ordering is
   non-increasing in strength, with a deterministic tie-break on insight id.

Both entry points are pure functions over plain values so they stay directly
unit-testable and a FastAPI route can bind to them when the web app is wired.

Requirements: 15.5, 15.8
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import List, Literal, Optional, Sequence

from cc_contracts.domain import Insight

# Read-only reuse of Task 11.1's rolling-window length so both halves of the
# Correlation_Engine agree on the 30-day window. Imported, never mutated.
from app.correlation import ROLLING_WINDOW_DAYS

# A same-direction significant relationship must be detected on at least this many
# separate calendar days within the rolling window to be surfaced (Req 15.5).
RECURRING_MIN_DISTINCT_DAYS: int = 3

# Usage milestones (in days) that trigger insight re-ranking (Req 15.8).
MILESTONE_DAYS: tuple[int, ...] = (30, 90, 180)

Direction = Literal["positive", "negative"]


# ---------------------------------------------------------------------------
# Recurring-pattern surfacing (Req 15.5)
# ---------------------------------------------------------------------------


def _coerce_day(value: "date | datetime | str") -> date:
    """Normalize a calendar-day input to a :class:`datetime.date`.

    Accepts a ``date``, a ``datetime`` (its date component is used), or an ISO-8601
    string (date or datetime, tolerating a trailing ``Z``).
    """
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    return parsed.date()


def _direction(coefficient: float) -> Optional[Direction]:
    """Sign of a correlation coefficient as a direction, or ``None`` at exactly zero."""
    if coefficient > 0:
        return "positive"
    if coefficient < 0:
        return "negative"
    return None


@dataclass
class DailyDetection:
    """A single day's significant-relationship detection for one relationship.

    ``day`` is the calendar day the relationship was detected on. ``significant``
    mirrors the significance verdict produced by Task 11.1's correlation engine, and
    ``coefficient`` supplies the direction (its sign). ``relationship_key`` identifies
    which food/cortisol relationship this detection is about, so distinct
    relationships are surfaced independently.
    """

    day: date
    significant: bool
    coefficient: float
    relationship_key: str = "calories~cortisol"

    def __post_init__(self) -> None:
        # Tolerate datetime/ISO-string inputs for ergonomics while keeping ``day`` a date.
        object.__setattr__(self, "day", _coerce_day(self.day))


@dataclass
class RecurringPattern:
    """A recurring same-direction significant relationship surfaced to the user.

    ``distinct_days`` is the number of separate calendar days (within the window) the
    relationship was significantly detected in the given direction; it is always
    ``>= RECURRING_MIN_DISTINCT_DAYS``.
    """

    relationship_key: str
    direction: Direction
    distinct_days: int
    message: str


def _window_end_day(
    detections: Sequence[DailyDetection], reference_day: Optional[date]
) -> Optional[date]:
    """End of the rolling window: ``reference_day`` or the latest detection day."""
    if reference_day is not None:
        return reference_day
    days = [d.day for d in detections]
    return max(days) if days else None


def _recurring_message(relationship_key: str, direction: Direction, days: int) -> str:
    """Plain-language, non-clinical surfacing text for a recurring pattern."""
    trend = "higher-together" if direction == "positive" else "opposite-direction"
    return (
        f"Recurring pattern: a {trend} relationship for '{relationship_key}' showed up "
        f"significantly on {days} separate days in the last {ROLLING_WINDOW_DAYS} days. "
        f"This is a general-wellness observation, not a medical diagnosis."
    )


def detect_recurring_patterns(
    detections: Sequence[DailyDetection],
    reference_day: "date | datetime | str | None" = None,
    window_days: int = ROLLING_WINDOW_DAYS,
    min_distinct_days: int = RECURRING_MIN_DISTINCT_DAYS,
) -> List[RecurringPattern]:
    """Surface same-direction significant relationships recurring across ≥3 days.

    Considers only detections that are ``significant`` and whose ``day`` falls inside the
    rolling ``window_days`` window ending at ``reference_day`` (defaulting to the latest
    detection day). Detections are grouped by ``(relationship_key, direction)`` where
    direction is the sign of the coefficient; a group is surfaced iff it spans at least
    ``min_distinct_days`` *separate calendar days*. Multiple detections on the same day
    count once.

    Output is deterministic: sorted by ``relationship_key`` then ``direction``.

    Requirements: 15.5
    """
    end = _window_end_day(detections, _coerce_day(reference_day) if reference_day else None)
    if end is None:
        return []
    start = end - timedelta(days=window_days)

    # (relationship_key, direction) -> set of distinct calendar days.
    grouped: dict[tuple[str, Direction], set[date]] = {}
    for det in detections:
        if not det.significant:
            continue
        if not (start <= det.day <= end):
            continue
        direction = _direction(det.coefficient)
        if direction is None:
            # A truly significant relationship has |r| >= 0.5, so a zero coefficient
            # carries no direction and cannot form a same-direction recurring pattern.
            continue
        grouped.setdefault((det.relationship_key, direction), set()).add(det.day)

    patterns: List[RecurringPattern] = []
    for (relationship_key, direction), days in grouped.items():
        if len(days) >= min_distinct_days:
            patterns.append(
                RecurringPattern(
                    relationship_key=relationship_key,
                    direction=direction,
                    distinct_days=len(days),
                    message=_recurring_message(relationship_key, direction, len(days)),
                )
            )

    patterns.sort(key=lambda p: (p.relationship_key, p.direction))
    return patterns


# ---------------------------------------------------------------------------
# Milestone insight ranking (Req 15.8)
# ---------------------------------------------------------------------------


def rank_score_from_coefficient(coefficient: float) -> float:
    """Map a correlation coefficient to its *strength* (absolute value).

    "Descending correlation strength" (Req 15.8) orders by magnitude, so the sign is
    dropped. The result is clamped to [0, 1] to stay a well-formed strength.
    """
    return max(0.0, min(1.0, abs(coefficient)))


def is_milestone_day(usage_days: int) -> bool:
    """Whether ``usage_days`` lands exactly on a 30/90/180-day milestone."""
    return usage_days in MILESTONE_DAYS


def latest_milestone_reached(usage_days: int) -> Optional[int]:
    """The highest milestone the user has reached, or ``None`` before the first.

    Uses ``>=`` so any usage at or past a milestone counts as having reached it (e.g.
    100 days → 90). Returns ``None`` below 30 days.
    """
    reached = [m for m in MILESTONE_DAYS if usage_days >= m]
    return max(reached) if reached else None


def rank_insights(insights: Sequence[Insight]) -> List[Insight]:
    """Order insights by descending correlation strength (non-increasing ``rank_score``).

    The ordering is total and deterministic: primary key is ``-rank_score`` (highest
    strength first) with a stable tie-break on ``id`` ascending. The input is not
    mutated.

    Requirements: 15.8
    """
    return sorted(insights, key=lambda i: (-i.rank_score, i.id))


@dataclass
class MilestoneRanking:
    """The outcome of a milestone insight-ranking request.

    ``milestone`` is the highest milestone reached (or ``None``), and ``triggered``
    indicates whether ranking was performed because a milestone was reached. When
    triggered, ``ranked_insights`` is sorted by descending correlation strength;
    otherwise the surfaced insights are returned in their original order.
    """

    milestone: Optional[int]
    triggered: bool
    ranked_insights: List[Insight]


def rank_surfaced_insights(
    usage_days: int, insights: Sequence[Insight]
) -> MilestoneRanking:
    """Rank surfaced insights when a usage milestone is reached (Req 15.8).

    When the user has reached a 30/90/180-day milestone, the accumulated insights are
    ranked by descending correlation strength. Before the first milestone, the insights
    are passed through unranked (in their original order) and ``triggered`` is False.

    Requirements: 15.8
    """
    milestone = latest_milestone_reached(usage_days)
    if milestone is None:
        return MilestoneRanking(
            milestone=None, triggered=False, ranked_insights=list(insights)
        )
    return MilestoneRanking(
        milestone=milestone, triggered=True, ranked_insights=rank_insights(insights)
    )
