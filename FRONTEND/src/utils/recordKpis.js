// KPI figures for the TB Records page, from GET /api/tb/dashboard/summary and the cohort-based
// GET /api/tb/treatment-success-rate.
//
// Every rate here uses the right base, and says which:
//   Case Fatality Rate   deaths / evaluated terminal outcomes
//   Lost to Follow-up    lost to follow-up / evaluated terminal outcomes
//   Treatment Success    the cohort figure from the API (patients whose treatment started in Y-1)
// "Evaluated terminal outcomes" = Cured + Treatment Completed + Failed + Lost to Follow-up + Died,
// the same definition as the Dashboard and the shared case-fatality calculation. Records still on
// treatment or only diagnosed are not part of the base — dividing by every record (as the cards used
// to) understates each rate. A rate with an empty base is null, never 0%.

const rate = (part, whole) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);

export function buildRecordKpis(summary, tsr) {
  const s = summary || {};
  const total = s.total_cases || 0;
  const evaluated = s.total_outcomes || 0;
  const died = s.died_count || 0;
  const ltfu = s.ltfu_count || 0;
  return {
    total,
    onTreatment: s.on_treatment_count || 0,
    onTreatmentShare: rate(s.on_treatment_count || 0, total),
    diagnosed: s.diagnosed_count || 0,
    diagnosedOverdue: s.diagnosed_overdue_count || 0,
    evaluated,
    died,
    ltfu,
    fatalityRate: rate(died, evaluated),
    ltfuRate: rate(ltfu, evaluated),
    successRate: tsr?.successRate ?? null,
    cohortYear: tsr?.cohortYear ?? null,
    cohortTotal: tsr?.cohortTotal ?? 0,
  };
}
