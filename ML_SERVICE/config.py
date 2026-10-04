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

# ==================== WHERE THE REST LIVES ====================
#
# Not configured here (an older copy of each used to sit in this file unused):
#   - RF feature list ........ rf_classifier.FEATURES (the order the model reads)
#   - Risk band cut points ... computed per request by POST /thresholds (thresholds.py)
#   - Alert rules ............ BACKEND/tbinsight/alertEngine.js
