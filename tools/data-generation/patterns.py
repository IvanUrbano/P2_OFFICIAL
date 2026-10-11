"""
The planted patterns of the simulated years (genyear.py) — fixed BEFORE any model is run on
them, so the models can be scored against a known answer (answer_sheet()).

All patterns are multipliers on a barangay-month's expected share of the year's cases; the
year totals stay at the official figures, so patterns move cases between barangays and
months, never add cases to the city.

  season      city-wide Jul-Sep peak: 1 + A cos(2 pi (month - 8) / 12), A fitted to real 2025
  rising      3 barangays, +10% a year (relative to their real 2025 level)
  falling     3 barangays, -10% a year
  outbreaks   +50% for 4 months in one barangay, +20% in the barangays sharing its border:
              2023 Mar-Jun (inside the training years) and 2026 Apr-Jul (inside the test months)

The barangays are picked with a fixed seed from those with at least MIN_CASES real 2025 cases
(lookups/barangay_cases_2025.json): in a barangay with ~20 cases a year a 10% trend or a +50%
month is smaller than the counting noise, so no model could be expected to see it. The other
barangays keep only the random multi-year drift. Every year sees the same choice.
2025 is the real registry: no pattern is applied to it (the multipliers are 1 there by design:
trends are relative to 2025 and no outbreak falls in 2025).
"""
import json
import math
import os
import random

SEED = "tbinsight-patterns-v1"
MIN_CASES = 100
TREND_PER_YEAR = 0.10
OUTBREAK = 1.50
SPILLOVER = 1.20
OUTBREAKS = [(2023, (3, 4, 5, 6)), (2026, (4, 5, 6, 7))]

_HERE = os.path.dirname(os.path.abspath(__file__))
ADJACENCY = json.load(open(os.path.join(_HERE, "lookups", "adjacency.json"), encoding="utf-8"))
BARANGAYS = sorted(ADJACENCY)
REAL_2025 = json.load(open(os.path.join(_HERE, "lookups", "barangay_cases_2025.json"), encoding="utf-8"))
ELIGIBLE = sorted(b for b in BARANGAYS if REAL_2025.get(b, 0) >= MIN_CASES)


def _choose():
    rng = random.Random(SEED)
    pool = ELIGIBLE[:]
    rng.shuffle(pool)
    first = pool.pop()
    # The second outbreak is in a barangay not touching the first one.
    second = next(b for b in pool if b not in ADJACENCY[first])
    pool.remove(second)
    rising, falling = pool[:3], pool[3:6]
    return {"outbreaks": [first, second], "rising": rising, "falling": falling}


CHOICE = _choose()


def planted(barangay):
    """Barangays carrying a planted pattern (their random drift is switched off in genyear.py)."""
    return barangay in CHOICE["rising"] + CHOICE["falling"] + CHOICE["outbreaks"]


def trend(barangay, year):
    if barangay in CHOICE["rising"]:
        return math.exp(TREND_PER_YEAR * (year - 2025))
    if barangay in CHOICE["falling"]:
        return math.exp(-TREND_PER_YEAR * (year - 2025))
    return 1.0


def outbreak(barangay, year, month):
    for centre, (y, months) in zip(CHOICE["outbreaks"], OUTBREAKS):
        if year == y and month in months:
            if barangay == centre:
                return OUTBREAK
            if barangay in ADJACENCY[centre]:
                return SPILLOVER
    return 1.0


def season(month, amplitude):
    return 1 + amplitude * math.cos(2 * math.pi * (month - 8) / 12)


def answer_sheet(amplitude):
    return {
        "seed": SEED,
        "eligible": {"rule": f"at least {MIN_CASES} real 2025 cases", "barangays": ELIGIBLE},
        "season": {"peak_month": 8, "amplitude": round(amplitude, 4),
                   "formula": "1 + A cos(2 pi (month - 8) / 12), city-wide"},
        "rising": {"barangays": CHOICE["rising"], "per_year": f"+{TREND_PER_YEAR:.0%} (x exp(0.10 * (year - 2025)))"},
        "falling": {"barangays": CHOICE["falling"], "per_year": f"-{TREND_PER_YEAR:.0%} (x exp(-0.10 * (year - 2025)))"},
        "outbreaks": [
            {"barangay": b, "year": y, "months": list(m), "multiplier": OUTBREAK,
             "neighbours": ADJACENCY[b], "neighbour_multiplier": SPILLOVER}
            for b, (y, m) in zip(CHOICE["outbreaks"], OUTBREAKS)
        ],
        "note": "Totals per year stay at the official figures: patterns move cases between barangays and months.",
    }
