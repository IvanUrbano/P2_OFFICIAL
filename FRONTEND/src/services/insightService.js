import {
  MOCK_ANALYTICS_INSIGHT,
  MOCK_FORECASTING_INSIGHT,
  MOCK_DASHBOARD_INSIGHT,
} from '../data/mockAiInsights';

function buildFilterDescription(filters) {
  const parts = [];

  if (filters.year) {
    parts.push(filters.year);
  }

  if (filters.month && filters.month !== '' && filters.month !== 'All') {
    const monthNames = [
      '', 'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December',
    ];
    parts.push(monthNames[Number(filters.month)] || filters.month);
  }

  if (filters.barangay && filters.barangay !== '' && filters.barangay !== 'All') {
    parts.push(filters.barangay);
  } else {
    parts.push('All Barangays');
  }

  if (filters.horizon) {
    parts.push(`${filters.horizon}-Month Forecast`);
  }

  return parts.join(' \u2022 ');
}

export async function getAnalyticsInsight(filters = {}) {
  // Simulate network delay
  await new Promise((resolve) => setTimeout(resolve, 800));

  return {
    ...MOCK_ANALYTICS_INSIGHT,
    meta: {
      ...MOCK_ANALYTICS_INSIGHT.meta,
      basedOn: buildFilterDescription(filters),
      generatedAt: new Date().toISOString(),
    },
  };
}

export async function getForecastingInsight(filters = {}) {
  await new Promise((resolve) => setTimeout(resolve, 800));

  return {
    ...MOCK_FORECASTING_INSIGHT,
    meta: {
      ...MOCK_FORECASTING_INSIGHT.meta,
      basedOn: buildFilterDescription(filters),
      generatedAt: new Date().toISOString(),
    },
  };
}

export async function getDashboardInsight() {
  await new Promise((resolve) => setTimeout(resolve, 800));

  return {
    ...MOCK_DASHBOARD_INSIGHT,
    meta: {
      ...MOCK_DASHBOARD_INSIGHT.meta,
      generatedAt: new Date().toISOString(),
    },
  };
}

export async function getWebhookLogs() {
  await new Promise((resolve) => setTimeout(resolve, 500));

  return {
    logs: [
      {
        id: 1,
        source: 'pasig-clone',
        batch_id: '550e8400-e29b-41d4-a716-446655440000',
        status: 'processed',
        records_received: 175,
        records_imported: 170,
        received_at: '2026-09-04T10:30:00Z',
      },
      {
        id: 2,
        source: 'pasig-clone',
        batch_id: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
        status: 'processed',
        records_received: 120,
        records_imported: 118,
        received_at: '2026-09-02T14:15:00Z',
      },
      {
        id: 3,
        source: 'pasig-clone',
        batch_id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
        status: 'failed',
        records_received: 95,
        records_imported: 0,
        received_at: '2026-08-28T09:45:00Z',
      },
    ],
  };
}
