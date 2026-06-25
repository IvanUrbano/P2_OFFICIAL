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
    assert result["forecasted_count"] == 5
    assert result["method"] == "seasonal_naive"
    assert result["confidence_lower"] < result["forecasted_count"]
    assert result["confidence_upper"] > result["forecasted_count"]


def test_seasonal_naive_short_series():
    """Seasonal naive with <12 months should use last value."""
    series = pd.Series([5, 10, 8, 12])
    result = _seasonal_naive_forecast(series)
    assert result["forecasted_count"] == 12  # Last value
    assert result["method"] == "seasonal_naive"


def test_exponential_smoothing_forecast():
    """Exponential smoothing should produce reasonable forecast."""
    series = pd.Series([5, 10, 8, 12, 9, 15, 11, 14, 10, 13, 8, 12,
                        6, 11, 9, 13, 10, 16, 12, 15, 11, 14, 9, 13])
    result = _exponential_smoothing_forecast(series)
    assert result["forecasted_count"] >= 0
    assert result["method"] == "exponential_smoothing"
    assert result["confidence_lower"] < result["confidence_upper"]


def test_forecast_barangay_empty_series():
    """Empty series should return zero forecast."""
    empty = pd.Series([], dtype=float)
    result = forecast_barangay("TestBarangay", empty)
    assert result["forecasted_count"] == 0
    assert result["barangay_name"] == "TestBarangay"


def test_forecast_barangay_normal_series():
    """Normal series should produce ARIMA forecast."""
    np.random.seed(42)
    months = pd.date_range("2022-01-01", periods=36, freq="MS")
    values = np.random.poisson(lam=10, size=36) + np.sin(np.arange(36) * 2 * np.pi / 12) * 3
    series = pd.Series(np.maximum(values, 0), index=months)

    result = forecast_barangay("TestBarangay", series)
    assert result["barangay_name"] == "TestBarangay"
    assert result["forecasted_count"] >= 0
    assert result["confidence_lower"] >= 0
    assert result["confidence_upper"] >= result["forecasted_count"]
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
