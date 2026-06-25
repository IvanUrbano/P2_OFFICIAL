"""
TBInsight ML Service — FastAPI Endpoint Integration Tests
Tests all endpoints against Plan 02 spec contracts.
"""

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.testclient import TestClient
from main import app

client = TestClient(app)


# ==================== Health ====================

def test_health():
    r = client.get("/api/ml/health")
    assert r.status_code == 200
    data = r.json()
    assert data["status"] == "ok"
    assert "arima" in data["models"]
    assert "rf" in data["models"]
    print("  PASS: test_health")


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
    print(f"  PASS: test_thresholds_tertile (low={body['low_max']:.1f}, med={body['med_max']:.1f})")


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
    assert f["method"] in ("arima", "exp_smoothing", "seasonal_naive")
    assert len(f["predictions"]) == 1
    assert f["predictions"][0]["yhat"] >= 0
    assert f["predictions"][0]["yhat_lower"] <= f["predictions"][0]["yhat"]
    assert f["predictions"][0]["yhat_upper"] >= f["predictions"][0]["yhat"]
    # backtest_mae should be null for 12-month series (too short for 6-month holdout)
    assert f["backtest_mae"] is None
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


def test_forecast_short_series():
    """Short series should fallback."""
    series = [
        {"barangay_name": "Test", "month": "2024-01-01", "case_count": 5},
        {"barangay_name": "Test", "month": "2024-02-01", "case_count": 8},
    ]
    r = client.post("/api/ml/forecast", json={"series": series})
    assert r.status_code == 200
    f = r.json()["forecasts"][0]
    assert f["method"] in ("seasonal_naive", "exp_smoothing")
    print(f"  PASS: test_forecast_short_series (method={f['method']})")


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
        rows.append({"features": {"forecasted_incidence": inc, "recent_trend": -0.1,
                      "seasonality_flag": 0, "population_density": 10000,
                      "neighbor_risk": 0.2, "historical_bias": 0.0},
                      "incidence": inc})
    for inc in [60, 70, 80, 90, 100]:      # Medium
        rows.append({"features": {"forecasted_incidence": inc, "recent_trend": 0.0,
                      "seasonality_flag": 1, "population_density": 20000,
                      "neighbor_risk": 1.0, "historical_bias": 0.0},
                      "incidence": inc})
    for inc in [160, 180, 200, 220, 240]:  # High
        rows.append({"features": {"forecasted_incidence": inc, "recent_trend": 0.4,
                      "seasonality_flag": 1, "population_density": 35000,
                      "neighbor_risk": 2.5, "historical_bias": 0.0},
                      "incidence": inc})
    return rows


def test_classify_with_training():
    """Classify with train + predict should train RF and return proba."""
    payload = {
        "thresholds": {"low_max": 40.0, "med_max": 120.0},
        "train": _make_train_rows(),
        "predict": [
            {"barangay_name": "Hot",
             "features": {"forecasted_incidence": 230, "recent_trend": 0.5,
                          "seasonality_flag": 1, "population_density": 36000,
                          "neighbor_risk": 2.6, "historical_bias": 0.0}},
            {"barangay_name": "Cool",
             "features": {"forecasted_incidence": 8, "recent_trend": -0.2,
                          "seasonality_flag": 0, "population_density": 9000,
                          "neighbor_risk": 0.1, "historical_bias": 0.0}},
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
             "features": {"forecasted_incidence": 50, "recent_trend": -0.1,
                          "seasonality_flag": 0, "population_density": 50000,
                          "neighbor_risk": 0.2, "historical_bias": 0.0}},
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


# ==================== Pipeline ====================

def test_pipeline():
    """Full pipeline: forecast -> classify."""
    series = [
        {"barangay_name": "Manggahan", "month": f"2024-{m:02d}-01", "case_count": c}
        for m, c in enumerate([5, 8, 6, 10, 7, 12, 9, 11, 8, 13, 7, 10], 1)
    ]
    r = client.post("/api/ml/pipeline", json={
        "series": series,
        "population": {"Manggahan": 30000},
        "historical_bias": {"Manggahan": 0.0},
    })
    assert r.status_code == 200
    data = r.json()
    assert "forecast" in data
    assert "classification" in data
    assert data["forecast"]["barangay_name"] == "Manggahan"
    assert data["classification"]["risk_class"] in ("Low", "Medium", "High")
    assert data["classification"]["incidence_per_100k"] >= 0
    print(f"  PASS: test_pipeline (risk={data['classification']['risk_class']})")


def test_pipeline_short_series():
    """Pipeline with short series should still work via fallback."""
    series = [
        {"barangay_name": "Short", "month": "2024-01-01", "case_count": 3},
        {"barangay_name": "Short", "month": "2024-02-01", "case_count": 5},
    ]
    r = client.post("/api/ml/pipeline", json={
        "series": series,
        "population": {"Short": 20000},
        "historical_bias": {"Short": 0.0},
    })
    assert r.status_code == 200
    data = r.json()
    assert data["forecast"]["method"] in ("seasonal_naive", "exp_smoothing")
    assert data["classification"]["risk_class"] in ("Low", "Medium", "High")
    print(f"  PASS: test_pipeline_short_series (method={data['forecast']['method']})")


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
        test_pipeline,
        test_pipeline_short_series,
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
