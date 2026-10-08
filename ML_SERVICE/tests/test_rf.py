"""
TBInsight ML Service — Random Forest Classifier Tests
"""

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from rf_classifier import (
    FEATURES,
    compute_incidence,
    classify_incidence_tertile,
    train_and_predict,
    classify_risk_simple,
    walk_forward_rf,
)


def test_features_are_the_fixed_ten():
    """FEATURES: the original 7 (historical_bias removed) plus incidence_3m and the two ranks."""
    assert FEATURES == [
        "rolling_12m_incidence",
        "incidence_3m",
        "recent_trend",
        "seasonality_flag",
        "lag_1m",
        "lag_2m",
        "lag_3m",
        "neighbor_risk",
        "incidence_rank",
        "prev_category",
    ]


def test_compute_incidence_normal():
    """Normal incidence calculation."""
    # Monthly cases are annualized (x12): 100 / 50000 * 100000 * 12
    result = compute_incidence(100, 50000)
    assert abs(result - 2400.0) < 0.01


def test_compute_incidence_zero_population():
    """Zero population should return 0."""
    result = compute_incidence(100, 0)
    assert result == 0.0


def test_compute_incidence_zero_cases():
    """Zero cases should return 0."""
    result = compute_incidence(0, 50000)
    assert result == 0.0


def test_classify_incidence_tertile_low():
    """Low incidence should classify as Low."""
    assert classify_incidence_tertile(100.0) == "Low"


def test_classify_incidence_tertile_high():
    """High incidence should classify as High."""
    assert classify_incidence_tertile(400.0) == "High"


def test_classify_incidence_tertile_medium():
    """Medium incidence should classify as Medium."""
    assert classify_incidence_tertile(250.0) == "Medium"


def test_classify_incidence_tertile_boundary_low_medium():
    """Boundary between Low and Medium."""
    result_low = classify_incidence_tertile(150.0)
    result_above = classify_incidence_tertile(151.0)
    assert result_low == "Low"
    assert result_above == "Medium"


def test_classify_incidence_tertile_boundary_medium_high():
    """Boundary between Medium and High."""
    # High is strictly above the cut point, matching thresholds.classify_incidence
    # and the Express rule-based fallback.
    assert classify_incidence_tertile(349.0) == "Medium"
    assert classify_incidence_tertile(350.0) == "Medium"
    assert classify_incidence_tertile(350.1) == "High"


def test_classify_incidence_tertile_custom_thresholds():
    """Custom thresholds (spec format) should work."""
    assert classify_incidence_tertile(30, {"low_max": 40, "med_max": 120}) == "Low"   # 30 <= 40
    assert classify_incidence_tertile(80, {"low_max": 40, "med_max": 120}) == "Medium"  # 40 < 80 <= 120
    assert classify_incidence_tertile(200, {"low_max": 40, "med_max": 120}) == "High"  # 200 > 120


def test_rf_predicts_high_for_clearly_high_forecast():
    """RF should predict High for high-incidence barangay."""
    low_max, med_max = 40.0, 120.0

    # Separable training set spanning the three bands
    train = []
    for inc in [5, 10, 15, 20, 25]:        # Low
        train.append({"features": {"rolling_12m_incidence": inc, "recent_trend": -0.1,
                      "seasonality_flag": 0, "lag_1m": inc - 2, "lag_2m": inc - 3,
                      "lag_3m": inc - 1, "neighbor_risk": 0.2, "historical_bias": 0.0},
                      "incidence": inc})
    for inc in [60, 70, 80, 90, 100]:      # Medium
        train.append({"features": {"rolling_12m_incidence": inc, "recent_trend": 0.0,
                      "seasonality_flag": 1, "lag_1m": inc - 5, "lag_2m": inc - 8,
                      "lag_3m": inc - 3, "neighbor_risk": 1.0, "historical_bias": 0.0},
                      "incidence": inc})
    for inc in [160, 180, 200, 220, 240]:  # High
        train.append({"features": {"rolling_12m_incidence": inc, "recent_trend": 0.4,
                      "seasonality_flag": 1, "lag_1m": inc - 10, "lag_2m": inc - 15,
                      "lag_3m": inc - 8, "neighbor_risk": 2.5, "historical_bias": 0.0},
                      "incidence": inc})

    predict = [
        {"barangay_name": "Hot",
         "features": {"rolling_12m_incidence": 230, "recent_trend": 0.5,
                      "seasonality_flag": 1, "lag_1m": 220, "lag_2m": 210,
                      "lag_3m": 200, "neighbor_risk": 2.6, "historical_bias": 0.0}},
        {"barangay_name": "Cool",
         "features": {"rolling_12m_incidence": 8, "recent_trend": -0.2,
                      "seasonality_flag": 0, "lag_1m": 10, "lag_2m": 12,
                      "lag_3m": 11, "neighbor_risk": 0.1, "historical_bias": 0.0}},
    ]

    out = train_and_predict(train, predict, low_max, med_max)
    by_name = {o["barangay_name"]: o for o in out}
    assert by_name["Hot"]["risk_class"] == "High"
    assert by_name["Cool"]["risk_class"] == "Low"

    # proba dict sums ~1 over the three bands
    p = by_name["Hot"]["proba"]
    assert set(p) == {"Low", "Medium", "High"}
    assert abs(sum(p.values()) - 1.0) < 1e-6


def test_train_and_predict_empty():
    """Empty inputs should return empty list."""
    assert train_and_predict([], [], 40.0, 120.0) == []
    assert train_and_predict([{"features": {}, "incidence": 10}], [], 40.0, 120.0) == []


def test_classify_risk_simple():
    """Rule-based classification should work without training data."""
    features = [
        {"barangay_name": "Low", "rolling_12m_incidence": 50.0},
        {"barangay_name": "High", "rolling_12m_incidence": 400.0},
    ]
    results = classify_risk_simple(features, {"low_max": 150.0, "med_max": 350.0})
    assert len(results) == 2
    assert results[0]["risk_class"] == "Low"
    assert results[1]["risk_class"] == "High"
    # 100% probability for assigned class
    assert results[0]["proba"]["Low"] == 1.0
    assert results[1]["proba"]["High"] == 1.0


def test_classify_risk_simple_empty():
    """Empty features should return empty list."""
    assert classify_risk_simple([]) == []


def test_walk_forward_rf_insufficient_data():
    """Walk-forward with too few samples should return empty results."""
    result = walk_forward_rf([], min_train=24)
    assert result["n_steps"] == 0
    assert result["accuracy"] is None


def test_walk_forward_rf_enough_data():
    """Walk-forward with enough data should produce evaluation results."""
    # Create 30 barangays x 25 months = 750 rows (min_train=720 for 30 barangays)
    train_rows = []
    for month_idx in range(25):
        for b in range(30):
            # Simulate varying incidence
            base = 50 + (month_idx * 2) + (b * 3)
            train_rows.append({
                "features": {
                    "rolling_12m_incidence": base,
                    "recent_trend": 0.1,
                    "seasonality_flag": 0,
                    "lag_1m": base - 5,
                    "lag_2m": base - 10,
                    "lag_3m": base - 15,
                    "neighbor_risk": 0.3,
                    "historical_bias": 0.0,
                },
                "incidence": base,
            })

    result = walk_forward_rf(train_rows, min_train=30, low_max=80.0, med_max=200.0)
    assert result["n_steps"] > 0
    assert result["accuracy"] is not None
    assert 0 <= result["accuracy"] <= 1
    assert result["f1_macro"] is not None
    assert len(result["steps"]) > 0


if __name__ == "__main__":
    tests = [
        test_features_are_the_fixed_eight,
        test_compute_incidence_normal,
        test_compute_incidence_zero_population,
        test_compute_incidence_zero_cases,
        test_classify_incidence_tertile_low,
        test_classify_incidence_tertile_high,
        test_classify_incidence_tertile_medium,
        test_classify_incidence_tertile_boundary_low_medium,
        test_classify_incidence_tertile_boundary_medium_high,
        test_classify_incidence_tertile_custom_thresholds,
        test_rf_predicts_high_for_clearly_high_forecast,
        test_train_and_predict_empty,
        test_classify_risk_simple,
        test_classify_risk_simple_empty,
        test_walk_forward_rf_insufficient_data,
        test_walk_forward_rf_enough_data,
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
