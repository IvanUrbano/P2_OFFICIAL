"""
TBInsight ML Service — Configuration

Frozen thresholds and model config.
Thresholds are computed once on the 3-year training window, then frozen.
Health officers can override via config.
"""

import os

# ==================== AUTH ====================

ML_API_KEY = os.environ.get("ML_API_KEY")
if not ML_API_KEY:
    raise RuntimeError("ML_API_KEY environment variable is required")

# ==================== MODEL CONFIG ====================

MODEL_VERSION = "arima-v1.0-rf-v1.0"

# Worker processes for per-barangay ARIMA fits (1 = serial). Defaults to up to 4 cores.
ML_N_JOBS = int(os.environ.get("ML_N_JOBS", "0")) or min(4, os.cpu_count() or 1)

# ARIMA settings
ARIMA_SEASONAL_PERIOD = 12  # Monthly data, annual seasonality
ARIMA_MIN_HISTORY = 24      # Months needed to fit a SEASONAL ARIMA (two full annual cycles)
ARIMA_MIN_HISTORY_NONSEASONAL = 10  # Months needed for a plain (non-seasonal) ARIMA;
                                    # below this, fall back to exponential smoothing
ARIMA_LEADING_TRIM_SHARE = 0.2      # Drop leading months whose city-wide total is below this
                                    # share of the median month (stray old records)
ARIMA_SPARSE_THRESHOLD = 0.5  # If >50% zeros in series, use fallback

# Random Forest settings (tuned for ~700+ monthly snapshot training samples).
# Chosen by walk-forward grid search over depth, tree count and split/leaf minima
# against the balanced relative-tertile labels (see rf_classifier.derive_labels):
# 55.3% accuracy on a three-way split whose majority-class baseline is 33.3%.
# Unbounded depth with small leaves beat the previous shallower, more constrained
# forest — once the labels were balanced, the earlier settings were underfitting.
RF_MAX_DEPTH = None
RF_N_ESTIMATORS = 500
RF_RANDOM_STATE = 42
RF_MIN_SAMPLES_SPLIT = 4
RF_MIN_SAMPLES_LEAF = 2

# Smaller, shallower forest for short histories (fewer than RF_LARGE_SAMPLE rows,
# e.g. one year x 30 barangays): deep trees would just memorize the noise.
RF_LARGE_SAMPLE = 400
RF_SMALL_MAX_DEPTH = 4
RF_SMALL_N_ESTIMATORS = 200

# Below this many training rows the RF is not trained; the classifier applies the
# incidence thresholds directly (the RF labels ARE those thresholds, so an RF fit on
# a handful of rows cannot improve on them).
RF_MIN_TRAIN_ROWS = 60

# Fallback settings
FALLBACK_METHOD = "exponential_smoothing"  # Options: "seasonal_naive", "exponential_smoothing"

# ==================== FROZEN THRESHOLDS ====================

# Tertiles computed on 3-year training window (incidence per 100k)
# These are PLACEHOLDER values — will be calibrated with real data
# For 30 barangays: Low = bottom 10, Medium = middle 10, High = top 10
TERTILE_THRESHOLDS = {
    "tertile_low_max": 150.0,    # Below this = Low risk
    "tertile_high_min": 350.0,   # Above this = High risk
}

# ==================== FEATURE CONFIG ====================

# RF features (7 features).
# NOTE: rf_classifier.py:FEATURES is the list actually used by the classifier
# (_vec); these two names are kept in sync manually and must not drift.
FEATURE_NAMES = [
    "rolling_12m_incidence",  # Annualized incidence per 100k from a 12-month window of ACTUAL case counts (not a forecast)
    "recent_trend",          # Linear regression slope of case counts over 12-month window
    "seasonality_flag",      # 1 if seasonal pattern detected, 0 otherwise
    "lag_1m",                # Case count 1 month ago (momentum)
    "lag_2m",                # Case count 2 months ago (momentum)
    "lag_3m",                # Case count 3 months ago (momentum)
    "neighbor_risk",         # Mean incidence of barangays sharing a border (month t-1), normalized [0,1]
]

# Feature scaling ranges (for normalization if needed)
FEATURE_RANGES = {
    "rolling_12m_incidence": (0, 1000),
    "recent_trend": (-10, 10),
    "seasonality_flag": (0, 1),
    "lag_1m": (0, 50),
    "lag_2m": (0, 50),
    "lag_3m": (0, 50),
    "neighbor_risk": (0, 1),
}

# ==================== RISK CLASSES ====================

RISK_CLASSES = ["Low", "Medium", "High"]

# ==================== ALERT RULES ====================

ALERT_RULES = {
    "high_risk_escalation": {
        "description": "Barangay forecast to enter High risk",
        "severity": "warning",
        "template": "{barangay_name} is projected to enter High risk in {period}. "
                    "Consider increasing resource allocation.",
    },
    "critical_surge": {
        "description": "Cases increased >30% in past 30 days",
        "severity": "danger",
        "template": "{barangay_name} — Cases increased {surge_pct}% in the past 30 days. "
                    "Immediate intervention required.",
    },
    "low_success_rate": {
        "description": "Treatment success rate dropped below 60%",
        "severity": "warning",
        "template": "{barangay_name} — Treatment success rate dropped to {success_rate}%. "
                    "Below WHO threshold.",
    },
}
