"""
TBInsight ML Service — Thresholds Module

Computes risk band cut points from incidence data.
Supports tertile (percentile-based) and Jenks natural breaks methods.

Classification rule:
  Low  if x <= low_max
  High if x > med_max
  Medium otherwise
"""

import logging

import numpy as np
import jenkspy

logger = logging.getLogger(__name__)


def classify_incidence(x: float, low_max: float, med_max: float) -> str:
    """
    Classify incidence into Low/Medium/High using frozen thresholds.

    Args:
        x: Incidence per 100k
        low_max: Upper bound for Low band (inclusive)
        med_max: Upper bound for Medium band (inclusive)

    Returns:
        "Low", "Medium", or "High"
    """
    if x <= low_max:
        return "Low"
    if x <= med_max:
        return "Medium"
    return "High"


def tertile_thresholds(incidences: list[float]) -> dict:
    """
    Compute tertile (33.3/66.6 percentile) cut points.

    Args:
        incidences: List of incidence values across all barangays

    Returns:
        {"method": "tertile", "low_max": float, "med_max": float}
    """
    arr = np.asarray(incidences, dtype=float)
    low_max = float(np.percentile(arr, 100.0 / 3.0))
    med_max = float(np.percentile(arr, 200.0 / 3.0))
    return {"method": "tertile", "low_max": low_max, "med_max": med_max}


def jenks_thresholds(incidences: list[float]) -> dict:
    """
    Compute Jenks natural breaks cut points (3-class).

    Args:
        incidences: List of incidence values across all barangays

    Returns:
        {"method": "jenks", "low_max": float, "med_max": float}
    """
    # jenkspy needs at least n_classes+1 distinct points
    breaks = jenkspy.jenks_breaks(list(map(float, incidences)), n_classes=3)
    # breaks = [min, b1, b2, max]; cut points are b1 (Low|Med) and b2 (Med|High)
    return {"method": "jenks", "low_max": float(breaks[1]), "med_max": float(breaks[2])}


def compute_thresholds(
    incidences: list[float],
    method: str = "tertile",
) -> dict:
    """
    Compute thresholds using the specified method.

    Args:
        incidences: List of incidence values
        method: "tertile" or "jenks"

    Returns:
        {"method": str, "low_max": float, "med_max": float}
    """
    if method == "jenks":
        return jenks_thresholds(incidences)
    return tertile_thresholds(incidences)
