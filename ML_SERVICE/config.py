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

MODEL_VERSION = "arima-v1.2-rf-v1.3"  # rf v1.3: 16 features (lag_12m removed), band filling, depth 5

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

# Fit ARIMA on log(1 + cases) and convert back. Meant for small, skewed counts
# whose noise grows with the level. OFF: on the Pasig data (about 12 cases per
# barangay-month) walk-forward error got worse with it, both alone (MAE 2.59 ->
# 2.67) and combined with the city-first forecast (2.43 -> 2.45). Set
# ARIMA_LOG_TRANSFORM=1 to re-test if the data changes.
ARIMA_LOG_TRANSFORM = os.environ.get("ARIMA_LOG_TRANSFORM", "0") == "1"

# Average each barangay's own ARIMA forecast with a "city-first" forecast: one
# ARIMA on the city-wide total, split by each barangay's share of the last
# ARIMA_SHARE_WINDOW months. The city total is far smoother than any barangay.
ARIMA_COMBINE_CITY = os.environ.get("ARIMA_COMBINE_CITY", "1") == "1"
ARIMA_SHARE_WINDOW = 12
# Weight of the city-first forecast in that average (1 = city-first only). Each
# barangay's rate is nearly constant and its monthly counts are close to pure
# counting noise, so its own ARIMA mostly fits noise; the city total carries the
# one real pattern, the annual season. Walk-forward on 2023-2025 (months 19-36),
# skill against the 12-month average: own ARIMA averaged with city +1%, city-first
# with a forced seasonal fit +6% at weight 0.5 and +9% at weight 1. At weight 1 the
# per-barangay fits are skipped (they are only run if the city fit fails).
ARIMA_CITY_WEIGHT = float(os.environ.get("ARIMA_CITY_WEIGHT", "1.0"))

# Evaluation also scores the forecast as a 3-month TOTAL (the pipeline stores 3
# months ahead). Single barangay-months are mostly chance; over 3 months much of
# that cancels out, so this is the figure planning should read.
ARIMA_EVAL_TOTAL_MONTHS = 3

# Walk-forward evaluation runs the full auto_arima order search for a series
# once, then refits that same order on each following month's data, searching
# again every ARIMA_EVAL_RESELECT_MONTHS steps (and whenever the series reaches
# ARIMA_MIN_HISTORY, where the search switches to seasonal models). The search
# is the slow part: on Lambda, where fits run one at a time, searching every
# month took ~10 minutes and the backend's 5-minute limit cut the run off.
ARIMA_EVAL_RESELECT_MONTHS = 12

# Random Forest settings (tuned for ~700+ monthly snapshot training samples).
# Chosen by walk-forward search (labels kept out of training once they reach the
# test month) over depth 3/4/6/unbounded x leaf 5/10/20, two seeds each, with the
# all-history features. The labels are mostly counting noise around rates that barely
# change, so deep trees learn the noise: shallow trees with large leaves scored best.
# 2023-2025 data, 11 test months: accuracy 56.4% -> 59.1%, quadratic kappa
# 0.475 -> 0.561, above the "rank the last 12 months" rule (59.7%, 0.543); Low and
# High confused in 6.4% of cases. A perfect model knowing each barangay's true rate
# would score about 64% on these labels.
#
# Retuned on 2022-2026 data (real 2025 + simulated years) with five more features
# (lag_12m, incidence_6m, volatility, yoy_change, high_share_12m) and band filling
# (RF_FILL_BANDS; lag_12m was later removed, the figures below were measured with it): grid over depth 3/5/unbounded x leaf 10/20 x max_features sqrt/0.5,
# chosen on Oct 2024-Jul 2025 and checked on unseen Aug 2025-Jun 2026: accuracy
# 56.4% -> 62.7%, quadratic kappa 0.480 -> 0.663, Low/High never confused 92.1% -> 96.1%.
RF_MAX_DEPTH = 5
RF_N_ESTIMATORS = 500
RF_RANDOM_STATE = 42
RF_MIN_SAMPLES_SPLIT = 4
RF_MIN_SAMPLES_LEAF = 10
RF_MAX_FEATURES = 0.5         # share of features tried at each split

# Each month's labels have fixed band sizes (bottom third Low, top 40% High), so instead
# of taking each barangay's most likely class on its own, the barangays are ranked by
# their expected band (P(Medium) + 2 x P(High)) and the bands filled in that order, the
# same way the labels are made. Used when a whole month (>= 3 barangays) is classified.
RF_FILL_BANDS = True

# Smaller, shallower forest for short histories (fewer than RF_LARGE_SAMPLE rows,
# e.g. one year x 30 barangays): deep trees would just memorize the noise.
RF_LARGE_SAMPLE = 400
RF_SMALL_MAX_DEPTH = 4
RF_SMALL_N_ESTIMATORS = 200
# Leaves of RF_MIN_SAMPLES_LEAF would leave a short history too few splits to learn
# from (15 rows could not split at all). 5 scored best of 2/3/5 in walk-forward, whose
# early test months train on fewer than RF_LARGE_SAMPLE rows.
RF_SMALL_MIN_SAMPLES_LEAF = 5

# Months averaged into one RF label: the target month and the ones after it. Must
# match LABEL_HORIZON_MONTHS in BACKEND/tbinsight/pipeline.js. Walk-forward
# evaluation uses it to keep labels that reach into the test month out of training.
RF_LABEL_HORIZON_MONTHS = 3

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
