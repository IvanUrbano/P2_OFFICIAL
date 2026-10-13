import { useState, useMemo } from 'react';
import renderFormattedText from '../utils/renderFormattedText.jsx';

/**
 * Dashboard welcome header + NLG overview panel.
 *
 * Freshness: three DISTINCT concepts, displayed separately and never merged
 * under an ambiguous "Last Updated" label:
 *   MONITORING PERIOD — latest reporting period represented by the TB case
 *     data (derived from date_of_diagnosis), e.g. "December 2025".
 *   LAST DATA SYNC   — most recent SUCCESSFUL transfer/import of TB data into
 *     TBInsight. Unchanged by opening or refreshing the Dashboard, by NLG
 *     generation, or by a pipeline run that brought no new data.
 *   LAST MODEL RUN   — latest normal analytics/model pipeline execution
 *     (run_type = 'pipeline'). Unchanged by merely viewing or refreshing.
 * This component previously received a single `lastUpdated` prop that was the
 * model-run timestamp labelled "LAST UPDATED", and which fell back to the
 * newest date_of_diagnosis — a clinical coverage date presented as a system
 * freshness timestamp. Relative labels are always derived from the stored
 * timestamp, never fixed strings.
 *
 * Insight text: the panel renders the Dashboard's own template-NLG output
 * (GET /api/tb/insights/dashboard). It previously read `insightData.summary`
 * from the Analytics insight response, which has no such field, so the
 * headline always fell back to placeholder copy. This is template-based NLG;
 * it is not an LLM and is not described as one.
 */
export default function DashboardWelcomeInsightsSection({
  user = null,
  lastSynced = null,
  lastSyncedRelative = '',
  lastModelRun = null,
  lastModelRunRelative = '',
  syncSource = null,
  dataSource = null,
  freshnessUnavailable = false,
  refreshing = false,
  onRefresh = () => { },
  insightData = null,
  insightLoading = false,
  insightError = null,
  onRetryInsight = () => { },
  monitoringPeriod = '',
  forecastSummary = null,
}) {
  const [activeSlide, setActiveSlide] = useState(0);

  // Absolute timestamp formatting — 'Not yet available' until a real stored
  // timestamp exists, never a hardcoded placeholder date.
  const formatStamp = (value) => {
    if (!value) return 'Not yet available';
    try {
      const dateStr = value.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
      const timeStr = value.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
      return `${dateStr} at ${timeStr}`;
    } catch {
      return 'Not yet available';
    }
  };

  const formattedLastSynced = useMemo(() => formatStamp(lastSynced), [lastSynced]);
  const formattedLastModelRun = useMemo(() => formatStamp(lastModelRun), [lastModelRun]);

  const monitoringPeriodLabel = monitoringPeriod || 'N/A';

  // Data Source describes the actual architecture. TBInsight receives records
  // from the Pasig TB Information System; it does not integrate directly with
  // DOH ITIS, and must not claim to.
  const dataSourceLabel = dataSource || 'PASIG TB-IS';
  const isAdmin = String(user?.role || '').toLowerCase() === 'admin';
  const assignedBarangay = user?.barangay?.name || user?.barangay_name || user?.facility?.barangay_name || null;
  const assignedFacility = user?.facility?.name || user?.facility_name || null;
  const accountScope = isAdmin
    ? 'Admin · City-wide'
    : assignedBarangay
      ? `Staff · Brgy. ${assignedBarangay}`
      : assignedFacility
        ? `Staff · ${assignedFacility}`
        : 'Staff · No area assigned';

  // Forecast outlook — reflects the real forecastSummary computed from the
  // persisted forecast rows, and names the method that actually produced it.
  // A Baseline Forecast is never described as ARIMA, and when no valid
  // forecast exists no predictive wording is produced at all.
  const forecastOutlookText = useMemo(() => {
    if (!forecastSummary?.period || forecastSummary?.tier === 'insufficient_data') {
      return forecastSummary?.tier === 'insufficient_data'
        ? 'Forecasting is unavailable for this scope: the available history falls below the minimum monthly observations required (Insufficient Historical Data).'
        : 'No forecast is available yet. Run the prediction pipeline to generate an outlook for the upcoming period.';
    }
    const rate = forecastSummary.growthRate;
    const direction = rate > 5 ? 'increase' : rate < -5 ? 'decrease' : 'remain relatively stable';
    const method = forecastSummary.tierLabel || 'current forecast';
    return `TB cases are projected to ${direction} in ${forecastSummary.period}, based on the ${method}. Continue monitoring case activity across high-risk barangays.`;
  }, [forecastSummary]);

  // Carousel slides come from the Dashboard NLG's own sections. Each slide
  // falls back only when that specific section is absent, so one unavailable
  // metric does not blank the rest.
  const slides = useMemo(() => {
    const sectionText = (id) => insightData?.sections?.find((sec) => sec.id === id)?.text || null;
    return [
    {
      id: 'caseActivity',
      title: 'Reported case trend',
      text: sectionText('caseActivity') || 'No case-trend interpretation is available for the current data.',
    },
    {
      id: 'riskSituation',
      title: 'Risk situation',
      text: sectionText('riskSituation') || 'No Random Forest risk classification is available yet.',
    },
    {
      id: 'mapInterpretation',
      title: 'Map interpretation',
      text: sectionText('mapInterpretation') || 'No map interpretation is available for the current risk assessment.',
    },
    {
      id: 'treatmentPerformance',
      title: 'Treatment performance',
      text: sectionText('treatmentPerformance') || 'Treatment indicators are unavailable for the current data.',
    },
    {
      id: 'forecastSignal',
      title: 'Forecast signal',
      text: sectionText('forecastSignal') || forecastOutlookText,
    },
    ];
  }, [insightData, forecastOutlookText]);

  const currentSlide = slides[activeSlide] || slides[0];

  const prevSlide = () => {
    setActiveSlide((prev) => (prev === 0 ? slides.length - 1 : prev - 1));
  };

  const nextSlide = () => {
    setActiveSlide((prev) => (prev === slides.length - 1 ? 0 : prev + 1));
  };

  return (
    <div className="grid grid-cols-1 gap-5 md:grid-cols-12">
      {/* Welcome and data context */}
      <section className="flex min-w-0 w-full flex-col overflow-hidden rounded-[10px] border border-[#0F2D52] bg-[#0F2D52] shadow-[0_2px_8px_rgba(15,23,42,0.08)] md:col-span-7 lg:col-span-8">
        <div className="flex flex-wrap items-start justify-between gap-3 bg-[#0F2D52] px-5 py-5 sm:px-6">
          <div className="min-w-0">
            <h2 className="break-words text-xl font-semibold tracking-tight text-white sm:text-2xl">
              Welcome back, {user?.username || 'User'}
            </h2>
            <p className="mt-1 text-xs text-[#CBD5E1] sm:text-[13px]">Pasig City tuberculosis monitoring overview</p>
            <p className="mt-2 text-xs text-[#E2E8F0]">
              <span className="text-[#CBD5E1]">Account scope:</span> <span className="font-semibold text-white">{accountScope}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            className="shrink-0 border border-white bg-white px-3 py-1.5 text-xs font-semibold text-[#0F2D52] hover:bg-[#F1F5F9] disabled:cursor-not-allowed disabled:opacity-60"
            title="Refresh dashboard data"
          >
            {refreshing ? 'Refreshing…' : 'Refresh data'}
          </button>
        </div>

        <div className="border-b border-white/15 px-5 py-5 sm:px-6">
          <h3 className="text-xs font-bold uppercase tracking-wide text-[#BFD3E6]">Latest overview</h3>
          <p className="mt-2 text-sm leading-relaxed text-white">
            {insightData?.summary
              ? renderFormattedText(insightData.summary)
              : insightLoading
                ? 'Loading the latest overview…'
                : insightError
                  ? 'The overview is unavailable. Dashboard metrics and charts are still available below.'
                  : 'Review the case activity, risk classifications, and forecasts below.'}
          </p>
        </div>

        <dl className="grid grid-cols-1 gap-x-5 gap-y-4 bg-[#12365F] px-5 py-4 sm:grid-cols-2 sm:px-6 xl:grid-cols-4">
          <div className="min-w-0">
            <dt className="text-[10px] font-semibold uppercase tracking-wide text-[#AFC6DC]">Data source</dt>
            <dd className="mt-1 text-xs font-semibold text-white">{dataSourceLabel}</dd>
          </div>
          <div className="min-w-0 xl:border-l xl:border-white/15 xl:pl-5">
            <dt className="text-[10px] font-semibold uppercase tracking-wide text-[#AFC6DC]">Monitoring period</dt>
            <dd className="mt-1 text-xs font-semibold text-white">{monitoringPeriodLabel}</dd>
          </div>
          <div className="min-w-0 xl:border-l xl:border-white/15 xl:pl-5">
            <dt className="text-[10px] font-semibold uppercase tracking-wide text-[#AFC6DC]">Last data sync</dt>
            <dd className="mt-1 text-xs font-semibold leading-snug text-white">{freshnessUnavailable ? 'Unavailable' : formattedLastSynced}</dd>
            {!freshnessUnavailable && lastSyncedRelative && (
              <dd className="mt-0.5 text-[10px] leading-snug text-[#BFD3E6]">
                {lastSyncedRelative}
                {syncSource === 'import' ? ' · file import' : ''}
                {syncSource === 'webhook' ? ' · webhook sync' : ''}
              </dd>
            )}
          </div>
          <div className="min-w-0 xl:border-l xl:border-white/15 xl:pl-5">
            <dt className="text-[10px] font-semibold uppercase tracking-wide text-[#AFC6DC]">Last model run</dt>
            <dd className="mt-1 text-xs font-semibold leading-snug text-white">{formattedLastModelRun}</dd>
            {lastModelRunRelative && <dd className="mt-0.5 text-[10px] text-[#BFD3E6]">{lastModelRunRelative}</dd>}
          </div>
        </dl>
      </section>

      {/* The welcome panel determines the desktop row height; insight text scrolls inside it. */}
      <div className="relative min-w-0 md:col-span-5 lg:col-span-4">
        <section className="flex h-[360px] min-w-0 flex-col overflow-hidden rounded-[10px] border border-[#E2E8F0] bg-white shadow-[0_2px_8px_rgba(15,23,42,0.04)] md:absolute md:inset-0 md:h-auto" aria-label="Overall TB insights">
          <div className="flex shrink-0 items-start justify-between gap-3 bg-[#0F2D52] px-5 py-3.5">
            <div className="flex min-w-0 items-start gap-2.5">
              <i className="ri-lightbulb-line mt-0.5 shrink-0 text-lg text-[#93C5FD]" aria-hidden="true" />
              <div className="min-w-0">
                <h3 className="text-sm font-bold text-white">Overall TB insights</h3>
                <p className="mt-0.5 text-xs text-[#CBD5E1]">Current data summary</p>
              </div>
            </div>
            <span className="shrink-0 rounded-full bg-white/10 px-2.5 py-1 text-xs font-semibold text-[#D9E9F8]" aria-label={`Insight ${activeSlide + 1} of ${slides.length}`}>
              {activeSlide + 1} of {slides.length}
            </span>
          </div>

        {/* Insight content */}
        {insightLoading ? (
          <div className="min-h-0 flex-1 px-5 py-5" role="status">
            <p className="text-xs text-[#64748B]">Loading insights…</p>
          </div>
        ) : insightError ? (
          <div className="min-h-0 flex-1 px-5 py-5" role="alert">
            <p className="text-xs font-semibold text-[#991B1B]">Insights are unavailable.</p>
            <p className="mt-1 text-xs text-[#64748B]">The dashboard metrics are still available.</p>
            <button
              onClick={onRetryInsight}
              type="button"
              className="mt-3 text-xs font-semibold text-[#0F2D52] hover:underline"
            >
              Retry
            </button>
          </div>
        ) : (
          <div key={activeSlide} className="min-h-0 flex-1 overflow-y-auto px-5 py-5" tabIndex={0} aria-label={`${currentSlide.title} insight`}>
            <h4 className="text-sm font-semibold text-[#0F2D52]">{currentSlide.title}</h4>
            <p className="mt-2 text-xs leading-relaxed text-[#334155]">{renderFormattedText(currentSlide.text)}</p>
          </div>
        )}

          <nav className="flex shrink-0 items-center justify-between border-t border-[#E2E8F0] bg-[#F8FAFC] px-5 py-3" aria-label="Insight navigation">
            <button type="button" onClick={prevSlide} aria-label="Previous insight" title="Previous insight" className="flex h-8 w-8 items-center justify-center text-[#0F2D52] hover:text-[#2E6FAF] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0F2D52]">
              <i className="ri-arrow-left-line text-base" aria-hidden="true" />
            </button>
            <button type="button" onClick={nextSlide} aria-label="Next insight" title="Next insight" className="flex h-8 w-8 items-center justify-center text-[#0F2D52] hover:text-[#2E6FAF] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0F2D52]">
              <i className="ri-arrow-right-line text-base" aria-hidden="true" />
            </button>
          </nav>
        </section>
      </div>
    </div>
  );
}
