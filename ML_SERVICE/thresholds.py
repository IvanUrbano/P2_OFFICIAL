"""
TBInsight ML Service — Thresholds Module

Computes risk band cut points from incidence data.
Supports tertile (percentile-based) and Jenks natural breaks methods.

Classification rule:
  Low  if x <= low_max
  High if x > med_max
  Medium otherwise

Percentile basis (method "tertile"):
  The Low|Moderate cut sits at the 40th percentile and the Moderate|High cut
  at the 66.7th: 30 barangays -> 12 Low / 8 Moderate / 10 High. (It was 33.3 /
  60, i.e. 10 / 8 / 12, after a client request for more High barangays.) The
  Random Forest's 6-month risk levels score higher with 12 / 8 / 10 (walk-forward,
  Sep 2024-Apr 2026: exact level 58.4% -> 63.2%, High vs not High 75.8% ->
  77.6%), at the cost of fewer barangays shown High. These are data-derived model
  classification boundaries recomputed on every pipeline run, NOT official
  DOH epidemiological thresholds, and must never be presented as such.
"""

import logging

import numpy as np
import jenkspy

logger = logging.getLogger(__name__)

# Percentile cut points for the "tertile" method (see module docstring).
# Must match BACKEND/tbinsight/scoring.js.
LOW_PERCENTILE = 40.0
MED_PERCENTILE = 200.0 / 3.0


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
    Compute percentile cut points (40 / 66.7).

    The method name "tertile" is the endpoint's method id; the split itself
    is LOW_PERCENTILE and MED_PERCENTILE (see module docstring).

    Args:
        incidences: List of incidence values across all barangays

    Returns:
        {"method": "tertile", "low_max": float, "med_max": float,
         "low_pct": float, "med_pct": float}
    """
    arr = np.asarray(incidences, dtype=float)
    low_max = float(np.percentile(arr, LOW_PERCENTILE))
    med_max = float(np.percentile(arr, MED_PERCENTILE))
    return {
        "method": "tertile",
        "low_max": low_max,
        "med_max": med_max,
        "low_pct": LOW_PERCENTILE,
        "med_pct": MED_PERCENTILE,
    }


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
        {"method": str, "low_max": float, "med_max": float,
         "low_pct": float, "med_pct": float}  (percentiles only for tertile)
    """
    if method == "jenks":
        return jenks_thresholds(incidences)
    return tertile_thresholds(incidences)
