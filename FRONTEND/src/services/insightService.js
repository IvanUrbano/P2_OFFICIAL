import API from '../api/axios';

export async function getAnalyticsInsight(filters = {}) {
  const params = {};
  if (filters.year) params.year = filters.year;
  if (filters.month) params.month = filters.month;
  if (filters.barangay) params.barangay = filters.barangay;
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

export async function getDashboardInsight() {
  const res = await API.get('/api/tb/insights/analytics');
  return res.data;
}

export async function getWebhookLogs() {
  const res = await API.get('/api/tb/webhook-logs');
  return res.data;
}
