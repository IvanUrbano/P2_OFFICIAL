"""
Generate a simulated Pasig TB registry year (2022-2024, 2026) in the exact format of the real 2025 file.

Calibrated to the official DOH-NCR eFOI figures for Pasig City (YEARS below): notified cases by
sex and the treatment success rate.

WHEN cases happen comes from a stated model, not from the 2025 calendar: each barangay-month
gets an expected share = the barangay's real 2025 share x its multi-year drift x the planted
patterns (patterns.py: a city-wide Jul-Sep seasonal peak, rising and falling barangays, two
outbreaks spreading to neighbours), and the year's records are drawn across barangay-months in
proportion. So no barangay repeats 2025 month by month (which let a "same month last year"
feature read the answer), and the planted patterns can be scored against the answer sheet.

WHAT a case looks like is resampled from the REAL 2025 registry: each record copies one real
record of the same sheet, sex and barangay (facility, age +-1, site, registration group, test
results), with all its dates moved to the drawn diagnosis day (the gaps between them unchanged).

Usage: python genyear.py <enriched_2025.xlsx> <out.xlsx> <fac_resolved.json> <registry.json> <bgymap.json> <year>
"""
import copy
import datetime as dt
import json
import math
import random
import re
import sys

import openpyxl

sys.path.insert(0, __import__("os").path.dirname(__file__))
from tbgen import (IdentityRegistry, MONTHS, assign_case_ids, facility_code, load_counters, save_counters,
                   fmt_date, parse_date, valid_age)
import patterns

SRC, OUT, FAC, REG, BGY = sys.argv[1:6]
YEAR = int(sys.argv[6])

# Official targets: DOH Metro Manila CHD eFOI response on tuberculosis (source LGU CHO/FHSIS
# report), Pasig City rows. Rows needing correction are deliberate (Validation page practice);
# "sex_missing" names the sex of the record whose sex is blanked (None: any).
YEARS = {
    2022: dict(table="Table 3", total=6016, male=3641, female=2375, tsr=0.8418, validated=0.98,
               typos=[("DSTB", "PINAGBUHTAN STA"), ("DSTB", "KAPITOLYO ST."), ("MN", "SAN JUAQIN EXT"),
                      ("DSTB", "MANGAHAN PH2"), ("MN", "STO TOMAS DELA"), ("DSTB", "STA.LUCIA ILAYA")],
               sex_missing=[("DSTB", None), ("DSTB", None), ("MN", None)], age_missing=("DSTB", "MN", "DSTB"),
               dx_missing=("DSTB", "MN"), dob_after=("DSTB", "MN"), short_id=("DSTB", "MN", "DSTB")),
    2023: dict(table="Table 4", total=6538, male=3891, female=2647, tsr=0.8880, validated=0.97,
               typos=[("DSTB", "PALATIW IBABA"), ("MN", "BAMBANG ILOG"), ("DSTB", "UGONG NORTE")],
               sex_missing=[("DSTB", "M"), ("MN", "F")], age_missing=("DSTB", "MN"),
               dx_missing=("DSTB",), dob_after=("MN",), short_id=("DSTB", "MN")),
    2024: dict(table="Table 5", total=5274, male=3140, female=2134, tsr=0.8845, validated=0.95,
               typos=[("DSTB", "SANTOLAN DAMAYAN"), ("DSTB", "MAYBUNGA EXT."), ("MN", "PINAGBUH.")],
               sex_missing=[("DSTB", "F"), ("MN", "M")], age_missing=("MN", "DSTB"),
               dx_missing=("MN",), dob_after=("DSTB",), short_id=("DSTB", "MN")),
    # The current year: no official figure exists yet. January-September at the real 2025
    # volume for those months (growth 1.00 - an assumption, change it when an official figure is
    # published), as a registry exported on `as_of` would look: records entered later are
    # absent, later outcomes still ON TREATMENT.
    2026: dict(forward=True, as_of=dt.date(2026, 10, 11), through_month=9, growth=1.00,
               typos=[("DSTB", "SANTOLAN DAMAYAN EXT"), ("MN", "UGONG NORTE PH")],
               sex_missing=[("DSTB", "M"), ("MN", "F")], age_missing=("DSTB",),
               dx_missing=("MN",), dob_after=("DSTB",), short_id=("MN",)),
}
CFG = YEARS[YEAR]
SHIFT = 2025 - YEAR
SEED = YEAR
rng = random.Random(SEED)
FORWARD = CFG.get("forward", False)
TOTAL, MALE, FEMALE = CFG.get("total"), CFG.get("male"), CFG.get("female")
TARGET_TSR = CFG.get("tsr")
BARANGAY_SPREAD = 0.15        # how far 2022 barangay shares sit from 2025 (lognormal sigma)
YEAR_NOISE = 0.04             # extra year-specific wobble for 2023 and 2024
VALIDATED_SHARE = CFG.get("validated")  # older records are almost all validated

FINAL = ["TREATMENT COMPLETED", "CURED", "LOST TO FF-UP", "DIED", "TREATMENT FAILED", "NOT EVALUATED", "EXCLUDED"]
SUCCESS = {"TREATMENT COMPLETED", "CURED"}
UNSUCCESSFUL = ["LOST TO FF-UP", "DIED", "TREATMENT FAILED", "NOT EVALUATED"]
HEADER_ROW = {"DSTB": 6, "MN": 1}
NEW_COLS = ["Case ID", "Last Name", "First Name", "Middle Name", "Suffix", "Date of Birth"]

resolved = json.load(open(FAC, encoding="utf-8"))
bgymap = json.load(open(BGY, encoding="utf-8"))
reg = IdentityRegistry(REG, seed=SEED)
COUNTERS = REG.replace("registry.json", "caseid_counters.json")
counters = load_counters(COUNTERS)
wb = openpyxl.load_workbook(SRC)

# ---------- read the real 2025 templates ----------
templates, headers = {}, {}
for kind, h in HEADER_ROW.items():
    ws = wb[kind]
    hdr = [str(c.value or "").strip() for c in ws[h]]
    headers[kind] = hdr
    rows = []
    for r in ws.iter_rows(min_row=h + 1, values_only=True):
        if not any(v not in (None, "") for v in r):
            continue
        rec = dict(zip(hdr, r))
        if parse_date(rec["Date of Diagnosis"]) is None or valid_age(rec["Age"]) is None:
            continue  # the two real typo rows are not used as templates
        rows.append(rec)
    templates[kind] = rows

MONTHS_IN_YEAR = CFG["through_month"] if FORWARD else 12

# ---------- sizes: eFOI totals split by the real sheet and sex mix ----------
counts = {k: len(v) for k, v in templates.items()}
male_share = {k: sum(str(r["Sex"]).upper().startswith("M") for r in v) / len(v) for k, v in templates.items()}
if FORWARD:  # no official total: the real 2025 counts per sheet and sex for the same months, times the growth
    plan = {k: {sex: round(CFG["growth"] * sum(str(r["Sex"]).upper().startswith(sex)
                                               and (d := parse_date(r["Date of Diagnosis"])).year == 2025
                                               and d.month <= MONTHS_IN_YEAR for r in v))
                for sex in ("M", "F")}
            for k, v in templates.items()}
else:
    n = {"DSTB": round(TOTAL * counts["DSTB"] / sum(counts.values()))}
    n["MN"] = TOTAL - n["DSTB"]
    expected_m = sum(n[k] * male_share[k] for k in n)
    males = {"DSTB": round(n["DSTB"] * male_share["DSTB"] * MALE / expected_m)}
    males["MN"] = MALE - males["DSTB"]
    plan = {k: {"M": males[k], "F": n[k] - males[k]} for k in n}
    assert sum(v["M"] for v in plan.values()) == MALE and sum(v["F"] for v in plan.values()) == FEMALE

# ---------- barangay drift: each barangay's share moves a little from 2025 ----------
# Each barangay drifts steadily from its 2022 share to its real 2025 share: 2022 sits a random
# lognormal step away, and 2023/2024 lie on the way (2/3 and 1/3 of the step) plus a small
# wobble, so the years form a trend rather than unrelated draws. (Separate from the planted
# patterns in patterns.py, which are what the models are scored on.)
barangays = sorted({b for b in bgymap.values() if b})
if YEAR == 2022:
    mult = {b: math.exp(rng.gauss(0, BARANGAY_SPREAD)) for b in barangays}
else:
    first = random.Random(2022)
    step = {b: first.gauss(0, BARANGAY_SPREAD) for b in barangays}  # the 2022 draws, reproduced
    mult = {b: math.exp(step[b] * SHIFT / 3 + rng.gauss(0, YEAR_NOISE)) for b in barangays}
# Barangays carrying a planted pattern follow it alone: a random drift could cancel a planted trend.
mult = {b: (1.0 if patterns.planted(b) else v) for b, v in mult.items()}

OTHER = None  # records with no Pasig barangay (blank, misspelled beyond matching, non-Pasig) keep their real share


def barangay_of(rec):
    return bgymap.get("" if rec.get("Brgy") is None else str(rec["Brgy"]))


# ---------- dates ----------
DATE_RE = re.compile(r"([A-Za-z]+) (\d{1,2}), (\d{4})")


def shift_cell(v, days):
    """Move every 'Month DD, YYYY' in a cell by `days`, keeping the rest (e.g. a time)."""
    if isinstance(v, dt.datetime):
        return v + dt.timedelta(days=days)
    if isinstance(v, dt.date):
        return v + dt.timedelta(days=days)
    if not isinstance(v, str):
        return v

    def sub(m):
        d = parse_date(m.group(0))
        return fmt_date(d + dt.timedelta(days=days)) if d else m.group(0)
    return DATE_RE.sub(sub, v)


def days_between(a, b):
    da, db = parse_date(a), parse_date(b)
    return (db - da).days if da and db else None


# Real treatment durations (start -> outcome) per final outcome, to date resolved outcomes.
durations = {}
for kind, rows in templates.items():
    for r in rows:
        o = str(r["Outcome/Status"]).strip().upper()
        d = days_between(r["Date Started Tx"], r["Date of Outcome/Status"])
        if o in FINAL and d is not None and 0 <= d <= 900:
            durations.setdefault(o, []).append(d)


def outcome_date(rec, outcome):
    start = parse_date(rec["Date Started Tx"]) or parse_date(rec["Date of Diagnosis"])
    pool = durations.get(outcome) or durations["TREATMENT COMPLETED"]
    return fmt_date(start + dt.timedelta(days=rng.choice(pool)))


final_mix = {}
for kind, rows in templates.items():
    c = {}
    for r in rows:
        o = str(r["Outcome/Status"]).strip().upper()
        if o in FINAL:
            c[o] = c.get(o, 0) + 1
    final_mix[kind] = c

# ---------- when the cases happen: the planted patterns (patterns.py) ----------
# City-wide seasonal amplitude fitted to the real 2025 registry: the Jul-Sep share above the
# monthly average, divided by the mean of the cosine over those months (cos 30 deg, 1, cos 30 deg).
real_month = [0] * 12
for rows in templates.values():
    for r in rows:
        d = parse_date(r["Date of Diagnosis"])
        if d.year == 2025:
            real_month[d.month - 1] += 1
peak = sum(real_month[6:9]) / 3 / (sum(real_month) / 12)
AMPLITUDE = max(0.0, min(0.3, (peak - 1) / ((2 * math.cos(math.pi / 6) + 1) / 3)))

# Each (barangay, month) cell's expected share of a sheet + sex: the barangay's real 2025
# share x drift x trend x season x outbreak. Cells are filled by drawing the year's records
# in proportion, which gives natural month-to-month randomness around the plan.
by_cell_pool = {}
for kind, rows in templates.items():
    for r in rows:
        sex = "M" if str(r["Sex"]).upper().startswith("M") else "F"
        by_cell_pool.setdefault((kind, sex, barangay_of(r)), []).append(r)


def cell_weight(b, month):
    if b is OTHER:
        return patterns.season(month, AMPLITUDE)
    return (mult.get(b, 1.0) * patterns.trend(b, YEAR) * patterns.season(month, AMPLITUDE)
            * patterns.outbreak(b, YEAR, month))


# ---------- build the records ----------
generated = {}
for kind in ("DSTB", "MN"):
    out = []
    for sex, k in plan[kind].items():
        groups = {b: pool for (kd, sx, b), pool in by_cell_pool.items() if kd == kind and sx == sex}
        base = {b: len(pool) for b, pool in groups.items()}  # real 2025 share of this sheet + sex
        cells = [(b, m) for b in groups for m in range(1, MONTHS_IN_YEAR + 1)]
        weights = [base[b] * cell_weight(b, m) for b, m in cells]
        for b, month in rng.choices(cells, weights=weights, k=k):
            t = rng.choice(groups[b])
            last = (dt.date(YEAR, 12, 31) if month == 12 else dt.date(YEAR, month + 1, 1) - dt.timedelta(days=1)).day
            dx = dt.date(YEAR, month, rng.randint(1, last))
            delta = (dx - parse_date(t["Date of Diagnosis"])).days
            rec = {h: shift_cell(v, delta) for h, v in t.items()}
            age = valid_age(rec["Age"])
            if age >= 5:
                rec["Age"] = float(max(5, min(100, int(age) + rng.randint(-1, 1))))
            if kind == "DSTB" and not FORWARD:
                rec["Validation Status"] = "Validated" if rng.random() < VALIDATED_SHARE else "Not validated"
            o = str(rec["Outcome/Status"]).strip().upper()
            if o == "ON TREATMENT":
                # Give the patient a final outcome from the real mix, dated with a real duration;
                # in the current year the as_of step below turns outcomes not reached yet back into
                # ON TREATMENT, so a record moved to an early month does not stay on treatment for
                # a year.
                mix = final_mix[kind]
                o = rng.choices(list(mix), weights=list(mix.values()))[0]
                rec["Outcome/Status"] = o
                rec["Date of Outcome/Status"] = outcome_date(rec, o)
            out.append(rec)
    generated[kind] = out

# ---------- the current year as exported on as_of ----------
as_of_report = {}
if FORWARD:
    AS_OF = CFG["as_of"]
    OTHER_DATES = ["Date of Screening", "Date of Notification", "RDT Release Date", "Microscopy Release Date"]
    for kind, rows in generated.items():
        kept, dropped, on_tx, not_started = [], 0, 0, 0
        for r in rows:
            created = parse_date(r["Date/Time Record was Created"])
            if created and created > AS_OF:
                # Diagnosed in January-September: treated as entered by the export (the months
                # kept are complete), so the record is created on a day before AS_OF instead.
                when = AS_OF - dt.timedelta(days=rng.randint(1, 10))
                r["Date/Time Record was Created"] = DATE_RE.sub(fmt_date(when), str(r["Date/Time Record was Created"]), count=1)
                dropped += 1
            start, outcome = parse_date(r["Date Started Tx"]), parse_date(r["Date of Outcome/Status"])
            status = str(r["Outcome/Status"]).strip().upper()
            if start and start > AS_OF:          # diagnosed, treatment not started yet
                r["Date Started Tx"] = "No Data"
                r["Outcome/Status"] = "DIAGNOSED"
                r["Date of Outcome/Status"] = r["Date of Diagnosis"]
                not_started += 1
            elif status in FINAL and outcome and outcome > AS_OF:  # outcome not reached yet
                r["Outcome/Status"] = "ON TREATMENT"
                r["Date of Outcome/Status"] = r["Date Started Tx"]  # the registry's own convention
                on_tx += 1
            for f in OTHER_DATES:
                if f in r and (d := parse_date(r[f])) and d > AS_OF:
                    r[f] = "No Data"
            kept.append(r)
        generated[kind] = kept
        as_of_report[kind] = {"entry_date_moved_before_export": dropped, "now_on_treatment": on_tx, "treatment_not_started": not_started}

# ---------- treatment success rate -> the eFOI figure for the year ----------
everyone = [r for rows in generated.values() for r in rows]
evaluated = [r for r in everyone if str(r["Outcome/Status"]).upper() in SUCCESS | set(UNSUCCESSFUL)]
successes = [r for r in evaluated if str(r["Outcome/Status"]).upper() in SUCCESS]
excess = len(successes) - round(TARGET_TSR * len(evaluated)) if TARGET_TSR is not None else 0
unsucc_mix = {}
for rows in templates.values():
    for r in rows:
        o = str(r["Outcome/Status"]).upper()
        if o in UNSUCCESSFUL:
            unsucc_mix[o] = unsucc_mix.get(o, 0) + 1
for rec in rng.sample(successes, max(0, excess)):
    o = rng.choices(list(unsucc_mix), weights=list(unsucc_mix.values()))[0]
    rec["Outcome/Status"] = o
    rec["Date of Outcome/Status"] = outcome_date(rec, o)

# ---------- order, numbers, identities, Case IDs ----------
for kind, rows in generated.items():
    rows.sort(key=lambda r: (parse_date(r["Date/Time Record was Created"]) or parse_date(r["Date of Diagnosis"]),
                             str(r["Date/Time Record was Created"])))
    case_rows = [{"idx": i, "dx": parse_date(r["Date of Diagnosis"]),
                  "code": facility_code(r["Treatment Health Facility"], r["Screening/Diagnosing Health Facility"], resolved)}
                 for i, r in enumerate(rows)]
    ids = assign_case_ids(case_rows, kind, counters)
    for i, r in enumerate(rows):
        p = reg.new(r["Sex"], r["Age"], parse_date(r["Date of Diagnosis"]))
        r.update({"Case ID": ids[i], "Last Name": p["last"].upper(), "First Name": p["first"].upper(),
                  "Middle Name": p["middle"].upper() or None, "Suffix": p["suffix"].upper() or None,
                  "Date of Birth": fmt_date(p["dob"])})
        r["#" if kind == "DSTB" else "No."] = float(i + 1)
    if kind == "MN":  # ITIS Lite numbers: unique, increasing by diagnosis date (synthetic)
        nxt = 1_012_000 + rng.randint(0, 999)
        for r in sorted(rows, key=lambda r: parse_date(r["Date of Diagnosis"])):
            nxt += rng.randint(5, 35)
            r["ITIS Lite Case No."] = float(nxt)

# ---------- a few rows that need fixing, as real registries have ----------
issues = []


def pick(kind, cond=lambda r: True):
    pool = [r for r in generated[kind] if cond(r) and not r.get("_issue")]
    r = rng.choice(pool)
    r["_issue"] = True
    return r


def pasig(r):
    return bgymap.get("" if r.get("Brgy") is None else str(r["Brgy"])) is not None


# Spellings the system cannot match on its own (checked against dataCleaner.matchBarangay).
for kind, typo in CFG["typos"]:
    r = pick(kind, pasig)
    r["Brgy"] = typo
    issues.append((kind, r["Case ID"], f'barangay misspelled as "{typo}" (Needs Assignment)'))
for kind, sex in CFG["sex_missing"]:
    r = pick(kind) if sex is None else pick(kind, lambda r, s=sex: str(r["Sex"]).upper().startswith(s))
    r["Sex"] = None
    issues.append((kind, r["Case ID"], "sex missing"))
# The system computes age from the date of birth, so an age is only truly missing
# when the date of birth is missing too.
for kind in CFG["age_missing"]:
    r = pick(kind)
    r["Age"] = None
    r["Date of Birth"] = None
    issues.append((kind, r["Case ID"], "age and date of birth missing"))
for kind in CFG["dx_missing"]:
    r = pick(kind)
    r["Date of Diagnosis"] = "No Data"
    issues.append((kind, r["Case ID"], "date of diagnosis missing"))
for kind in CFG["dob_after"]:
    r = pick(kind)
    d = parse_date(r["Date of Diagnosis"])
    r["Date of Birth"] = fmt_date(d.replace(year=d.year + 3) if not (d.month == 2 and d.day == 29) else d + dt.timedelta(days=1100))
    issues.append((kind, r["Case ID"], "date of birth typed after the diagnosis date"))
for kind in CFG["short_id"]:
    r = pick(kind)
    good = r["Case ID"]
    r["Case ID"] = good[:-5] + good[-4:]  # one digit short
    issues.append((kind, r["Case ID"], f"Case ID one digit short (should be {good})"))

# ---------- write the workbook in the 2025 layout ----------
for kind, h in HEADER_ROW.items():
    ws = wb[kind]
    style_row = [copy.copy(ws.cell(h + 1, c)._style) for c in range(1, len(headers[kind]) + 1)]
    ws.delete_rows(h + 1, ws.max_row - h)
    for i, rec in enumerate(generated[kind]):
        for c, name in enumerate(headers[kind], start=1):
            cell = ws.cell(h + 1 + i, c, rec.get(name))
            cell._style = copy.copy(style_row[c - 1])
    if kind == "DSTB":
        for row in ws.iter_rows(min_row=1, max_row=h - 1):
            for cell in row:
                if isinstance(cell.value, str) and "2025" in cell.value:
                    cell.value = cell.value.replace("2025", str(YEAR))

# Quarterly summary (replaces the real file's working sheet)
del wb["Sheet4"]
ws = wb.create_sheet("Summary")
ws.append(["Quarter", "DSTB", "MN", "Total"])
for q in range(4):
    row = [f"Q{q + 1} {YEAR}"]
    for kind in ("DSTB", "MN"):
        row.append(sum(1 for r in generated[kind]
                       if (d := parse_date(r["Date of Diagnosis"])) and d.year == YEAR and (d.month - 1) // 3 == q))
    ws.append(row + [row[1] + row[2]])

if "README" in wb.sheetnames:  # the template's own notes describe the real 2025 file
    del wb["README"]
notes = wb.create_sheet("README")
METHOD = [
    "Method: diagnosis dates follow a stated model, not the 2025 calendar. Each barangay-month's expected share is the",
    "  barangay's real 2025 share x a multi-year drift x the planted patterns (patterns.py: city-wide Jul-Sep seasonal peak,",
    "  rising and falling barangays, two outbreaks spreading to neighbours); the year's records are drawn in proportion.",
    "  Each record copies one real 2025 Pasig registry record of the same sheet (DSTB/MN), sex and barangay - facility,",
    "  age (+-1 year from age 5), site, registration group, test results - with all its dates moved to the drawn",
    "  diagnosis day (gaps between them unchanged). Patients still ON TREATMENT in the template get a final outcome",
    "  from the real outcome mix, dated with real treatment durations.",
]
if FORWARD:
    basis = [
        f"No official {YEAR} figure exists yet. Volume: the real 2025 registry's January-{dt.date(2000, CFG['through_month'], 1):%B}",
        f"  counts per sheet and sex, times {CFG['growth']:.2f} (an assumption; replace with the official figure when published).",
        *METHOD,
        f"As exported on {CFG['as_of']:%B %d, %Y}, with January-{dt.date(2000, CFG['through_month'], 1):%B} complete; an outcome not reached by then",
        "  stays ON TREATMENT (outcome date = treatment start, the registry's convention); treatment not started yet: DIAGNOSED.",
    ]
else:
    basis = [
        f"Calibrated to official figures: DOH Metro Manila CHD eFOI response on tuberculosis ({CFG['table']}; source LGU CHO/FHSIS report), Pasig City {YEAR}:",
        f"  notified TB cases {TOTAL:,} (male {MALE:,}, female {FEMALE:,}); treatment success rate {TARGET_TSR:.2%}.",
        *METHOD,
        f"  Outcomes are then adjusted to the official {YEAR} treatment success rate.",
    ]
for line in [
    f"{YEAR} PASIG TB REGISTRY — SIMULATED DATA",
    "",
    "Not real patient records. Built for system testing and demonstration.",
    *basis,
    "Names, dates of birth, Case IDs and ITIS Lite numbers are fictional. Dates of birth match the recorded age.",
    f"{len(issues)} rows deliberately carry data issues to correct on the Validation page:",
    *[f"  {k} {cid}: {what}" for k, cid, what in issues],
]:
    notes.append([line])
notes.column_dimensions["A"].width = 120

wb.save(OUT)
json.dump(patterns.answer_sheet(AMPLITUDE), open(__import__('os').path.join(__import__('os').path.dirname(OUT) or '.', 'answer_sheet.json'), 'w', encoding='utf-8'), indent=1)
reg.save()
save_counters(COUNTERS, counters)

# ---------- report ----------
ev = [r for r in everyone if str(r["Outcome/Status"]).upper() in SUCCESS | set(UNSUCCESSFUL)]
tsr = sum(str(r["Outcome/Status"]).upper() in SUCCESS for r in ev) / len(ev)
print(json.dumps({
    "rows": {k: len(v) for k, v in generated.items()},
    "male": sum(str(r["Sex"] or "").upper().startswith("M") for r in everyone),
    "female": sum(str(r["Sex"] or "").upper().startswith("F") for r in everyone),
    "treatment_success_rate": round(tsr, 4),
    "on_treatment_left": sum(str(r["Outcome/Status"]).upper() == "ON TREATMENT" for r in everyone),
    "issues": len(issues),
    **({"as_of": as_of_report} if FORWARD else {}),
}))
