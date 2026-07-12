"""Cortisol trend prediction model integration (Task 17.2).

Wires the Insights & ML Service's **Cortisol Trend Prediction** capability
(design: "Cortisol Trend Prediction" — *Temporal Fusion Transformer, LSTM-Attention
fallback; activates only after 30 days of data; bias monitoring on demographic
slices*) into the correlation/trend outputs.

A production deployment binds a Temporal Fusion Transformer (with an
LSTM-Attention fallback) served from the ML-Ops stack (Triton / SageMaker MME,
MLflow registry, LaunchDarkly-flagged rollout). That heavy runtime is not
available in this environment, so this module defines a clean, injectable
**port** — :class:`TrendPredictor` — plus a pure, deterministic default
implementation (:class:`DefaultTrendPredictor`, a linear-trend baseline) that
stands in for the model. Swapping in the real TFT/LSTM runtime is a matter of
providing another object satisfying the port; the activation gate, output shape,
and bias-monitoring hook around it are unchanged.

Three responsibilities, all pure and directly unit-testable:

1. **30-day activation gate** — forecasting is withheld until at least
   :data:`ACTIVATION_MIN_DAYS` (30) *distinct calendar days* of valid cortisol
   data exist. Below the threshold a "prediction unavailable" state is returned
   (no horizons), mirroring the design's "activates only after 30 days" rule.

2. **Next-day / 7-day cortisol-tier forecast** — once activated, the predictor
   emits a :class:`TierForecast` per horizon (default 1 and 7 days ahead)
   carrying the predicted value, its reference-range tier (below/normal/above),
   and a confidence in [0, 1].

3. **Demographic-slice bias monitoring hook** — :func:`monitor_demographic_bias`
   evaluates per-cohort prediction error against the overall error and flags any
   slice whose error diverges beyond :data:`BIAS_DIVERGENCE_RATIO`, so fairness
   regressions across demographic slices are surfaced.

Integration with :mod:`app.correlation` and :mod:`app.patterns` is strictly
read-only: this module reuses their numeric helpers and milestone ranking
without mutating either. It never rewrites the existing correlation/patterns
logic.

Requirements: 15.8, 11.4
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import List, Optional, Protocol, Sequence, Tuple

from cc_contracts.domain import Classification, CortisolReading, Insight

# Read-only reuse of Task 11.1's numeric core and window length, and Task 11.4's
# milestone ranking. Imported, never mutated — the prediction model integrates
# with the correlation/patterns modules rather than reimplementing them.
from app.correlation import _parse_ts, pearson_r
from app.patterns import MilestoneRanking, rank_surfaced_insights

# The trend model activates only after this many distinct calendar days of data
# (design: "activates only after 30 days of data").
ACTIVATION_MIN_DAYS: int = 30

# Forecast horizons (days ahead) emitted once the model is activated.
DEFAULT_HORIZONS: Tuple[int, ...] = (1, 7)

# Bias monitoring: a demographic slice is only judged once it has at least this
# many prediction samples, and is flagged when its mean error exceeds the
# overall mean error by more than this multiplicative ratio.
BIAS_MIN_SLICE_SAMPLES: int = 5
BIAS_DIVERGENCE_RATIO: float = 1.25

# "Prediction unavailable" indication surfaced before the activation threshold.
PREDICTION_UNAVAILABLE_MESSAGE = (
    "Trend prediction unavailable: at least {required} days of cortisol data are "
    "required before forecasting activates (currently {have})."
)


# ---------------------------------------------------------------------------
# Output shapes
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ReferenceBand:
    """The reference range a predicted value is classified against (Req 11.4)."""

    lower: float
    upper: float


@dataclass(frozen=True)
class TierForecast:
    """A single-horizon cortisol-tier forecast.

    ``predicted_value`` is the forecast cortisol level (nmol/L, always ``>= 0``);
    ``tier`` classifies it against the reference band (below/normal/above), or is
    ``None`` when no reference band is available; ``confidence`` is in [0, 1].
    """

    horizon_days: int
    target_date: date
    predicted_value: float
    tier: Optional[Classification]
    confidence: float


@dataclass(frozen=True)
class TrendForecast:
    """The result of a cortisol trend-prediction request.

    When ``activated`` is False the model has not yet reached the 30-day data
    threshold: ``horizons`` is empty and ``reason`` carries the "prediction
    unavailable" indication. When activated, ``horizons`` holds one
    :class:`TierForecast` per requested horizon and ``reason`` is ``None``.
    """

    activated: bool
    observed_days: int
    horizons: List[TierForecast] = field(default_factory=list)
    reason: Optional[str] = None


# ---------------------------------------------------------------------------
# Predictor port + default (stub) implementation
# ---------------------------------------------------------------------------


class TrendPredictor(Protocol):
    """Port for a cortisol trend-prediction model.

    Implementations receive a daily-aggregated series as ``(day_index, value)``
    pairs (``day_index`` counted from the first observed day) and a list of
    absolute ``target_indices`` to forecast, and return one predicted value per
    target index. The real Temporal Fusion Transformer / LSTM-Attention runtime
    satisfies this same interface; :class:`DefaultTrendPredictor` is the pure
    in-process default used when that runtime is unavailable.
    """

    def forecast_values(
        self,
        series: Sequence[Tuple[int, float]],
        target_indices: Sequence[int],
    ) -> List[float]:  # pragma: no cover - structural typing contract
        ...

    def fit_strength(self, series: Sequence[Tuple[int, float]]) -> float:  # pragma: no cover
        """Return a [0, 1] confidence proxy for the current series fit."""
        ...


def _least_squares(series: Sequence[Tuple[int, float]]) -> Tuple[float, float]:
    """Ordinary least-squares slope and intercept for ``(x, y)`` points.

    Returns ``(slope, intercept)``; falls back to a flat line at the mean (slope
    0) when the x-values have no variance.
    """
    n = len(series)
    if n == 0:
        return 0.0, 0.0
    xs = [float(x) for x, _ in series]
    ys = [float(y) for _, y in series]
    mean_x = sum(xs) / n
    mean_y = sum(ys) / n
    sxx = sum((x - mean_x) ** 2 for x in xs)
    if sxx <= 0.0:
        return 0.0, mean_y
    sxy = sum((x - mean_x) * (y - my) for x, y, my in zip(xs, ys, [mean_y] * n))
    slope = sxy / sxx
    intercept = mean_y - slope * mean_x
    return slope, intercept


@dataclass(frozen=True)
class DefaultTrendPredictor:
    """Pure, deterministic linear-trend baseline standing in for the TFT/LSTM model.

    Fits an ordinary least-squares line to the daily-aggregated series and
    projects it forward, clamping predictions to be non-negative. Fit strength
    (used as a confidence proxy) is the absolute Pearson correlation of the fit,
    reusing :func:`app.correlation.pearson_r` read-only. This is intentionally
    simple and dependency-free; it is swapped for the real model in production by
    injecting a different :class:`TrendPredictor`.
    """

    def forecast_values(
        self,
        series: Sequence[Tuple[int, float]],
        target_indices: Sequence[int],
    ) -> List[float]:
        slope, intercept = _least_squares(series)
        return [max(0.0, intercept + slope * idx) for idx in target_indices]

    def fit_strength(self, series: Sequence[Tuple[int, float]]) -> float:
        if len(series) < 2:
            return 0.0
        xs = [float(x) for x, _ in series]
        ys = [float(y) for _, y in series]
        return abs(pearson_r(xs, ys))


# ---------------------------------------------------------------------------
# Aggregation + tier classification helpers
# ---------------------------------------------------------------------------


def _daily_series(
    readings: Sequence[CortisolReading],
) -> Tuple[List[Tuple[int, float]], Optional[date]]:
    """Aggregate valid readings into a per-day mean series.

    Returns ``(series, first_day)`` where ``series`` is a list of
    ``(day_index, mean_value)`` ordered by day and ``day_index`` is counted from
    ``first_day`` (index 0). Invalid readings are excluded (Req 9.4). ``first_day``
    is ``None`` when there are no valid readings.
    """
    buckets: dict[date, List[float]] = {}
    for reading in readings:
        if not reading.valid:
            continue
        day = _parse_ts(reading.measured_at).date()
        buckets.setdefault(day, []).append(reading.value_nmol_l)
    if not buckets:
        return [], None
    first_day = min(buckets)
    series = [
        ((day - first_day).days, sum(values) / len(values))
        for day, values in sorted(buckets.items())
    ]
    return series, first_day


def _derive_band(
    readings: Sequence[CortisolReading], override: Optional[ReferenceBand]
) -> Optional[ReferenceBand]:
    """Use the explicit band if given, else average contextualized ref ranges."""
    if override is not None:
        return override
    ctx = [r.contextualized for r in readings if r.valid and r.contextualized is not None]
    if not ctx:
        return None
    lower = sum(c.ref_lower for c in ctx) / len(ctx)
    upper = sum(c.ref_upper for c in ctx) / len(ctx)
    return ReferenceBand(lower=lower, upper=upper)


def classify_tier(value: float, band: Optional[ReferenceBand]) -> Optional[Classification]:
    """Classify a value against a reference band (below/normal/above), or ``None``."""
    if band is None:
        return None
    if value < band.lower:
        return "below"
    if value > band.upper:
        return "above"
    return "normal"


def _horizon_confidence(base: float, horizon_days: int) -> float:
    """Confidence for a horizon: the base fit strength decayed with distance."""
    decayed = base - 0.02 * max(0, horizon_days - 1)
    return round(max(0.0, min(1.0, decayed)), 4)


# ---------------------------------------------------------------------------
# Activation-gated forecast
# ---------------------------------------------------------------------------


def predict_cortisol_trend(
    readings: Sequence[CortisolReading],
    reference_band: Optional[ReferenceBand] = None,
    predictor: Optional[TrendPredictor] = None,
    reference_time: Optional[datetime] = None,
    horizons: Sequence[int] = DEFAULT_HORIZONS,
) -> TrendForecast:
    """Forecast cortisol tiers after the 30-day activation gate is satisfied.

    Counts the number of *distinct calendar days* of valid cortisol data. Below
    :data:`ACTIVATION_MIN_DAYS` the model is inactive: a :class:`TrendForecast`
    with ``activated=False``, no horizons, and a "prediction unavailable"
    ``reason`` is returned (design: "activates only after 30 days of data").

    Once activated, the injected ``predictor`` (defaulting to
    :class:`DefaultTrendPredictor`) forecasts a value for each horizon; each value
    is classified against the reference band (explicit ``reference_band`` or one
    derived from the readings' contextualized ranges) and returned as a
    :class:`TierForecast`.

    Requirements: 15.8, 11.4
    """
    model = predictor if predictor is not None else DefaultTrendPredictor()
    series, first_day = _daily_series(readings)
    observed_days = len(series)

    if observed_days < ACTIVATION_MIN_DAYS or first_day is None:
        return TrendForecast(
            activated=False,
            observed_days=observed_days,
            horizons=[],
            reason=PREDICTION_UNAVAILABLE_MESSAGE.format(
                required=ACTIVATION_MIN_DAYS, have=observed_days
            ),
        )

    # Anchor the forecast at the reference time (default: latest observed day).
    if reference_time is not None:
        anchor_day = reference_time.date()
    else:
        anchor_day = first_day + timedelta(days=series[-1][0])
    anchor_index = (anchor_day - first_day).days

    ordered_horizons = sorted({int(h) for h in horizons if int(h) > 0})
    target_indices = [anchor_index + h for h in ordered_horizons]
    values = model.forecast_values(series, target_indices)

    band = _derive_band(readings, reference_band)
    base_conf = model.fit_strength(series)

    forecasts: List[TierForecast] = []
    for horizon_days, predicted in zip(ordered_horizons, values):
        clamped = max(0.0, predicted)
        forecasts.append(
            TierForecast(
                horizon_days=horizon_days,
                target_date=anchor_day + timedelta(days=horizon_days),
                predicted_value=clamped,
                tier=classify_tier(clamped, band),
                confidence=_horizon_confidence(base_conf, horizon_days),
            )
        )

    return TrendForecast(
        activated=True,
        observed_days=observed_days,
        horizons=forecasts,
        reason=None,
    )


# ---------------------------------------------------------------------------
# Demographic-slice bias monitoring hook
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class SlicePrediction:
    """A single (predicted, actual) observation tagged with a demographic slice.

    ``slice_key`` identifies the demographic cohort (e.g. ``"F:30-39"``); bias
    monitoring groups observations by this key.
    """

    slice_key: str
    predicted: float
    actual: float


@dataclass(frozen=True)
class SliceError:
    """Mean absolute prediction error for one demographic slice."""

    slice_key: str
    sample_count: int
    mae: float


@dataclass(frozen=True)
class BiasReport:
    """The outcome of a demographic-slice bias-monitoring run.

    ``slice_errors`` holds the per-slice mean absolute error (sorted by slice
    key). ``flagged_slices`` lists the slices whose error diverges beyond the
    threshold; ``biased`` is True iff any slice is flagged.
    """

    overall_mae: float
    slice_errors: List[SliceError]
    flagged_slices: List[str]
    biased: bool


def _mae(samples: Sequence[SlicePrediction]) -> float:
    """Mean absolute error over a set of predictions."""
    if not samples:
        return 0.0
    return sum(abs(s.predicted - s.actual) for s in samples) / len(samples)


def monitor_demographic_bias(
    samples: Sequence[SlicePrediction],
    min_slice_samples: int = BIAS_MIN_SLICE_SAMPLES,
    divergence_ratio: float = BIAS_DIVERGENCE_RATIO,
) -> BiasReport:
    """Evaluate per-cohort prediction error and flag divergent demographic slices.

    Groups ``samples`` by ``slice_key``, computes each slice's mean absolute
    error and the overall mean absolute error, and flags any slice that (a) has
    at least ``min_slice_samples`` observations and (b) whose error exceeds the
    overall error by more than ``divergence_ratio`` (e.g. 1.25×). A slice with
    too few samples is measured but never flagged, avoiding noise from tiny
    cohorts. ``biased`` is True iff at least one slice is flagged.

    This is the fairness hook the design calls for ("bias monitoring on
    demographic slices"); it is pure so it can run offline over logged
    predictions or inline over a recent window.

    Requirements: 15.8
    """
    grouped: dict[str, List[SlicePrediction]] = {}
    for sample in samples:
        grouped.setdefault(sample.slice_key, []).append(sample)

    overall_mae = _mae(samples)

    slice_errors: List[SliceError] = []
    flagged: List[str] = []
    for slice_key in sorted(grouped):
        slice_samples = grouped[slice_key]
        slice_mae = _mae(slice_samples)
        slice_errors.append(
            SliceError(
                slice_key=slice_key,
                sample_count=len(slice_samples),
                mae=slice_mae,
            )
        )
        if (
            len(slice_samples) >= min_slice_samples
            and overall_mae > 0.0
            and slice_mae > overall_mae * divergence_ratio
        ):
            flagged.append(slice_key)

    return BiasReport(
        overall_mae=overall_mae,
        slice_errors=slice_errors,
        flagged_slices=flagged,
        biased=len(flagged) > 0,
    )


# ---------------------------------------------------------------------------
# Read-only integration into correlation / trend outputs
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class TrendInsightOutput:
    """Combined milestone ranking + trend forecast surfaced to the Insights layer.

    ``milestone`` is produced by Task 11.4's :func:`rank_surfaced_insights`
    (read-only) and ``forecast`` by :func:`predict_cortisol_trend`, so a single
    call yields both the accumulated-data insight ranking (Req 15.8) and the
    activation-gated cortisol trend forecast.
    """

    milestone: MilestoneRanking
    forecast: TrendForecast


def build_trend_insight_output(
    usage_days: int,
    insights: Sequence[Insight],
    readings: Sequence[CortisolReading],
    reference_band: Optional[ReferenceBand] = None,
    predictor: Optional[TrendPredictor] = None,
    reference_time: Optional[datetime] = None,
    horizons: Sequence[int] = DEFAULT_HORIZONS,
) -> TrendInsightOutput:
    """Wire the trend prediction model into the milestone/trend insight output.

    Ranks the accumulated insights at the current usage milestone via the
    existing patterns module (read-only) and attaches the activation-gated
    cortisol trend forecast. Neither the correlation nor patterns modules are
    modified.

    Requirements: 15.8, 11.4
    """
    milestone = rank_surfaced_insights(usage_days, insights)
    forecast = predict_cortisol_trend(
        readings,
        reference_band=reference_band,
        predictor=predictor,
        reference_time=reference_time,
        horizons=horizons,
    )
    return TrendInsightOutput(milestone=milestone, forecast=forecast)
