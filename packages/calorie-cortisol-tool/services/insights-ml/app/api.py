"""HTTP-facing handlers for the Insights & ML Service (Task 11.1).

This module holds the business-logic entry point for ``POST /correlate``. It is
kept transport-agnostic (a plain function over shared domain types returning the
shared result contract) so a FastAPI route can bind to it when the service's web
app is wired in a later task, and so the logic stays directly unit-testable.

Requirements: 15.1, 15.2, 15.3, 15.4
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import List, Optional, Sequence

from cc_contracts.domain import CortisolReading, Meal

from app.correlation import CorrelationOutcome, FoodEntry, correlate
from app.result import Ok, ok


@dataclass
class CorrelateRequest:
    """Input to ``POST /correlate``.

    ``meals`` and ``readings`` use the shared domain types; ``reference_time``
    optionally pins the end of the rolling 30-day window (defaults to the latest
    observed timestamp).
    """

    user_id: str
    meals: Sequence[Meal]
    readings: Sequence[CortisolReading]
    reference_time: Optional[datetime] = None


def handle_correlate(request: CorrelateRequest) -> Ok[CorrelationOutcome]:
    """Handle ``POST /correlate``: align pairs and gate significance.

    Alignment excluding unpartnered entries (Req 15.1, 15.2) and the pair/|r|/p
    significance gate over the rolling 30-day window (Req 15.3, 15.4) are both
    non-error outcomes, so the handler always returns a success result carrying
    a :class:`CorrelationOutcome` (which itself indicates whether a smart alert
    was generated or more data is required).
    """
    entries: List[FoodEntry] = [FoodEntry.from_meal(m) for m in request.meals]
    outcome = correlate(entries, request.readings, reference_time=request.reference_time)
    return ok(outcome)
