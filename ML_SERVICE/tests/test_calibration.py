"""
TBInsight ML Service — ARIMA/RF calibration regression tests

Covers: shared forecast calendar, non-seasonal ARIMA for short series, stray
leading months, adaptive backtest, endpoint gating of the RF on small samples.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import numpy as np
import pandas as pd

from arima_forecast import (
    _needs_fallback,
    _trim_leading_months,
    backtest_mae,
    forecast_all,
    walk_forward_arima,
)
from fastapi.testclient import TestClient
from main import app

client = TestClient(app, headers={"X-API-Key": os.environ["ML_API_KEY"]})


def _series(counts_by_barangay: dict, start="2025-01-01"):
    rows = []
    for name, counts in counts_by_barangay.items():
        for m, c in zip(pd.date_range(start, periods=len(counts), freq="MS"), counts):
            rows.append({"barangay_name": name, "month": m.strftime("%Y-%m-%d"), "case_count": int(c)})
    return rows


def _noisy(n, level=20, seed=0):
    return np.random.default_rng(seed).poisson(level, n).tolist()


def test_ten_to_23_months_use_nonseasonal_arima():
    assert not _needs_fallback(pd.Series(_noisy(12), dtype=float))
    assert _needs_fallback(pd.Series(_noisy(9), dtype=float))


def test_twelve_month_series_is_forecast_with_nonseasonal_arima():
    # 12 months (10-23 range) fits a real non-seasonal ARIMA model, but is
    # tagged "arima_nonseasonal" (never plain "arima") — this tier always
    # surfaces as "Baseline Forecast" downstream, since seasonality can't be
    # learned from under two annual cycles.
    out = forecast_all(_series({"A": _noisy(12)}), forecast_horizon=1)
    assert out[0]["method"] == "arima_nonseasonal"
    p = out[0]["predictions"][0]
    assert p["month"] == "2026-01-01"
    assert 0 <= p["yhat_lower"] <= p["yhat"] <= p["yhat_upper"]


def test_all_barangays_forecast_the_same_month():
    """A barangay whose data ends early must still forecast the shared next month."""
    data = _series({"Big": _noisy(12), "Stopped": [4, 5, 6]})
    by_name = {f["barangay_name"]: f for f in forecast_all(data, forecast_horizon=1)}
    assert by_name["Big"]["predictions"][0]["month"] == "2026-01-01"
    assert by_name["Stopped"]["predictions"][0]["month"] == "2026-01-01"


def test_missing_months_are_zero_filled():
    data = [
        {"barangay_name": "A", "month": "2025-01-01", "case_count": 10},
        {"barangay_name": "A", "month": "2025-12-01", "case_count": 10},
    ]
    out = forecast_all(data, forecast_horizon=1)
    assert out[0]["predictions"][0]["month"] == "2026-01-01"
    # 10 of 12 months are zero -> too sparse for ARIMA
    assert out[0]["method"] == "exponential_smoothing"


def test_stray_leading_months_are_trimmed():
    wide = pd.DataFrame(
        {"A": [1] + [0] * 13 + [30] * 12},
        index=pd.date_range("2022-11-01", periods=26, freq="MS"),
    )
    trimmed = _trim_leading_months(wide)
    assert trimmed.index[0] == pd.Timestamp("2024-01-01")
    assert len(trimmed) == 12


def test_stray_old_record_does_not_make_series_sparse():
    data = _series({"A": _noisy(12), "B": _noisy(12, 8, 1)}, start="2025-01-01")
    data.append({"barangay_name": "A", "month": "2022-11-01", "case_count": 1})
    out = {f["barangay_name"]: f for f in forecast_all(data, forecast_horizon=1)}
    assert out["A"]["method"] == "arima_nonseasonal"


def test_backtest_mae_shrinks_holdout_for_short_series():
    assert backtest_mae(_noisy(12)) is not None
    assert backtest_mae(_noisy(9)) is None


def test_walk_forward_runs_on_short_series():
    r = walk_forward_arima(_noisy(14), min_train=10)
    assert r["n_steps"] == 4
    assert r["mae"] is not None


def _rows(n, inc):
    return [
        {"features": {"rolling_12m_incidence": inc, "recent_trend": 0, "seasonality_flag": 0,
                      "lag_1m": 1, "lag_2m": 1, "lag_3m": 1, "neighbor_risk": 0.5,
                      "historical_bias": 0}, "incidence": inc}
        for _ in range(n)
    ]


def test_classify_uses_rule_when_training_set_is_small():
    r = client.post("/api/ml/classify", json={
        "thresholds": {"low_max": 150.0, "med_max": 350.0},
        "train": _rows(10, 500),
        "predict": [{"barangay_name": "Hot", "features": {"rolling_12m_incidence": 500, "recent_trend": 0,
                     "seasonality_flag": 0, "lag_1m": 1, "lag_2m": 1, "lag_3m": 1,
                     "neighbor_risk": 0.5, "historical_bias": 0}}],
    })
    body = r.json()
    assert r.status_code == 200
    assert body["method"] == "rule_based"
    # Regression: the rule fallback used to read incidence 0 and call everything Low
    assert body["predictions"][0]["risk_class"] == "High"


def test_classify_trains_rf_with_enough_rows():
    train = _rows(40, 50) + _rows(40, 250) + _rows(40, 600)
    r = client.post("/api/ml/classify", json={
        "thresholds": {"low_max": 150.0, "med_max": 350.0},
        "train": train,
        "predict": [{"barangay_name": "Hot", "features": {"rolling_12m_incidence": 600, "recent_trend": 0,
                     "seasonality_flag": 0, "lag_1m": 1, "lag_2m": 1, "lag_3m": 1,
                     "neighbor_risk": 0.5, "historical_bias": 0}}],
    })
    body = r.json()
    assert body["method"] == "random_forest"
    assert body["n_train"] == 120
    assert body["predictions"][0]["risk_class"] == "High"
