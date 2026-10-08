// Dropdown vocabularies shared by Add TB Record and Edit case details, so both offer the
// same values. The server's /api/data/manual-options (values already in the records) wins
// when it has any; these are the fallbacks.
export const CASE_STATUS_OPTIONS = ['DIAGNOSED', 'ON TREATMENT'];
export const OUTCOME_OPTIONS = ['CURED', 'TREATMENT COMPLETED', 'TREATMENT FAILED', 'LOST TO FOLLOW-UP', 'DIED', 'NOT EVALUATED', 'EXCLUDED'];

export const STATIC_OPTIONS = {
  registration_group: ['NEW', 'OTHER', 'PREVIOUS TX OUTCOME UNKNOWN', 'RELAPSE', 'TX AFTER FAILURE', 'TX AFTER LOST TO FF-UP'],
  source_of_patient: ['COMMUNITY', 'OTHER PUBLIC FACILITY', 'PRIVATE FACILITY', 'PUBLIC HEALTH CENTER'],
  anatomical_site: ['P', 'EP'],
  bacteriological_status: ['SMEAR POSITIVE', 'SMEAR NEGATIVE', 'XPERT MTB/RIF DETECTED', 'XPERT MTB/RIF NOT DETECTED'],
};

export const optionsFor = (options, key) => (options?.[key]?.length ? options[key] : STATIC_OPTIONS[key]);

// Same shape the server accepts (services/caseIds.js): ROS-D-2025-00042
export const CASE_ID_RE = /^[A-Z0-9]{2,6}-[DM]-\d{4}-\d{5}$/;
export const normalizeCaseId = (v) => String(v ?? '').replace(/\s+/g, '').toUpperCase();
export const CASE_ID_HINT = 'Format: FACILITY-D|M-YEAR-NNNNN, e.g. ROS-D-2025-00042';
