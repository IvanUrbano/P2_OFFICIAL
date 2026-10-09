# TB registry data generation

Builds the Pasig TB registry files (`2022`–`2025_Pasig_TB_Records.xlsx`) that are imported
into Pasig Clone. They have the same sheets and columns as the City Health Department's own
registry (DSTB and MN sheets), plus Case ID, name and date-of-birth columns.

| Year | What it is |
|---|---|
| 2025 | **Real** Pasig City Health Department registry. Every original value unchanged; Case ID, names and date of birth added (fictional). |
| 2022–2024 | **Simulated.** Calibrated to the official DOH Metro Manila CHD eFOI figures (source: LGU CHO/FHSIS report): notified cases by sex and treatment success rate. Every other detail is copied from real 2025 records. |

Official targets used (Pasig City rows of the eFOI tables):

| Year | Notified | Male | Female | Treatment success | City population |
|---|---|---|---|---|---|
| 2022 | 6,016 | 3,641 | 2,375 | 84.18% | 828,114 |
| 2023 | 6,538 | 3,891 | 2,647 | 88.80% | 825,380 |
| 2024 | 5,274 | 3,140 | 2,134 | 88.45% | 833,749 |

The matching barangay populations are in `BACKEND/db/migrations/034_population_2022.sql` and
`035_population_2023_efoi.sql`; 2025 comes from `BACKEND/data/pasig-barangays.geojson`.

## How the simulated years are built

- **Sizes:** the eFOI total split into DSTB and MN in the real 2025 proportion; male and female
  counts match the eFOI exactly.
- **Records:** each one copies a real 2025 record of the same sheet and sex (facility, barangay,
  age ±1 year from age 5, site, registration group, test results). All its dates move back to
  the target year, keeping the gaps between them.
- **Barangays:** each barangay's share drifts steadily from a 2022 level (a random step,
  lognormal sigma 0.15) to its real 2025 share, so the years form a trend.
- **Outcomes:** nobody from a past year is still on treatment. Those records get a final outcome
  from the real outcome mix, dated with real treatment durations. Outcomes are then adjusted to
  the year's official treatment success rate.
- **Rows to fix:** each year has a few deliberate data issues for the Validation page:
  misspelled barangays, missing sex, missing age and birth date, missing diagnosis date, birth
  date after diagnosis, and short Case IDs. Each file's README sheet lists them. Blank barangays
  (Needs Assignment) occur at the real rate.

## Identifiers (all years)

- **Case ID:** `<facility code>-<D|M>-<year of diagnosis>-<NNNNN>`, the system's format
  (`PASIG_CLONE/backend/services/caseIds.js`). The code is the treatment facility's, else the
  screening facility's. Numbers run per facility, type and year, continuing across files.
- **Names:** fictional, Filipino naming conventions (middle name is a surname, some Jr./III/Sr.).
  Every full name and every name + birth date is unique across all files, so none is flagged as
  a possible same patient.
- **Date of birth:** matches the recorded age at diagnosis exactly (infants: their age in
  months). Left blank only where the recorded age is impossible.

Everything is seeded: the same inputs always give the same files.

## Run

Needs Python 3 with `openpyxl` (`pip install openpyxl`), Node, and both `.env` files (the
lookups step reads the databases; nothing is written to them). From the repository root:

```bash
REAL="C:/path/to/2025 CASES_JRU.xlsx"   # the real registry (not in the repository)
OUT="C:/path/to/output"
G=tools/data-generation

# 1. Lookups (optional: snapshots are committed in lookups/)
node $G/prepare_lookups.js "$REAL"

# 2. Build in this order, from a clean state. Names and Case ID numbers are shared across
#    years, so always rebuild every file together.
rm -f $G/registry.json $G/caseid_counters.json
python $G/enrich2025.py "$REAL" "$OUT/2025_Pasig_TB_Records.xlsx" $G/lookups/fac_resolved.json $G/registry.json
for y in 2022 2023 2024; do
  python $G/genyear.py "$OUT/2025_Pasig_TB_Records.xlsx" "$OUT/${y}_Pasig_TB_Records.xlsx" \
    $G/lookups/fac_resolved.json $G/registry.json $G/lookups/bgymap.json $y
done
```

`registry.json` and `caseid_counters.json` are working files (the names and Case ID numbers
already used); they are not committed.

Import order in Pasig Clone: 2022, 2023, 2024, 2025, syncing each one.
