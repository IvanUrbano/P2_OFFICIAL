"""
TBInsight ML Service — Thresholds Module

Computes risk band cut points from incidence data.
Supports tertile (percentile-based) and Jenks natural breaks methods.

Classification rule:
  Low  if x <= low_max
  High if x > med_max
  Medium otherwise

Percentile basis (method "tertile"):
  The Low|Moderate cut sits at the 33.3 percentile (bottom third = Low) and
  the Moderate|High cut at the 60th percentile. The Moderate|High cut was
  lowered from the 66.7 percentile so more barangays surface as High Risk
  (client request) without collapsing the Moderate band — a 40th percentile
  cut leaves only 2 of 30 barangays Moderate. These are data-derived model
  classification boundaries recomputed on every pipeline run, NOT official
  DOH epidemiological thresholds, and must never be presented as such.
"""

import logging

import numpy as np
import jenkspy

logger = logging.getLogger(__name__)

# Percentile cut points for the "tertile" method. LOW_PERCENTILE is
# unchanged; MED_PERCENTILE is the lowered Moderate|High cut.
LOW_PERCENTILE = 100.0 / 3.0
MED_PERCENTILE = 60.0


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
    Compute percentile cut points (33.3 / 60.0).

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
