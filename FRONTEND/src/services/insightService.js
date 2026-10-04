import API from '../api/axios';

export async function getAnalyticsInsight(filters = {}) {
  const params = {};
  if (filters.year) params.year = filters.year;
  if (filters.month) params.month = filters.month;
  if (filters.barangay) params.barangay = filters.barangay;
  if (filters.facility) params.facility = filters.facility;
  if (filters.outcome) params.outcome = filters.outcome;
  if (filters.sex) params.sex = filters.sex;
  if (filters.ageGroup) params.ageGroup = filters.ageGroup;
  if (filters.bacteriological) params.bacteriological = filters.bacteriological;

  const res = await API.get('/api/tb/insights/analytics', { params });
  return res.data;
}

export async function getForecastingInsight(filters = {}) {
  const params = {};
  if (filters.startYear) params.startYear = filters.startYear;
  if (filters.endYear) params.endYear = filters.endYear;
  if (filters.barangay) params.barangay = filters.barangay;
  if (filters.horizon) params.horizon = filters.horizon;

  const res = await API.get('/api/tb/insights/forecasting', { params });
  return res.data;
}

// Dashboard NLG — its OWN concise endpoint, not the Analytics one.
// This previously called /api/tb/insights/analytics, which (a) made the
// Dashboard render the seven-section Analytics narrative it has no room for,
// and (b) returns no top-level `summary` field, so the Dashboard's headline
// panel silently fell back to placeholder text on every single load even
// though valid NLG output existed. /insights/dashboard returns
// { type, summary, sections, meta }.
export async function getDashboardInsight() {
  const res = await API.get('/api/tb/insights/dashboard');
  return res.data;
}

// Freshness metadata: Last Synced (transfer from PASIG TB-IS) and Last Model
// Run (pipeline execution) are separate concepts and are fetched separately
// from the data endpoints so that an NLG or model failure cannot blank them.
export async function getDataFreshness() {
  const res = await API.get('/api/tb/data-freshness');
  return res.data;
}

export async function getGisInsight(filters = {}) {
  const params = {};
  if (filters.barangay) params.barangay = filters.barangay;
  const res = await API.get('/api/tb/insights/gis', { params });
  return res.data;
}

export async function getWebhookLogs() {
  const res = await API.get('/api/tb/webhook-logs');
  return res.data;
}
