// The Case ID users see: <FACILITY>-<D|M>-<YEAR>-<NNNNN> — always from the file or the
// Add TB Record form, never generated (backend services/caseIds.js). It identifies one TB
// case/episode. A record without one shows "No Case ID"; the internal case number (CS-...)
// is only ever shown as the "System Reference", never as a Case ID. Patient # is not shown.
export const NO_CASE_ID = 'No Case ID';
export const caseIdOf = (r) => (r ? (r.source_case_id || null) : null);
export const caseIdLabel = (r) => caseIdOf(r) || NO_CASE_ID;
export const systemRefOf = (r) => (r ? (r.case_no || null) : null);
