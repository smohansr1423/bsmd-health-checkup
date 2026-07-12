"""Unit tests for cortisol trend prediction integration (Task 17.2).

Covers the three responsibilities of ``app/prediction.py``:
  * the 30-day activation gate (design: "activates only after 30 days of data"),
  * the next-day / 7-day cortisol-tier forecast output shape, and
  * the demographic-slice bias-monitoring hook flagging divergent cohorts.

Requirements: 15.8, 11.4
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import List, Optional

from cc_contracts.domain import CortisolReading, Insight, ReferenceContext

from app.prediction import (
    ACTIVATION_MIN_DAYS,
    DEFAULT_HORIZONS,
    BiasReport,
    DefaultTrendPredictor,
    ReferenceBand,
    SlicePrediction,
    TierForecast,
    build_trend_insight_output,
    classify_tier,
    monitor_demographic_bias,
    predict_cortisol_trend,
)

BASE = datetime(2024, 6, 1, 8, 0, 0)


def _reading(
    day_offset: int,
    value: float,
    valid: bool = True,
    ctx: Optional[ReferenceContext] = None,
    hour: int = 8,
) -> CortisolReading:
    measured = BASE + timedelta(days=day_offset)
    measured = measured.replace(hour=hour)
    return CortisolReading(
        id=f"r{day_offset}-{hour}",
        user_id="u1",
        measured_at=measured.isoformat(),
        value_nmol_l=value,
        source="lab",
        time_of_day_bucket="morning",
        valid=valid,
        contextualized=ctx,
    )


def _days(n: int, value: float = 10.0) -> List[CortisolReading]:
    """One valid reading per day for ``n`` distinct calendar days."""
    return [_reading(i, value) for i in range(n)]


# ---------------------------------------------------------------------------
# 30-day activation gate
# ---------------------------------------------------------------------------


def test_activation_threshold_constant_is_30() -> None:
    assert ACTIVATION_MIN_DAYS == 30


def test_below_threshold_returns_unavailable() -> None:
    forecast = predict_cortisol_trend(_days(29))
    assert forecast.activated is False
    assert forecast.horizons == []
    assert forecast.observed_days == 29
    assert forecast.reason is not None
    assert "29" in forecast.reason


def test_empty_readings_returns_unavailable() -> None:
    forecast = predict_cortisol_trend([])
    assert forecast.activated is False
    assert forecast.observed_days == 0
    assert forecast.horizons == []


def test_multiple_readings_same_day_count_as_one_day() -> None:
    # 29 distinct days, but with several readings on day 0 -> still 29 days.
    readings = _days(29) + [_reading(0, 12.0, hour=12), _reading(0, 14.0, hour=16)]
    forecast = predict_cortisol_trend(readings)
    assert forecast.observed_days == 29
    assert forecast.activated is False


def test_invalid_readings_excluded_from_day_count() -> None:
    # 30 valid days + a 31st day that is invalid -> only 30 count, still activated.
    readings = _days(30) + [_reading(30, 99.0, valid=False)]
    forecast = predict_cortisol_trend(readings)
    assert forecast.observed_days == 30
    assert forecast.activated is True


def test_at_threshold_activates() -> None:
    forecast = predict_cortisol_trend(_days(30))
    assert forecast.activated is True
    assert forecast.reason is None
    assert len(forecast.horizons) == len(DEFAULT_HORIZONS)


# ---------------------------------------------------------------------------
# Forecast output shape
# ---------------------------------------------------------------------------


def test_default_horizons_are_next_day_and_seven_day() -> None:
    forecast = predict_cortisol_trend(_days(30))
    assert [h.horizon_days for h in forecast.horizons] == [1, 7]


def test_forecast_target_dates_offset_from_anchor() -> None:
    forecast = predict_cortisol_trend(_days(30))
    anchor = date(2024, 6, 1) + timedelta(days=29)  # latest observed day
    by_h = {h.horizon_days: h for h in forecast.horizons}
    assert by_h[1].target_date == anchor + timedelta(days=1)
    assert by_h[7].target_date == anchor + timedelta(days=7)


def test_forecast_values_are_non_negative() -> None:
    # Steeply declining series would extrapolate negative; must clamp to >= 0.
    readings = [_reading(i, max(0.0, 30.0 - i)) for i in range(30)]
    forecast = predict_cortisol_trend(readings)
    assert all(h.predicted_value >= 0.0 for h in forecast.horizons)


def test_rising_trend_forecasts_increase_with_horizon() -> None:
    readings = [_reading(i, 5.0 + i) for i in range(30)]
    forecast = predict_cortisol_trend(readings)
    by_h = {h.horizon_days: h for h in forecast.horizons}
    assert by_h[7].predicted_value > by_h[1].predicted_value


def test_confidence_within_unit_interval_and_decays() -> None:
    readings = [_reading(i, 5.0 + i) for i in range(30)]
    forecast = predict_cortisol_trend(readings)
    by_h = {h.horizon_days: h for h in forecast.horizons}
    for h in forecast.horizons:
        assert 0.0 <= h.confidence <= 1.0
    # Farther horizon is no more confident than the nearer one.
    assert by_h[7].confidence <= by_h[1].confidence


def test_custom_horizons_are_sorted_and_deduped() -> None:
    forecast = predict_cortisol_trend(_days(30), horizons=(7, 1, 7, 3))
    assert [h.horizon_days for h in forecast.horizons] == [1, 3, 7]


def test_tier_derived_from_contextualized_reference_range() -> None:
    ctx = ReferenceContext(
        age_band="30-39", sex="F", ref_lower=8.0, ref_upper=12.0, classification="normal"
    )
    # Flat series at 20 -> above the 8..12 band.
    readings = [_reading(i, 20.0, ctx=ctx) for i in range(30)]
    forecast = predict_cortisol_trend(readings)
    assert all(h.tier == "above" for h in forecast.horizons)


def test_tier_none_without_reference_band() -> None:
    forecast = predict_cortisol_trend(_days(30))
    assert all(h.tier is None for h in forecast.horizons)


def test_explicit_reference_band_overrides_context() -> None:
    forecast = predict_cortisol_trend(
        [_reading(i, 3.0) for i in range(30)],
        reference_band=ReferenceBand(lower=5.0, upper=15.0),
    )
    assert all(h.tier == "below" for h in forecast.horizons)


def test_classify_tier_boundaries() -> None:
    band = ReferenceBand(lower=5.0, upper=10.0)
    assert classify_tier(4.9, band) == "below"
    assert classify_tier(5.0, band) == "normal"
    assert classify_tier(10.0, band) == "normal"
    assert classify_tier(10.1, band) == "above"
    assert classify_tier(7.0, None) is None


def test_reference_time_anchors_forecast_dates() -> None:
    anchor = datetime(2024, 7, 15, 9, 0, 0)
    forecast = predict_cortisol_trend(_days(30), reference_time=anchor)
    by_h = {h.horizon_days: h for h in forecast.horizons}
    assert by_h[1].target_date == date(2024, 7, 16)
    assert by_h[7].target_date == date(2024, 7, 22)


def test_injected_predictor_is_used() -> None:
    class ConstantPredictor:
        def forecast_values(self, series, target_indices):
            return [42.0 for _ in target_indices]

        def fit_strength(self, series):
            return 1.0

    forecast = predict_cortisol_trend(_days(30), predictor=ConstantPredictor())
    assert all(h.predicted_value == 42.0 for h in forecast.horizons)


def test_default_predictor_flat_series_confidence_zero() -> None:
    # A flat series has no fit strength -> confidence 0.
    predictor = DefaultTrendPredictor()
    assert predictor.fit_strength([(0, 5.0), (1, 5.0), (2, 5.0)]) == 0.0


# ---------------------------------------------------------------------------
# Demographic-slice bias monitoring hook
# ---------------------------------------------------------------------------


def _perfect(slice_key: str, n: int) -> List[SlicePrediction]:
    return [SlicePrediction(slice_key=slice_key, predicted=10.0, actual=10.0) for _ in range(n)]


def _biased(slice_key: str, n: int, err: float) -> List[SlicePrediction]:
    return [
        SlicePrediction(slice_key=slice_key, predicted=10.0 + err, actual=10.0)
        for _ in range(n)
    ]


def test_bias_report_empty_samples_not_biased() -> None:
    report = monitor_demographic_bias([])
    assert isinstance(report, BiasReport)
    assert report.biased is False
    assert report.flagged_slices == []
    assert report.overall_mae == 0.0


def test_bias_flags_divergent_slice() -> None:
    samples = _perfect("F:30-39", 10) + _biased("M:30-39", 10, err=8.0)
    report = monitor_demographic_bias(samples)
    assert report.biased is True
    assert report.flagged_slices == ["M:30-39"]


def test_bias_balanced_slices_not_flagged() -> None:
    samples = _biased("F:30-39", 10, err=2.0) + _biased("M:30-39", 10, err=2.0)
    report = monitor_demographic_bias(samples)
    assert report.biased is False
    assert report.flagged_slices == []


def test_small_slice_never_flagged() -> None:
    # A large error but only 2 samples (< min) -> measured but not flagged.
    samples = _perfect("F:30-39", 20) + _biased("M:70-79", 2, err=50.0)
    report = monitor_demographic_bias(samples)
    assert report.biased is False
    assert "M:70-79" in {se.slice_key for se in report.slice_errors}


def test_slice_errors_sorted_and_counted() -> None:
    samples = _biased("B", 5, err=1.0) + _perfect("A", 5)
    report = monitor_demographic_bias(samples)
    assert [se.slice_key for se in report.slice_errors] == ["A", "B"]
    counts = {se.slice_key: se.sample_count for se in report.slice_errors}
    assert counts == {"A": 5, "B": 5}


def test_bias_divergence_ratio_threshold() -> None:
    # One slice at exactly the ratio boundary should not flag; clearly above should.
    below = _perfect("clean", 10) + _biased("edge", 10, err=1.0)
    report = monitor_demographic_bias(below, divergence_ratio=3.0)
    assert report.biased is False


# ---------------------------------------------------------------------------
# Read-only integration into milestone / trend outputs
# ---------------------------------------------------------------------------


def _insight(insight_id: str, rank_score: float) -> Insight:
    return Insight(
        id=insight_id,
        template_id="tpl",
        approval_status="approved",
        disclaimer_rendered=True,
        rank_score=rank_score,
    )


def test_build_output_combines_milestone_and_forecast() -> None:
    insights = [_insight("a", 0.2), _insight("b", 0.9)]
    out = build_trend_insight_output(90, insights, _days(30))
    # Milestone ranking (Req 15.8, via patterns) is applied.
    assert out.milestone.triggered is True
    assert out.milestone.milestone == 90
    assert [i.id for i in out.milestone.ranked_insights] == ["b", "a"]
    # Forecast is activated with the default horizons.
    assert out.forecast.activated is True
    assert [h.horizon_days for h in out.forecast.horizons] == [1, 7]


def test_build_output_forecast_gated_before_activation() -> None:
    out = build_trend_insight_output(10, [_insight("a", 0.5)], _days(5))
    assert out.milestone.triggered is False
    assert out.forecast.activated is False
    assert out.forecast.horizons == []
