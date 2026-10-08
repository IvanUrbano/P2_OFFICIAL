"""
TBInsight ML Service — Random Forest Classifier

Predicts Low/Medium/High risk classes from historical/current case-data
features only. Independent of ARIMA: no feature here is derived from a
forecast, so RF classification does not require ARIMA to run or succeed.
Uses 10 features: 12- and 3-month incidence, trend, seasonality, three monthly
lags (as incidence), the incidence of the barangays that share a border
(neighbor_risk), and two ranks against the other barangays that month.

Design spec:
  - Labels derived from incidence tertiles, auto-calibrated per run from the
    current incidence distribution (NOT a fixed/official epidemiological
    threshold — see FEATURES and the caller's threshold calibration)
  - RF learns to predict labels from multivariate features
  - Thresholds frozen and passed in each /classify request
"""

import logging
from typing import Optional

import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import (
    accuracy_score,
    cohen_kappa_score,
    f1_score,
    precision_score,
    recall_score,
    confusion_matrix,
)

from thresholds import LOW_PERCENTILE, MED_PERCENTILE
from config import (
    RF_LARGE_SAMPLE,
    RF_MAX_DEPTH,
    RF_N_ESTIMATORS,
    RF_SMALL_MAX_DEPTH,
    RF_SMALL_N_ESTIMATORS,
    RF_RANDOM_STATE,
    RF_MIN_SAMPLES_SPLIT,
    RF_MIN_SAMPLES_LEAF,
)

logger = logging.getLogger(__name__)

# Fixed feature order (10 features). historical_bias (past ARIMA error) was removed:
# it measured the forecaster rather than TB risk, contributed nothing in
# walk-forward evaluation, and tied the classifier to ARIMA output.
# Training and prediction rows MUST supply this exact key set, in any order
# (values are read by name via _vec below), but changing a name here without
# updating every caller (BACKEND/tbinsight/pipeline.js:buildFeatureRow) would
# silently zero-fill the old key and break the model — the two sides are
# ONLY kept in sync by matching these strings exactly.
FEATURES = [
    "rolling_12m_incidence",  # renamed from forecasted_incidence: this is an
                               # annualized incidence computed from a rolling
                               # window of ACTUAL past case counts — never an
                               # ARIMA forecast. See buildFeatureRow in
                               # pipeline.js for the exact calculation.
    "incidence_3m",           # annualized incidence of the last 3 months
    "recent_trend",
    "seasonality_flag",
    "lag_1m",                 # lags are incidence per 100k (not raw counts)
    "lag_2m",
    "lag_3m",
    "neighbor_risk",  # mean incidence of the barangays sharing a border, month t-1
    "incidence_rank",         # rank of rolling_12m_incidence that month, 0..1
    "prev_category",          # band of the last 3 months (0 Low, 1 Medium, 2 High)
]

_BANDS = ["Low", "Medium", "High"]


def compute_incidence(cases: float, population: int) -> float:
    """Compute annualized incidence per 100k population."""
    if population <= 0:
        return 0.0
    return (cases / population) * 100_000 * 12


def classify_incidence_tertile(
    incidence_per_100k: float,
    thresholds: Optional[dict] = None,
) -> str:
    """
    Classify incidence into Low/Medium/High using frozen tertile thresholds.

    Args:
        incidence_per_100k: Annualized incidence
        thresholds: Dict with tertile_low_max, tertile_high_min
                    OR low_max, med_max (both formats supported)

    Returns:
        Risk class: "Low", "Medium", or "High"
    """
    if thresholds is None:
        # Default thresholds (PLACEHOLDER — will be calibrated with real data)
        low_max = 150.0
        high_min = 350.0
    elif "low_max" in thresholds:
        # Spec format: low_max, med_max
        low_max = thresholds["low_max"]
        high_min = thresholds["med_max"]
    else:
        # Legacy config format: tertile_low_max, tertile_high_min
        low_max = thresholds["tertile_low_max"]
        high_min = thresholds["tertile_high_min"]

    # Same boundaries as thresholds.classify_incidence and the Express rule fallback:
    # Low <= low_max, High > med_max
    if incidence_per_100k <= low_max:
        return "Low"
    elif incidence_per_100k > high_min:
        return "High"
    else:
        return "Medium"


def _vec(features: dict) -> list[float]:
    """Convert feature dict to ordered vector."""
    return [float(features.get(f, 0)) for f in FEATURES]


def band_for_rank(q: float) -> str:
    """
    Band for a position 0 (lowest) .. 1 (highest) among the barangays of one
    month: below LOW_PERCENTILE Low, at or above MED_PERCENTILE High.
    pipeline.js prev_category applies the same cut points.
    """
    if q < LOW_PERCENTILE / 100:
        return "Low"
    return "High" if q >= MED_PERCENTILE / 100 else "Medium"


def derive_labels(train: list[dict], low_max: float, med_max: float) -> list[str]:
    """
    Label each training row Low/Medium/High by its rank WITHIN its own month.

    Each month's barangays are ranked by incidence and cut at the same
    percentiles as the risk thresholds (thresholds.LOW_PERCENTILE /
    MED_PERCENTILE: bottom third Low, top 40% High, 30 barangays -> 10 / 8 / 12),
    so the Random Forest and the rule-based fallback agree on what "High" means.
    Every month contributes the same mix of bands, and it is the relative
    question the risk map actually asks: which barangays are the worst affected
    right now.

    The previous approach applied one pair of absolute cut points to every row.
    Those cut points were calibrated from a single month's cross-section and then
    used to label years of data, so most rows fell above them: the labels came out
    roughly 11% Low, 22% Medium, 67% High rather than thirds. A classifier trained
    on that learns to answer High almost always, and walk-forward evaluation scored
    it below simply answering High every time — worse than no model at all.

    Rows without a 'month' fall back to the absolute cut points, which keeps older
    callers and the /classify contract working.

    Note this makes the band explicitly relative: about 40% of barangays are
    always High, and a barangay moves band only by moving relative to the others.
    """
    rows_with_month = [r for r in train if r.get("month")]
    if len(rows_with_month) < len(train):
        return [
            classify_incidence_tertile(r["incidence"], {"low_max": low_max, "med_max": med_max})
            for r in train
        ]

    by_month: dict[str, list[int]] = {}
    for idx, r in enumerate(train):
        by_month.setdefault(r["month"], []).append(idx)

    labels = [""] * len(train)
    for _month, idxs in by_month.items():
        if len(idxs) < 3:
            # Too few barangays in the month to split into three; fall back.
            for i in idxs:
                labels[i] = classify_incidence_tertile(
                    train[i]["incidence"], {"low_max": low_max, "med_max": med_max}
                )
            continue
        order = sorted(idxs, key=lambda i: train[i]["incidence"])
        n = len(order)
        for rank, i in enumerate(order):
            q = rank / (n - 1) if n > 1 else 0.0
            labels[i] = band_for_rank(q)
    return labels


def _make_rf(n_samples: int) -> RandomForestClassifier:
    """Random forest sized to the amount of training data."""
    large = n_samples >= RF_LARGE_SAMPLE
    return RandomForestClassifier(
        n_estimators=RF_N_ESTIMATORS if large else RF_SMALL_N_ESTIMATORS,
        max_depth=RF_MAX_DEPTH if large else RF_SMALL_MAX_DEPTH,
        min_samples_split=RF_MIN_SAMPLES_SPLIT,
        min_samples_leaf=RF_MIN_SAMPLES_LEAF,
        random_state=RF_RANDOM_STATE,
        class_weight="balanced",
    )


def train_and_predict(
    train: list[dict],
    predict_rows: list[dict],
    low_max: float,
    med_max: float,
) -> list[dict]:
    """
    Train RF on labeled training data and predict risk classes.

    Each training row has 'features' dict + 'incidence' float.
    Labels are derived from incidence via classify_incidence_tertile.

    Args:
        train: Training rows with features + incidence
        predict_rows: Prediction rows with barangay_name + features
        low_max: Low/Medium threshold
        med_max: Medium/High threshold

    Returns:
        List of {barangay_name, risk_class, proba: {Low, Medium, High}}
    """
    if not train or not predict_rows:
        return []

    # Build training set
    X_train = [_vec(r["features"]) for r in train]
    y_train = derive_labels(train, low_max, med_max)

    clf = _make_rf(len(X_train))
    clf.fit(X_train, y_train)

    # Predict
    X_predict = [_vec(r["features"]) for r in predict_rows]
    classes = clf.predict(X_predict)
    probas = clf.predict_proba(X_predict)
    label_order = list(clf.classes_)

    out = []
    for row, cls, pr in zip(predict_rows, classes, probas):
        proba = {b: 0.0 for b in _BANDS}
        for label, p in zip(label_order, pr):
            proba[label] = float(p)
        out.append({
            "barangay_name": row["barangay_name"],
            "risk_class": str(cls),
            "proba": proba,
        })

    logger.info(
        f"RF trained on {len(train)} samples, predicted {len(predict_rows)} rows"
    )
    return out


def classify_risk_simple(
    features: list[dict],
    thresholds: Optional[dict] = None,
) -> list[dict]:
    """
    Simple rule-based classification (no RF training).
    Used as fallback when no training data is available.

    Args:
        features: Feature vectors per barangay
        thresholds: Dict with low_max, med_max (or tertile_low_max, tertile_high_min)

    Returns:
        List of {barangay_name, risk_class, proba}
    """
    results = []
    for feat in features:
        name = feat.get("barangay_name", "")
        incidence = feat.get("rolling_12m_incidence", 0)
        risk_class = classify_incidence_tertile(incidence, thresholds)

        # Rule-based: 100% probability for the assigned class
        proba = {"Low": 0.0, "Medium": 0.0, "High": 0.0}
        proba[risk_class] = 1.0

        results.append({
            "barangay_name": name,
            "risk_class": risk_class,
            "proba": proba,
        })

    return results


def walk_forward_rf(
    train_rows: list[dict],
    min_train: int = 24,
    low_max: float = 150.0,
    med_max: float = 350.0,
    n_barangays: Optional[int] = None,
) -> dict:
    """
    Walk-forward evaluation for RF classification (Option C: group by month).

    At each step, trains on ALL barangay-months before month T,
    then predicts ALL barangay-months at month T.

    Args:
        train_rows: List of {features: {...}, incidence: float} sorted by time.
                    Each row is one barangay at one month.
        min_train: Minimum number of training samples before testing starts.
                   With 30 barangays and starting at month 25, this = 30 * 24 = 720.
        low_max: Low/Medium threshold for label derivation
        med_max: Medium/High threshold for label derivation
        n_barangays: Number of barangays (if known). Auto-detected from barangay_name if not provided.

    Returns:
        {
            "steps": [{"train_size": int, "test_month": int, "actual": [...], "predicted": [...], "correct": int, "total": int}],
            "accuracy": float,
            "f1_macro": float,
            "precision": dict,
            "recall": dict,
            "confusion_matrix": dict,
            "n_steps": int,
        }
    """
    if len(train_rows) < min_train + 1:
        return {
            "steps": [],
            "accuracy": None,
            "f1_macro": None,
            "precision": None,
            "recall": None,
            "confusion_matrix": None,
            "n_steps": 0,
        }

    steps = []
    all_actuals = []
    all_predicted = []
    all_baseline = []
    all_persistence = []

    # Reorder rows from barangay-first to time-first grouping
    # _buildTrainingRows produces: [B1-M1, B1-M2, ..., B1-M36, B2-M1, B2-M2, ...]
    # We need: [B1-M1, B2-M1, ..., B30-M1, B1-M2, B2-M2, ..., B30-M2, ...]
    # Detect by checking if consecutive rows have the same barangay_name
    needs_reorder = False
    for i in range(1, min(30, len(train_rows))):
        if train_rows[i].get("barangay_name") == train_rows[0].get("barangay_name"):
            needs_reorder = True
            break

    if needs_reorder:
        # Group by position within each barangay's time series
        from collections import defaultdict
        by_name = defaultdict(list)
        for r in train_rows:
            by_name[r.get("barangay_name", "")].append(r)

        # Interleave: take one row from each barangay in round-robin
        reordered = []
        max_len = max(len(rows) for rows in by_name.values())
        name_list = sorted(by_name.keys())
        for t in range(max_len):
            for name in name_list:
                if t < len(by_name[name]):
                    reordered.append(by_name[name][t])
        train_rows = reordered

    # Group rows by time position (each group = one month across all barangays)
    # Assuming rows are now sorted by time, group every n_barangays together
    if n_barangays is None:
        detected = set(r.get("barangay_name") for r in train_rows if r.get("barangay_name"))
        n_barangays = len(detected) if detected else 30

    # Calculate steps: from min_train to end, one step per barangay-count of rows
    step_size = n_barangays
    n_steps = (len(train_rows) - min_train) // step_size

    for step_idx in range(n_steps):
        test_start = min_train + step_idx * step_size
        test_end = min(test_start + step_size, len(train_rows))

        if test_end > len(train_rows):
            break

        train_data = train_rows[:test_start]
        test_data = train_rows[test_start:test_end]

        # Build training set
        X_train = [_vec(r["features"]) for r in train_data]
        y_train = derive_labels(train_data, low_max, med_max)

        # Skip if only one class in training set
        if len(set(y_train)) < 2:
            continue

        # Build test set
        X_test = [_vec(r["features"]) for r in test_data]
        y_test_actual = derive_labels(test_data, low_max, med_max)

        # Train and predict
        clf = _make_rf(len(X_train))
        clf.fit(X_train, y_train)
        y_test_pred = clf.predict(X_test)

        # Reference classifier on the same month: the simple rule, labelling
        # the barangays by their last-12-month incidence with the same
        # labelling scheme as the target (thirds within the month).
        y_test_base = derive_labels(
            [
                {**r, "incidence": float(r["features"].get("rolling_12m_incidence", 0))}
                for r in test_data
            ],
            low_max,
            med_max,
        )
        all_baseline.extend(y_test_base)
        # Second reference: the band of the last 3 months carries over unchanged.
        all_persistence.extend(
            _BANDS[int(r["features"].get("prev_category", 1))] if "prev_category" in r["features"]
            else base
            for r, base in zip(test_data, y_test_base)
        )

        # Record step results
        correct = sum(1 for a, p in zip(y_test_actual, y_test_pred) if a == p)
        steps.append({
            "train_size": len(train_data),
            "test_month": step_idx + 1,
            "actual": y_test_actual,
            "predicted": list(y_test_pred),
            "correct": correct,
            "total": len(y_test_actual),
        })

        all_actuals.extend(y_test_actual)
        all_predicted.extend(y_test_pred)

    # Aggregate metrics
    if not all_actuals:
        return {
            "steps": steps,
            "accuracy": None,
            "f1_macro": None,
            "precision": None,
            "recall": None,
            "confusion_matrix": None,
            "n_steps": 0,
        }

    all_classes = ["Low", "Medium", "High"]
    accuracy = accuracy_score(all_actuals, all_predicted)
    f1 = f1_score(all_actuals, all_predicted, average="macro", zero_division=0)
    prec = precision_score(all_actuals, all_predicted, average=None, labels=all_classes, zero_division=0)
    rec = recall_score(all_actuals, all_predicted, average=None, labels=all_classes, zero_division=0)
    cm = confusion_matrix(all_actuals, all_predicted, labels=all_classes)

    # Quadratic-weighted kappa: agreement beyond chance, where calling a High
    # barangay Low costs four times as much as calling it Medium.
    band_index = {c: i for i, c in enumerate(all_classes)}

    def kappa(predicted):
        return round(float(cohen_kappa_score(
            [band_index[c] for c in all_actuals],
            [band_index[c] for c in predicted],
            weights="quadratic",
        )), 4)

    result = {
        "steps": steps,
        "accuracy": round(float(accuracy), 4),
        "f1_macro": round(float(f1), 4),
        "precision": {cls: round(float(p), 4) for cls, p in zip(all_classes, prec)},
        "recall": {cls: round(float(r), 4) for cls, r in zip(all_classes, rec)},
        "confusion_matrix": {
            cls: {pred_cls: int(cm[i][j]) for j, pred_cls in enumerate(all_classes)}
            for i, cls in enumerate(all_classes)
        },
        "n_steps": len(steps),
        "baseline_accuracy": round(float(accuracy_score(all_actuals, all_baseline)), 4),
        "baseline_f1_macro": round(float(
            f1_score(all_actuals, all_baseline, average="macro", zero_division=0)
        ), 4),
        "kappa": kappa(list(all_predicted)),
        "baseline_kappa": kappa(all_baseline),
        "persistence_accuracy": round(float(accuracy_score(all_actuals, all_persistence)), 4),
        "persistence_kappa": kappa(all_persistence),
    }

    logger.info(
        f"RF walk-forward: {len(steps)} steps, accuracy={result['accuracy']}, "
        f"f1_macro={result['f1_macro']}, kappa={result['kappa']}"
    )
    return result
