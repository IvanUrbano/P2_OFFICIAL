"""
Add Case ID, patient name and date of birth columns to the real 2025 registry.
Every original cell is kept exactly; only six columns are inserted after "#"/"No.".
Usage: python enrich2025.py <input.xlsx> <output.xlsx> <fac_resolved.json> <registry.json>
"""
import copy
import json
import sys

import openpyxl

sys.path.insert(0, __import__("os").path.dirname(__file__))
from tbgen import IdentityRegistry, assign_case_ids, facility_code, fmt_date, load_counters, parse_date, save_counters

SRC, OUT, FAC, REG = sys.argv[1:5]
NEW_COLS = ["Case ID", "Last Name", "First Name", "Middle Name", "Suffix", "Date of Birth"]
HEADER_ROW = {"DSTB": 6, "MN": 1}

resolved = json.load(open(FAC, encoding="utf-8"))
reg = IdentityRegistry(REG, seed=2025)
COUNTERS = REG.replace("registry.json", "caseid_counters.json")
counters = load_counters(COUNTERS)
wb = openpyxl.load_workbook(SRC)
report = {}

for kind, hrow in HEADER_ROW.items():
    ws = wb[kind]
    headers = [str(c.value or "").strip() for c in ws[hrow]]
    col = {h: i + 1 for i, h in enumerate(headers)}
    dx_c = col["Date of Diagnosis"]
    fallbacks = [col[h] for h in ("Date of Notification", "Date of Screening") if h in col]
    rows, fallback_rows = [], 0
    for r in range(hrow + 1, ws.max_row + 1):
        if all(ws.cell(r, c).value in (None, "") for c in range(1, len(headers) + 1)):
            continue
        dx = parse_date(ws.cell(r, dx_c).value)
        if dx is None:
            dx = next((d for d in (parse_date(ws.cell(r, c).value) for c in fallbacks) if d), None)
            fallback_rows += 1
        code = facility_code(ws.cell(r, col["Treatment Health Facility"]).value,
                             ws.cell(r, col["Screening/Diagnosing Health Facility"]).value, resolved)
        rows.append({"idx": r, "code": code, "dx": dx,
                     "sex": ws.cell(r, col["Sex"]).value, "age": ws.cell(r, col["Age"]).value})
    case_ids = assign_case_ids(rows, kind, counters)

    # Insert the new columns after column A ("#" / "No.") and style their headers like the rest.
    ws.insert_cols(2, len(NEW_COLS))
    style_src = ws.cell(hrow, 1 + len(NEW_COLS) + 1)
    for i, name in enumerate(NEW_COLS):
        cell = ws.cell(hrow, 2 + i, name)
        cell.font, cell.fill, cell.border, cell.alignment = (copy.copy(style_src.font), copy.copy(style_src.fill),
                                                             copy.copy(style_src.border), copy.copy(style_src.alignment))
        ws.column_dimensions[openpyxl.utils.get_column_letter(2 + i)].width = [18, 16, 18, 16, 7, 18][i]

    for row in rows:
        p = reg.new(row["sex"], row["age"], row["dx"])
        values = [case_ids[row["idx"]], p["last"].upper(), p["first"].upper(), p["middle"].upper(),
                  p["suffix"].upper(), fmt_date(p["dob"]) if p["dob"] else ""]
        for i, v in enumerate(values):
            ws.cell(row["idx"], 2 + i, v if v != "" else None)

    codes = {}
    for row in rows:
        codes[row["code"]] = codes.get(row["code"], 0) + 1
    report[kind] = {"rows": len(rows), "dx_fallback_rows": fallback_rows,
                    "facility_codes": len(codes), "UNK": codes.get("UNK", 0)}

notes = wb.create_sheet("README")
for line in [
    "2025 PASIG TB REGISTRY — REAL RECORDS WITH ADDED IDENTIFIERS",
    "",
    "Every original column and value is the real Pasig City Health Department 2025 registry, unchanged.",
    "Added columns (fictional, generated for system testing): Case ID, Last Name, First Name, Middle Name, Suffix, Date of Birth.",
    "  Case ID: <facility code>-<D|M>-<year of diagnosis>-<running number per facility, type and year>; facility code of the",
    "  treatment facility, else the screening facility (TBInsight health facility registry).",
    "  Date of birth matches the recorded age at diagnosis (infants: their age in months).",
    "Rows left as found for correction: DSTB row with diagnosis date typed 'July 28, 0205' (Case ID year from the",
    "  notification date); MN row with age 1087 (no date of birth given).",
]:
    notes.append([line])
notes.column_dimensions["A"].width = 120

wb.save(OUT)
reg.save()
save_counters(COUNTERS, counters)
print(json.dumps(report))
