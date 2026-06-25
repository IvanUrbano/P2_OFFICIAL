"""
TBInsight ML Service — Random Forest Classifier

Predicts Low/Medium/High risk classes on ARIMA-forecasted incidences.
Uses 6 features including historical_bias from Approach B feedback loop.

Design spec:
  - Labels derived from incidence tertiles on 3-year training window
  - RF learns to predict labels from multivariate features
  - Applied to ARIMA forecasts (predicts FUTURE risk, not present)
  - Thresholds frozen and passed in each /classify request
"""

import logging
from typing import Optional

import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier

logger = logging.getLogger(__name__)

# Fixed feature order (6 features with Approach B historical_bias)
FEATURES = [
    "forecasted_incidence",
    "recent_trend",
    "seasonality_flag",
    "population_density",
    "neighbor_risk",
    "historical_bias",
]

_BANDS = ["Low", "Medium", "High"]


def compute_incidence(cases: float, population: int) -> float:
    """Compute annualized incidence per 100k population."""
    if population <= 0:
        return 0.0
    return (cases / population) * 100_000


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

    if incidence_per_100k <= low_max:
        return "Low"
    elif incidence_per_100k >= high_min:
        return "High"
    else:
        return "Medium"


def _vec(features: dict) -> list[float]:
    """Convert feature dict to ordered vector."""
    return [float(features.get(f, 0)) for f in FEATURES]


def train_and_predict(
    train: list[dict],
    predict_rows: list[dict],
    low_max: float,
    med_max: float,
    random_state: int = 42,
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
        random_state: RF random state for reproducibility

    Returns:
        List of {barangay_name, risk_class, proba: {Low, Medium, High}}
    """
    if not train or not predict_rows:
        return []

    # Build training set
    X_train = [_vec(r["features"]) for r in train]
    y_train = [
        classify_incidence_tertile(r["incidence"], {"low_max": low_max, "med_max": med_max})
        for r in train
    ]

    # Train RF (shallow: max_depth=4, 200 trees — small data, avoid overfit)
    clf = RandomForestClassifier(
        n_estimators=200,
        max_depth=4,
        random_state=random_state,
        class_weight="balanced",
    )
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
        incidence = feat.get("population_density", 0)
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
