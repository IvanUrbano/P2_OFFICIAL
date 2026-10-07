"""
TBInsight ML Service — Thresholds Module Tests
"""

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from thresholds import (
    LOW_PERCENTILE,
    MED_PERCENTILE,
    classify_incidence,
    tertile_thresholds,
    jenks_thresholds,
    compute_thresholds,
)


def test_classify_incidence_boundaries():
    """Classify incidence at boundary values."""
    assert classify_incidence(10, low_max=20, med_max=50) == "Low"
    assert classify_incidence(20, low_max=20, med_max=50) == "Low"     # inclusive lower band
    assert classify_incidence(35, low_max=20, med_max=50) == "Medium"
    assert classify_incidence(50, low_max=20, med_max=50) == "Medium"  # inclusive
    assert classify_incidence(51, low_max=20, med_max=50) == "High"


def test_percentile_basis_is_third_low_sixty_high():
    """The Moderate|High cut sits at the 60th percentile (lowered from 2/3)."""
    assert LOW_PERCENTILE == 100.0 / 3.0
    assert MED_PERCENTILE == 60.0
    assert LOW_PERCENTILE < MED_PERCENTILE < 100.0


def test_tertile_lower_third_low_rest_high():
    """low_max = 33.3 pct, med_max = 60 pct -> 10 Low / 8 Medium / 12 High."""
    inc = list(range(1, 31))  # 1..30
    t = tertile_thresholds(inc)
    assert t["method"] == "tertile"
    assert t["low_max"] < t["med_max"]
    assert t["low_pct"] == LOW_PERCENTILE
    assert t["med_pct"] == MED_PERCENTILE
    bands = [classify_incidence(x, t["low_max"], t["med_max"]) for x in inc]
    # cut points are 10.67 (low) and 18.4 (med) after linear interpolation
    assert bands.count("Low") == 10
    assert bands.count("Medium") == 8
    assert bands.count("High") == 12


def test_jenks_returns_two_ordered_breaks():
    """Jenks should return ordered break points."""
    inc = [1, 2, 3, 50, 51, 52, 200, 201, 202]
    t = jenks_thresholds(inc)
    assert t["method"] == "jenks"
    assert t["low_max"] < t["med_max"]


def test_jenks_classifies_all_values():
    """Jenks thresholds should classify all input values."""
    inc = [1, 2, 3, 50, 51, 52, 200, 201, 202]
    t = jenks_thresholds(inc)
    for x in inc:
        label = classify_incidence(x, t["low_max"], t["med_max"])
        assert label in ("Low", "Medium", "High")


def test_compute_thresholds_tertile():
    """compute_thresholds with method='tertile' should work."""
    inc = list(range(1, 31))
    result = compute_thresholds(inc, method="tertile")
    assert result["method"] == "tertile"
    assert result["low_max"] < result["med_max"]
    assert result["med_pct"] == MED_PERCENTILE


def test_compute_thresholds_jenks():
    """compute_thresholds with method='jenks' should work."""
    inc = [1, 2, 3, 50, 51, 52, 200, 201, 202]
    result = compute_thresholds(inc, method="jenks")
    assert result["method"] == "jenks"
    assert result["low_max"] < result["med_max"]
    # Jenks natural breaks do not map to a percentile cut.
    assert "low_pct" not in result
    assert "med_pct" not in result


if __name__ == "__main__":
    tests = [
        test_classify_incidence_boundaries,
        test_percentile_basis_is_third_low_sixty_high,
        test_tertile_lower_third_low_rest_high,
        test_jenks_returns_two_ordered_breaks,
        test_jenks_classifies_all_values,
        test_compute_thresholds_tertile,
        test_compute_thresholds_jenks,
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
