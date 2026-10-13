"""
TBInsight ML Service — FastAPI Endpoint Integration Tests
Tests all endpoints against Plan 02 spec contracts.
"""

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.testclient import TestClient
from main import app

client = TestClient(app, headers={"X-API-Key": os.environ["ML_API_KEY"]})


# ==================== Health ====================

def test_health():
    r = client.get("/api/ml/health")
    assert r.status_code == 200
    data = r.json()
    assert data["status"] == "ok"
    assert "arima" in data["models"]
    assert "rf" in data["models"]
    print("  PASS: test_health")


def test_model_endpoints_do_not_block_event_loop():
    """CPU-bound model endpoints must be plain `def` so FastAPI runs them in a worker
    thread. As `async def` they block the event loop: /health stops answering during a
    forecast and the Express backend's 5 s health check reports the service as down."""
    import inspect
    import routes

    for fn in (routes.compute_risk_thresholds, routes.run_forecast, routes.run_classify, routes.evaluate_models):
        assert not inspect.iscoroutinefunction(fn), f"{fn.__name__} must not be async def"
    print("  PASS: test_model_endpoints_do_not_block_event_loop")


# ==================== Thresholds ====================

def test_thresholds_tertile():
    """POST /thresholds with tertile method."""
    r = client.post("/api/ml/thresholds", json={
        "incidences": list(range(1, 31)),
        "method": "tertile",
    })
    assert r.status_code == 200
    body = r.json()
    assert body["method"] == "tertile"
    assert body["low_max"] < body["med_max"]
    # Percentile basis is reported so the UI can label the bands as
    # data-derived rather than an official epidemiological threshold.
    assert body["low_pct"] == 100.0 / 3.0
    assert body["med_pct"] == 60.0
    print(f"  PASS: test_thresholds_tertile (low={body['low_max']:.1f}, med={body['med_max']:.1f}, pct={body['low_pct']:.1f}/{body['med_pct']:.1f})")


def test_thresholds_jenks():
    """POST /thresholds with jenks method."""
    r = client.post("/api/ml/thresholds", json={
        "incidences": [1, 2, 3, 50, 51, 52, 200, 201, 202],
        "method": "jenks",
    })
    assert r.status_code == 200
    body = r.json()
    assert body["method"] == "jenks"
    assert body["low_max"] < body["med_max"]
    assert body["low_pct"] is None and body["med_pct"] is None
    print(f"  PASS: test_thresholds_jenks (low={body['low_max']:.1f}, med={body['med_max']:.1f})")


def test_thresholds_empty():
    """Empty incidences should return 400."""
    r = client.post("/api/ml/thresholds", json={"incidences": []})
    assert r.status_code == 400
    print("  PASS: test_thresholds_empty")


# ==================== Forecast ====================

def test_forecast_normal():
    """Forecast with 12 months of data."""
    series = [
        {"barangay_name": "Manggahan", "month": f"2024-{m:02d}-01", "case_count": c}
        for m, c in enumerate([5, 8, 6, 10, 7, 12, 9, 11, 8, 13, 7, 10], 1)
    ]
    r = client.post("/api/ml/forecast", json={"series": series})
    assert r.status_code == 200
    data = r.json()
    assert len(data["forecasts"]) == 1
    f = data["forecasts"][0]
    assert f["barangay_name"] == "Manggahan"
    assert f["method"] in ("arima", "arima_nonseasonal", "exponential_smoothing", "seasonal_naive")
    assert len(f["predictions"]) == 1
    assert f["predictions"][0]["yhat"] >= 0
    assert f["predictions"][0]["yhat_lower"] <= f["predictions"][0]["yhat"]
    assert f["predictions"][0]["yhat_upper"] >= f["predictions"][0]["yhat"]
    # 12 months: the backtest holdout shrinks so at least 10 months remain for fitting
    assert f["backtest_mae"] is not None and f["backtest_mae"] >= 0
    print(f"  PASS: test_forecast_normal (method={f['method']})")


def test_forecast_with_backtest():
    """Forecast with long enough series should have backtest_mae."""
    import datetime
    series = []
    base_date = datetime.date(2022, 1, 1)
    counts = [5, 8, 6, 10, 7, 12, 9, 11, 8, 13, 7, 10] * 3  # 36 months
    for i, c in enumerate(counts):
        dt = datetime.date(2022 + (i // 12), (i % 12) + 1, 1)
        series.append({
            "barangay_name": "Manggahan",
            "month": dt.strftime("%Y-%m-%d"),
            "case_count": c,
        })
    r = client.post("/api/ml/forecast", json={"series": series})
    assert r.status_code == 200
    f = r.json()["forecasts"][0]
    # 36 months > 6 + 12, so backtest_mae should be computed
    assert f["backtest_mae"] is not None
    assert f["backtest_mae"] >= 0
    print(f"  PASS: test_forecast_with_backtest (mae={f['backtest_mae']:.2f})")


def test_forecast_insufficient_history():
    """Below ARIMA_MIN_HISTORY_NONSEASONAL (10) months: no forecast at all,
    reported honestly as insufficient_data rather than a fabricated baseline."""
    series = [
        {"barangay_name": "Test", "month": "2024-01-01", "case_count": 5},
        {"barangay_name": "Test", "month": "2024-02-01", "case_count": 8},
    ]
    r = client.post("/api/ml/forecast", json={"series": series})
    assert r.status_code == 200
    f = r.json()["forecasts"][0]
    assert f["method"] == "insufficient_data"
    assert all(p["yhat"] is None for p in f["predictions"])
    print(f"  PASS: test_forecast_insufficient_history (method={f['method']})")


def test_forecast_baseline_tier():
    """10-23 months: a non-seasonal ARIMA fit can still succeed here, but is
    tagged 'arima_nonseasonal' (never plain 'arima') so downstream callers
    always show this tier as "Baseline Forecast", not "ARIMA"."""
    series = [
        {"barangay_name": "Test", "month": f"2024-{m:02d}-01", "case_count": 5 + m}
        for m in range(1, 13)
    ]
    r = client.post("/api/ml/forecast", json={"series": series})
    assert r.status_code == 200
    f = r.json()["forecasts"][0]
    assert f["method"] in ("seasonal_naive", "exponential_smoothing", "arima_nonseasonal")
    assert f["method"] != "arima"
    assert f["predictions"][0]["yhat"] is not None
    print(f"  PASS: test_forecast_baseline_tier (method={f['method']})")


def test_forecast_empty_series():
    """Empty series should return 400."""
    r = client.post("/api/ml/forecast", json={"series": []})
    assert r.status_code == 400
    print("  PASS: test_forecast_empty_series")


def test_forecast_multi_barangay():
    """Forecast multiple barangays."""
    series = []
    for b, base in [("Manggahan", 5), ("Bagong Ilog", 8)]:
        for m in range(1, 13):
            series.append({
                "barangay_name": b,
                "month": f"2024-{m:02d}-01",
                "case_count": base + (m % 3),
            })
    r = client.post("/api/ml/forecast", json={"series": series})
    assert r.status_code == 200
    assert len(r.json()["forecasts"]) == 2
    names = [f["barangay_name"] for f in r.json()["forecasts"]]
    assert "Manggahan" in names
    assert "Bagong Ilog" in names
    print("  PASS: test_forecast_multi_barangay")


# ==================== Classify ====================

def _make_train_rows():
    """Create training rows spanning Low/Medium/High bands."""
    rows = []
    for inc in [5, 10, 15, 20, 25]:        # Low
        rows.append({"features": {"rolling_12m_incidence": inc, "recent_trend": -0.1,
                      "seasonality_flag": 0, "lag_1m": inc - 2, "lag_2m": inc - 3,
                      "lag_3m": inc - 1, "neighbor_risk": 0.2, "historical_bias": 0.0},
                      "incidence": inc})
    for inc in [60, 70, 80, 90, 100]:      # Medium
        rows.append({"features": {"rolling_12m_incidence": inc, "recent_trend": 0.0,
                      "seasonality_flag": 1, "lag_1m": inc - 5, "lag_2m": inc - 8,
                      "lag_3m": inc - 3, "neighbor_risk": 1.0, "historical_bias": 0.0},
                      "incidence": inc})
    for inc in [160, 180, 200, 220, 240]:  # High
        rows.append({"features": {"rolling_12m_incidence": inc, "recent_trend": 0.4,
                      "seasonality_flag": 1, "lag_1m": inc - 10, "lag_2m": inc - 15,
                      "lag_3m": inc - 8, "neighbor_risk": 2.5, "historical_bias": 0.0},
                      "incidence": inc})
    return rows


def test_classify_with_training():
    """Classify with train + predict should train RF and return proba."""
    payload = {
        "thresholds": {"low_max": 40.0, "med_max": 120.0},
        "train": _make_train_rows(),
        "predict": [
            {"barangay_name": "Hot",
             "features": {"rolling_12m_incidence": 230, "recent_trend": 0.5,
                          "seasonality_flag": 1, "lag_1m": 220, "lag_2m": 210,
                          "lag_3m": 200, "neighbor_risk": 2.6, "historical_bias": 0.0}},
            {"barangay_name": "Cool",
             "features": {"rolling_12m_incidence": 8, "recent_trend": -0.2,
                          "seasonality_flag": 0, "lag_1m": 10, "lag_2m": 12,
                          "lag_3m": 11, "neighbor_risk": 0.1, "historical_bias": 0.0}},
        ],
    }
    r = client.post("/api/ml/classify", json=payload)
    assert r.status_code == 200
    data = r.json()
    assert len(data["predictions"]) == 2

    by_name = {p["barangay_name"]: p for p in data["predictions"]}
    assert by_name["Hot"]["risk_class"] == "High"
    assert by_name["Cool"]["risk_class"] == "Low"

    # Verify proba structure
    proba = by_name["Hot"]["proba"]
    assert set(proba.keys()) == {"Low", "Medium", "High"}
    assert abs(sum(proba.values()) - 1.0) < 1e-6
    print(f"  PASS: test_classify_with_training")


def test_classify_without_training():
    """Classify without train data should fall back to rule-based."""
    payload = {
        "thresholds": {"low_max": 150.0, "med_max": 350.0},
        "train": [],
        "predict": [
            {"barangay_name": "Low",
             "features": {"rolling_12m_incidence": 50, "recent_trend": -0.1,
                          "seasonality_flag": 0, "lag_1m": 45, "lag_2m": 40,
                          "lag_3m": 55, "neighbor_risk": 0.2, "historical_bias": 0.0}},
        ],
    }
    r = client.post("/api/ml/classify", json=payload)
    assert r.status_code == 200
    pred = r.json()["predictions"][0]
    assert pred["risk_class"] == "Low"
    assert pred["proba"]["Low"] == 1.0  # Rule-based: 100% confidence
    print("  PASS: test_classify_without_training")


def test_classify_empty_predict():
    """Empty predict list should return 400."""
    payload = {
        "thresholds": {"low_max": 40.0, "med_max": 120.0},
        "train": _make_train_rows(),
        "predict": [],
    }
    r = client.post("/api/ml/classify", json=payload)
    assert r.status_code == 400
    print("  PASS: test_classify_empty_predict")


# ==================== Evaluate ====================

def test_evaluate_walk_forward():
    """Walk-forward evaluation should return ARIMA + RF metrics."""
    import datetime
    # Build 36 months of data for one barangay — varying counts to span Low/Medium/High
    series = []
    base_date = datetime.date(2022, 1, 1)
    # Vary counts widely: low (5-10), medium (30-50), high (80-120)
    counts = [5, 8, 6, 10, 7, 12, 9, 11, 8, 13, 7, 10,   # months 1-12: low
              35, 40, 38, 45, 42, 50, 37, 48, 43, 55, 39, 47,  # months 13-24: medium
              90, 95, 88, 100, 92, 110, 85, 105, 98, 115, 87, 102]  # months 25-36: high

    for i, c in enumerate(counts):
        dt = datetime.date(2022 + (i // 12), (i % 12) + 1, 1)
        series.append({
            "barangay_name": "Manggahan",
            "month": dt.strftime("%Y-%m-%d"),
            "case_count": c,
        })

    # Build training rows (simplified: just incidence-based)
    train = []
    for i, c in enumerate(counts):
        pop = 30000
        inc = (c / pop) * 100_000
        train.append({
            "features": {
                "rolling_12m_incidence": inc,
                "recent_trend": 0.1,
                "seasonality_flag": 0,
                "lag_1m": counts[i - 1] if i > 0 else 0,
                "lag_2m": counts[i - 2] if i > 1 else 0,
                "lag_3m": counts[i - 3] if i > 2 else 0,
                "neighbor_risk": 0.3,
                "historical_bias": 0.0,
            },
            "incidence": inc,
        })

    # Thresholds that split the data into Low/Medium/High
    # Incidences: low ~16-43, medium ~117-167, high ~283-383
    payload = {
        "series": series,
        "train": train,
        "thresholds": {"low_max": 150.0, "med_max": 280.0},
        "min_train": 12,  # Lower min_train for test speed
    }
    r = client.post("/api/ml/evaluate", json=payload)
    assert r.status_code == 200
    data = r.json()
    assert "arima" in data
    assert "rf" in data
    assert data["arima"]["n_steps"] > 0
    assert data["rf"]["n_steps"] > 0
    assert data["arima"]["mae"] is not None
    assert data["rf"]["accuracy"] is not None
    # Reference scores are reported next to the model scores
    assert data["arima"]["baseline_mae"] is not None
    assert data["rf"]["baseline_accuracy"] is not None
    assert data["rf"]["priority_accuracy"] is not None
    assert data["rf"]["baseline_priority_accuracy"] is not None
    assert data["rf"]["within_one_accuracy"] is not None
    # Every evaluated barangay's own result is kept (not just the longest one's steps), so a caller
    # can show results for one barangay, or a year range, from what was saved.
    per = data["arima"]["per_barangay"]
    assert [b["barangay_name"] for b in per] == ["Manggahan"]
    assert per[0]["n_steps"] == data["arima"]["n_steps"]
    assert len(per[0]["steps"]) == per[0]["n_steps"]
    assert per[0]["mae"] == data["arima"]["mae"]  # one barangay: the mean of one
    print(f"  PASS: test_evaluate_walk_forward (ARIMA MAE={data['arima']['mae']:.2f}, RF acc={data['rf']['accuracy']:.2f})")


def test_classify_uses_month_for_balanced_labels():
    """Rows carrying `month` must be labelled by rank within their month.

    With absolute cut points every row here would be High (all incidences are
    far above med_max); ranking within each month yields thirds instead, so a
    forest trained on them can predict Low for the lowest-incidence barangay.
    """
    import rf_classifier

    train = []
    # 24 months x 3 barangays = 72 rows, above RF_MIN_TRAIN_ROWS so the RF trains
    for m in range(24):
        month = f"{2024 + m // 12}-{m % 12 + 1:02d}-01"
        for b, inc in enumerate([1000.0, 2000.0, 3000.0]):
            train.append({
                "features": {"rolling_12m_incidence": inc, "recent_trend": 0, "seasonality_flag": 0,
                             "lag_1m": b, "lag_2m": b, "lag_3m": b, "neighbor_risk": 0.5},
                "incidence": inc,
                "month": month,
            })
    labels = rf_classifier.derive_labels(train, 150.0, 350.0)
    assert set(labels) == {"Low", "Medium", "High"}

    r = client.post("/api/ml/classify", json={
        "thresholds": {"low_max": 150.0, "med_max": 350.0},
        "train": train,
        "predict": [{"barangay_name": "Lowest", "features": train[0]["features"]}],
    })
    assert r.status_code == 200
    assert r.json()["method"] == "random_forest"
    assert r.json()["predictions"][0]["risk_class"] == "Low"


# ==================== 404 ====================

def test_404():
    r = client.get("/api/ml/nonexistent")
    assert r.status_code == 404
    print("  PASS: test_404")


if __name__ == "__main__":
    tests = [
        test_health,
        test_thresholds_tertile,
        test_thresholds_jenks,
        test_thresholds_empty,
        test_forecast_normal,
        test_forecast_with_backtest,
        test_forecast_short_series,
        test_forecast_empty_series,
        test_forecast_multi_barangay,
        test_classify_with_training,
        test_classify_without_training,
        test_classify_empty_predict,
        test_evaluate_walk_forward,
        test_404,
    ]

    passed = 0
    failed = 0
    for test in tests:
        try:
            test()
            passed += 1
        except Exception as e:
            print(f"  FAIL: {test.__name__}: {e}")
            failed += 1

    print(f"\n{'=' * 50}")
    print(f"Results: {passed} passed, {failed} failed, {passed + failed} total")
    if failed == 0:
        print("All tests passed!")
    sys.exit(1 if failed else 0)
