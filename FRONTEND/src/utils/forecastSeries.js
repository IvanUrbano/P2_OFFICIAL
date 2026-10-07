/** Calendar month for Pasig API DATE values, independent of browser timezone. */
export function forecastMonthKey(value) {
  if (!value) return null;
  const dateOnly = typeof value === 'string' && value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) return `${dateOnly[1]}-${dateOnly[2]}`;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const pasigDate = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  return `${pasigDate.getUTCFullYear()}-${String(pasigDate.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function aggregateForecastHistory(rows) {
  const byMonth = new Map();
  for (const row of rows) {
    const month = forecastMonthKey(row.month);
    if (!month) continue;
    byMonth.set(month, (byMonth.get(month) || 0) + Number(row.case_count || 0));
  }
  return [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, cases]) => {
    const [year, monthNumber] = month.split('-').map(Number);
    return {
      month,
      label: new Date(year, monthNumber - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
      cases,
    };
  });
}

export function calculateForecastGrowth(actualMonthly, forecasts) {
  const firstForecast = forecasts.find(row => row.hasForecast);
  if (!firstForecast) return { rate: null, reason: 'No persisted forecast for this selection' };
  const priorActual = actualMonthly.filter(row => row.month < firstForecast.period);
  if (!priorActual.length) return { rate: null, reason: 'No historical data before forecast start in the selected range' };
  const monthNumber = key => Number(key.slice(0, 4)) * 12 + Number(key.slice(5, 7)) - 1;
  const monthCount = monthNumber(priorActual[priorActual.length - 1].month) - monthNumber(priorActual[0].month) + 1;
  const baseline = priorActual.reduce((sum, row) => sum + row.cases, 0) / monthCount;
  if (!(baseline > 0)) return { rate: null, reason: 'Historical monthly baseline is zero' };
  return { rate: ((firstForecast.forecasted - baseline) / baseline) * 100, baseline };
}
