"""
Generate a simulated Pasig TB registry year (2022-2024) in the exact format of the real 2025 file.

Calibrated to the official DOH-NCR eFOI figures for Pasig City (YEARS below): notified cases by
sex and the treatment success rate. Everything else is resampled from the REAL 2025 registry
(same sheet and sex): each record copies one real record's facility, barangay, age, site,
registration group and test results, with all its dates moved back to the target year (the gaps
between them unchanged).

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
from tbgen import (IdentityRegistry, MONTHS, _minus_years, assign_case_ids, facility_code, load_counters, save_counters,
                   fmt_date, parse_date, valid_age)

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
    # The current year: no official figure exists yet. Built forward from the real 2025 registry
    # (January-August: September is still being entered on as_of, and a half-entered month would
    # read to the models as a real drop), at the 2025 volume (growth 1.00 - an
    # assumption, change it when an official figure is published), as a registry exported on
    # `as_of` would look: records entered later are absent, later outcomes still ON TREATMENT.
    2026: dict(forward=True, as_of=dt.date(2026, 10, 9), through_month=8, growth=1.00,
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

if FORWARD:  # the same calendar months of the real 2025 registry
    templates = {k: [r for r in v if (d := parse_date(r["Date of Diagnosis"])).year == 2025
                     and d.month <= CFG["through_month"]] for k, v in templates.items()}

# ---------- sizes: eFOI totals split by the real sheet and sex mix ----------
counts = {k: len(v) for k, v in templates.items()}
male_share = {k: sum(str(r["Sex"]).upper().startswith("M") for r in v) / len(v) for k, v in templates.items()}
if FORWARD:  # no official total: the real 2025 counts per sheet and sex, times the growth
    plan = {k: {sex: round(CFG["growth"] * sum(str(r["Sex"]).upper().startswith(sex) for r in v)) for sex in ("M", "F")}
            for k, v in templates.items()}
else:
    n = {"DSTB": round(TOTAL * counts["DSTB"] / sum(counts.values()))}
    n["MN"] = TOTAL - n["DSTB"]
    expected_m = sum(n[k] * male_share[k] for k in n)
    males = {"DSTB": round(n["DSTB"] * male_share["DSTB"] * MALE / expected_m)}
    males["MN"] = MALE - males["DSTB"]
    plan = {k: {"M": males[k], "F": n[k] - males[k]} for k in n}
    assert sum(v["M"] for v in plan.values()) == MALE and sum(v["F"] for v in plan.values()) == FEMALE

# ---------- barangay variation: each barangay's share moves a little from 2025 ----------
# Each barangay drifts steadily from its 2022 share to its real 2025 share: 2022 sits a random
# lognormal step away, and 2023/2024 lie on the way (2/3 and 1/3 of the step) plus a small
# wobble, so the years form a trend rather than unrelated draws.
barangays = sorted({b for b in bgymap.values() if b})
if YEAR == 2022:
    mult = {b: math.exp(rng.gauss(0, BARANGAY_SPREAD)) for b in barangays}
else:
    first = random.Random(2022)
    step = {b: first.gauss(0, BARANGAY_SPREAD) for b in barangays}  # the 2022 draws, reproduced
    mult = {b: math.exp(step[b] * SHIFT / 3 + rng.gauss(0, YEAR_NOISE)) for b in barangays}


def weight(rec):
    b = bgymap.get("" if rec.get("Brgy") is None else str(rec["Brgy"]))
    return mult.get(b, 1.0)


# ---------- dates ----------
DATE_RE = re.compile(r"([A-Za-z]+) (\d{1,2}), (\d{4})")


def shift_text(v):
    """Move every 'Month DD, YYYY' in a cell back SHIFT years, keeping the rest (e.g. a time)."""
    if not isinstance(v, str):
        return v

    def sub(m):
        d = parse_date(m.group(0))
        return fmt_date(_minus_years(d, SHIFT)) if d else m.group(0)
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

# ---------- build the records ----------
generated = {}
for kind in ("DSTB", "MN"):
    out = []
    for sex, k in plan[kind].items():
        pool = [r for r in templates[kind] if str(r["Sex"]).upper().startswith(sex)]
        for t in rng.choices(pool, weights=[weight(r) for r in pool], k=k):
            rec = {h: shift_text(v) for h, v in t.items()}
            age = valid_age(rec["Age"])
            if age >= 5:
                rec["Age"] = float(max(5, min(100, int(age) + rng.randint(-1, 1))))
            if FORWARD:  # recent records: validation status and outcomes as the real registry has them
                out.append(rec)
                continue
            if kind == "DSTB":
                rec["Validation Status"] = "Validated" if rng.random() < VALIDATED_SHARE else "Not validated"
            o = str(rec["Outcome/Status"]).strip().upper()
            if o == "ON TREATMENT":  # every patient of a past year has finished treatment by now
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
            if created and created > AS_OF:      # entered in the registry after the export
                dropped += 1
                continue
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
        as_of_report[kind] = {"not_yet_entered": dropped, "now_on_treatment": on_tx, "treatment_not_started": not_started}

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
if FORWARD:
    basis = [
        f"No official {YEAR} figure exists yet. Volume: the real 2025 registry's January-{dt.date(2000, CFG['through_month'], 1):%B}",
        f"  counts per sheet and sex, times {CFG['growth']:.2f} (an assumption; replace with the official figure when published).",
        "Method: each record copies one real 2025 Pasig registry record of the same sheet (DSTB/MN) and sex —",
        "  facility, barangay, age (±1 year from age 5), site, registration group, test results, validation status, outcome —",
        f"  with every date moved forward {-SHIFT} year. Barangay shares continue the 2022-2025 trend one more year.",
        f"As exported on {CFG['as_of']:%B %d, %Y}: records entered after that date are absent; an outcome not reached by then",
        "  stays ON TREATMENT (outcome date = treatment start, the registry's convention); treatment not started yet: DIAGNOSED.",
    ]
else:
    basis = [
        f"Calibrated to official figures: DOH Metro Manila CHD eFOI response on tuberculosis ({CFG['table']}; source LGU CHO/FHSIS report), Pasig City {YEAR}:",
        f"  notified TB cases {TOTAL:,} (male {MALE:,}, female {FEMALE:,}); treatment success rate {TARGET_TSR:.2%}.",
        "Method: each record copies one real 2025 Pasig registry record of the same sheet (DSTB/MN) and sex —",
        "  facility, barangay, age (±1 year from age 5), site, registration group, test results — with every date moved back",
        f"  {SHIFT} year(s). Barangay shares drift steadily between a 2022 level (random lognormal step, sigma {BARANGAY_SPREAD}) and the real 2025 shares.",
        "  Patients still ON TREATMENT in the template are given a final outcome from the real outcome mix, dated with real",
        f"  treatment durations; outcomes are then adjusted to the official {YEAR} treatment success rate.",
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
