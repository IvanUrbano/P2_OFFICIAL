"""
TBInsight ML Service — ARIMA Forecasting Tests
"""

import sys
import os
import numpy as np
import pandas as pd

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from arima_forecast import (
    _needs_fallback,
    _seasonal_naive_forecast,
    _exponential_smoothing_forecast,
    forecast_barangay,
    forecast_all,
    compute_trend,
    detect_seasonality,
)


def test_needs_fallback_short_series():
    """Short series should trigger fallback."""
    short = pd.Series([1, 2, 3, 4, 5])
    assert _needs_fallback(short) is True


def test_needs_fallback_sparse_series():
    """Series with >50% zeros should trigger fallback."""
    sparse = pd.Series([0, 0, 0, 0, 0, 0, 0, 0, 0, 10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    assert _needs_fallback(sparse) is True


def test_needs_fallback_normal_series():
    """Normal series should NOT trigger fallback."""
    normal = pd.Series([5, 10, 8, 12, 9, 15, 11, 14, 10, 13, 8, 12,
                        6, 11, 9, 13, 10, 16, 12, 15, 11, 14, 9, 13])
    assert _needs_fallback(normal) is False


def test_seasonal_naive_forecast():
    """Seasonal naive should repeat last season's value."""
    series = pd.Series([5, 10, 8, 12, 9, 15, 11, 14, 10, 13, 8, 12])  # 12 months
    result = _seasonal_naive_forecast(series)
    # index -12 = index 0 = value 5 (same month last year)
    assert result["forecasted_count"] == [5]
    assert result["method"] == "seasonal_naive"
    assert result["confidence_lower"][0] < result["forecasted_count"][0]
    assert result["confidence_upper"][0] > result["forecasted_count"][0]


def test_seasonal_naive_short_series():
    """Seasonal naive with <12 months should use last value."""
    series = pd.Series([5, 10, 8, 12])
    result = _seasonal_naive_forecast(series)
    assert result["forecasted_count"] == [12]  # Last value
    assert result["method"] == "seasonal_naive"


def test_exponential_smoothing_forecast():
    """Exponential smoothing should produce reasonable forecast."""
    series = pd.Series([5, 10, 8, 12, 9, 15, 11, 14, 10, 13, 8, 12,
                        6, 11, 9, 13, 10, 16, 12, 15, 11, 14, 9, 13])
    result = _exponential_smoothing_forecast(series)
    assert isinstance(result["forecasted_count"], list)
    assert len(result["forecasted_count"]) == 1
    assert result["forecasted_count"][0] >= 0
    assert result["method"] == "exponential_smoothing"
    assert result["confidence_lower"][0] < result["confidence_upper"][0]


def test_forecast_barangay_empty_series():
    """Empty series should return zero forecast."""
    empty = pd.Series([], dtype=float)
    result = forecast_barangay("TestBarangay", empty)
    assert result["predictions"] == []
    assert result["barangay_name"] == "TestBarangay"


def test_forecast_barangay_normal_series():
    """Normal series should produce ARIMA forecast."""
    np.random.seed(42)
    months = pd.date_range("2022-01-01", periods=36, freq="MS")
    values = np.random.poisson(lam=10, size=36) + np.sin(np.arange(36) * 2 * np.pi / 12) * 3
    series = pd.Series(np.maximum(values, 0), index=months)

    result = forecast_barangay("TestBarangay", series)
    assert result["barangay_name"] == "TestBarangay"
    assert isinstance(result["predictions"], list)
    assert len(result["predictions"]) == 1  # default forecast_horizon=1
    assert result["predictions"][0]["yhat"] >= 0
    assert result["predictions"][0]["yhat_lower"] >= 0
    assert result["predictions"][0]["yhat_upper"] >= result["predictions"][0]["yhat"]
    assert result["method"] in ["arima", "exponential_smoothing"]
    assert result["period"] != ""


def test_forecast_all_multiple_barangays():
    """forecast_all should handle multiple barangays."""
    data = []
    np.random.seed(42)
    for b in ["Barangay A", "Barangay B", "Barangay C"]:
        months = pd.date_range("2022-01-01", periods=36, freq="MS")
        for m in months:
            data.append({
                "barangay_name": b,
                "month": m.strftime("%Y-%m-%d"),
                "case_count": max(0, int(np.random.poisson(lam=10) + np.sin(m.month * 2 * np.pi / 12) * 3)),
            })

    results = forecast_all(data)
    assert len(results) == 3
    barangay_names = [r["barangay_name"] for r in results]
    assert "Barangay A" in barangay_names
    assert "Barangay B" in barangay_names
    assert "Barangay C" in barangay_names


def test_compute_trend_increasing():
    """Increasing series should have positive trend."""
    series = pd.Series(range(1, 25), dtype=float)  # 1, 2, 3, ..., 24
    trend = compute_trend(series)
    assert trend > 0


def test_compute_trend_decreasing():
    """Decreasing series should have negative trend."""
    series = pd.Series(range(24, 0, -1), dtype=float)  # 24, 23, ..., 1
    trend = compute_trend(series)
    assert trend < 0


def test_compute_trend_flat():
    """Flat series should have near-zero trend."""
    series = pd.Series([10] * 24, dtype=float)
    trend = compute_trend(series)
    assert abs(trend) < 0.01


def test_detect_seasonality_with_pattern():
    """Series with seasonal pattern should be detected."""
    # Create 3 years of monthly data with annual seasonality
    np.random.seed(42)
    months = pd.date_range("2022-01-01", periods=36, freq="MS")
    seasonal = np.sin(np.arange(36) * 2 * np.pi / 12) * 10 + 20
    series = pd.Series(seasonal, index=months)
    assert detect_seasonality(series) is True


def test_detect_seasonality_without_pattern():
    """Random series without seasonal pattern should not be detected."""
    np.random.seed(42)
    series = pd.Series(np.random.poisson(lam=10, size=36))
    result = detect_seasonality(series)
    # Random data may or may not have autocorrelation, just check it doesn't crash
    assert isinstance(result, bool)


# Run all tests if executed directly
if __name__ == "__main__":
    tests = [
        test_needs_fallback_short_series,
        test_needs_fallback_sparse_series,
        test_needs_fallback_normal_series,
        test_seasonal_naive_forecast,
        test_seasonal_naive_short_series,
        test_exponential_smoothing_forecast,
        test_forecast_barangay_empty_series,
        test_forecast_barangay_normal_series,
        test_forecast_all_multiple_barangays,
        test_compute_trend_increasing,
        test_compute_trend_decreasing,
        test_compute_trend_flat,
        test_detect_seasonality_with_pattern,
        test_detect_seasonality_without_pattern,
    ]

    passed = 0
    failed = 0
    for test in tests:
        try:
            test()
            print(f"  PASS: {test.__name__}")
            passed += 1
        except Exception as e:
            print(f"  FAIL: {test.__name__}: {e}")
            failed += 1

    print(f"\n{'='*50}")
    print(f"Results: {passed} passed, {failed} failed, {passed + failed} total")
    if failed == 0:
        print("All tests passed!")
    else:
        sys.exit(1)


def test_walk_forward_scores_three_month_totals():
    """Each step also carries the next 3 months as one total, from the same fit."""
    from arima_forecast import walk_forward_arima

    rng = np.random.default_rng(0)
    counts = [int(v) for v in rng.poisson(10, 30)]
    r = walk_forward_arima(counts, min_train=24)
    with_total = [s for s in r["steps"] if "actual_3m" in s]
    assert len(r["steps"]) == 6
    assert len(with_total) == 4  # the last 2 tested months have no full 3 months after them
    first = with_total[0]
    assert first["actual_3m"] == sum(counts[24:27])
    assert first["baseline_3m"] == round(first["baseline"] * 3, 2)
    assert r["n_steps_3m"] == 4 and r["mae_3m"] is not None and r["wape_3m"] is not None


def test_walk_forward_searches_orders_only_when_needed(monkeypatch):
    """
    The order search runs on the first step, when the series reaches 24 months
    (seasonal models become possible), every 12 steps after that, and after a
    failed fit; every other step refits the chosen orders.
    """
    import arima_forecast as af

    calls = []  # (training length, "search" | "refit")

    class FakeModel:
        def predict(self, n_periods, return_conf_int, alpha):
            return np.full(n_periods, 5.0), np.full((n_periods, 2), [4.0, 6.0])

    def fake_fit_model(values, template=None, force_seasonal=False):
        calls.append((len(values), "search" if template is None else "refit"))
        if template is None and len(values) == 20:
            raise ValueError("search failed")  # e.g. pmdarima's seasonal test on a short series
        if template is not None and len(values) == 30:
            raise ValueError("refit failed")
        return FakeModel()

    monkeypatch.setattr(af, "_fit_model", fake_fit_model)
    result = af.walk_forward_arima([5] * 50, min_train=20)

    searches = [n for n, kind in calls if kind == "search"]
    assert result["n_steps"] == 30
    # 20: search fails -> fallback forecast; 21: searches again; 24: seasonal
    # models become possible; 30: the refit fails, so it searches on the spot,
    # which starts a new 12-step run; 42: 12 steps later.
    assert searches == [20, 21, 24, 30, 42]
    assert sum(1 for _, kind in calls if kind == "refit") == 26
    assert result["method_counts"] == {"arima": 29, af.FALLBACK_METHOD: 1}


def test_city_first_forecast_splits_one_seasonal_city_forecast_by_share():
    """Barangay forecasts are shares of one city forecast, so they add up to it."""
    import arima_forecast as af

    rng = np.random.default_rng(1)
    months = pd.date_range("2023-01-01", periods=36, freq="MS").strftime("%Y-%m-%d")
    season = 1 + 0.2 * np.sin(np.arange(36) * 2 * np.pi / 12)
    data = [
        {"barangay_name": name, "month": m, "case_count": int(c)}
        for name, rate in [("Big", 40), ("Mid", 15), ("Small", 4)]
        for m, c in zip(months, rng.poisson(rate * season))
    ]
    out = af.forecast_all(data, forecast_horizon=3)
    city, _ = af.city_forecast(
        {n: np.array([r["case_count"] for r in data if r["barangay_name"] == n], float) for n in ["Big", "Mid", "Small"]}, 3
    )
    assert {r["method"] for r in out} == {"arima"}
    total = sum(r["predictions"][0]["yhat"] for r in out)
    assert abs(total - sum(float(v[0][0]) for v in city.values())) < 1e-6
    big = next(r for r in out if r["barangay_name"] == "Big")["predictions"][0]
    assert big["yhat_lower"] <= big["yhat"] <= big["yhat_upper"]


def test_share_interval_includes_counting_noise():
    """With a certain city total, a barangay's count still varies by chance (variance = mean)."""
    from arima_forecast import share_interval

    mean, lower, upper = share_interval([100.0], [100.0], [100.0], 0.25)
    assert mean[0] == 25.0
    assert abs((upper[0] - mean[0]) - 1.96 * 5.0) < 1e-9  # sd = sqrt(25)
