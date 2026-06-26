"""
TBInsight ML Service — Configuration

Frozen thresholds and model config.
Thresholds are computed once on the 3-year training window, then frozen.
Health officers can override via config.
"""

import os

# ==================== MODEL CONFIG ====================

MODEL_VERSION = "arima-v1.0-rf-v1.0"

# ARIMA settings
ARIMA_SEASONAL_PERIOD = 12  # Monthly data, annual seasonality
ARIMA_MIN_HISTORY = 24      # Minimum months for ARIMA (fallback if shorter)
ARIMA_SPARSE_THRESHOLD = 0.5  # If >50% zeros in series, use fallback

# Random Forest settings
RF_MAX_DEPTH = 10
RF_N_ESTIMATORS = 100
RF_RANDOM_STATE = 42
RF_MAX_FEATURES = 6  # Maximum features for the classifier

# Fallback settings
FALLBACK_METHOD = "seasonal_naive"  # Options: "seasonal_naive", "exponential_smoothing"

# ==================== FROZEN THRESHOLDS ====================

# Tertiles computed on 3-year training window (incidence per 100k)
# These are PLACEHOLDER values — will be calibrated with real data
# For 30 barangays: Low = bottom 10, Medium = middle 10, High = top 10
TERTILE_THRESHOLDS = {
    "tertile_low_max": 150.0,    # Below this = Low risk
    "tertile_high_min": 350.0,   # Above this = High risk
}

# ==================== FEATURE CONFIG ====================

# RF features (≤6 per design spec)
FEATURE_NAMES = [
    "forecasted_count",      # ARIMA forecast output
    "recent_trend",          # Slope of last 12 months
    "seasonality_flag",      # 1 if seasonal pattern detected, 0 otherwise
    "population_density",    # Cases per 100k population
    "neighbor_risk",         # Average risk of neighboring barangays
    "historical_bias",       # Feedback loop: AVG of past ARIMA forecast errors
]

# Feature scaling ranges (for normalization if needed)
FEATURE_RANGES = {
    "forecasted_count": (0, 50),
    "recent_trend": (-10, 10),
    "seasonality_flag": (0, 1),
    "population_density": (0, 1000),
    "neighbor_risk": (0, 1),
    "historical_bias": (-50, 50),
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
