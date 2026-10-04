import { useState, useMemo } from 'react';
import renderFormattedText from '../utils/renderFormattedText.jsx';

function ChartLineIcon({ className = "w-4 h-4" }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="#2E6FAF"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 3v18h18" />
      <path d="M7 16l4-4 3 3 5-6" />
    </svg>
  );
}

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
      icon: <ChartLineIcon />,
      title: 'REPORTED CASE TREND',
      text: sectionText('caseActivity') || 'No case-trend interpretation is available for the current data.',
    },
    {
      id: 'riskSituation',
      icon: <ChartLineIcon />,
      title: 'RISK SITUATION',
      text: sectionText('riskSituation') || 'No Random Forest risk classification is available yet.',
    },
    {
      id: 'treatmentPerformance',
      icon: <ChartLineIcon />,
      title: 'TREATMENT PERFORMANCE',
      text: sectionText('treatmentPerformance') || 'Treatment indicators are unavailable for the current data.',
    },
    {
      id: 'forecastSignal',
      icon: <ChartLineIcon />,
      title: 'FORECAST SIGNAL',
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
    <div className="flex flex-col md:flex-row gap-5 items-stretch">
      {/* ─── 1. LEFT SIDE: WELCOME + DATA CONTEXT (65–70% on desktop, 55–60% on tablet) ─── */}
      <div
        className="w-full md:w-[58%] lg:w-[67%] rounded-2xl p-6 flex flex-col justify-between"
        style={{
          background: 'linear-gradient(135deg, #0F2D52 0%, #173E6D 100%)',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          boxShadow: '0 4px 24px rgba(15, 45, 82, 0.18), 0 2px 8px rgba(15, 45, 82, 0.1)',
        }}
      >
        {/* Main Greeting */}
        <div>
          <h2
            className="text-2xl sm:text-[26px] font-bold tracking-tight leading-tight"
            style={{ color: '#FFFFFF' }}
          >
            Welcome back, {user?.username || 'User'}
          </h2>
          <p className="text-xs sm:text-[13px] mt-1.5 font-normal" style={{ color: '#CBD5E1' }}>
            Here's your latest tuberculosis monitoring overview for Pasig City.
          </p>
        </div>

        {/* Today's Focus - Highlighted NLG Interpretation */}
        <div
          className="my-4 p-3.5 sm:p-4 rounded-xl"
          style={{
            background: 'rgba(255, 255, 255, 0.07)',
            border: '1px solid rgba(255, 255, 255, 0.14)',
            borderLeft: '3px solid #38BDF8',
          }}
        >
          <div className="flex items-center gap-1.5 mb-1.5">
            <span className="text-xs font-bold" style={{ color: '#38BDF8' }}>✦</span>
            <span
              className="text-[10px] font-extrabold uppercase tracking-wider"
              style={{ color: '#FFFFFF' }}
            >
              TODAY'S FOCUS
            </span>
          </div>

          <p className="text-xs sm:text-[13px] leading-relaxed" style={{ color: '#E2E8F0' }}>
            {insightData?.summary
              ? renderFormattedText(insightData.summary)
              : insightLoading
                ? 'Generating interpretation…'
                : insightError
                  ? 'The overview interpretation could not be generated. The metrics and charts below are unaffected.'
                  : 'Review TB case activity, risk classifications, and forecasts below for the latest monitoring update.'}
          </p>

          <div className="mt-2.5 flex items-center gap-1.5 text-[10px]" style={{ color: '#94A3B8' }}>
            <i className="ri-sparkling-line text-[11px]" style={{ color: '#38BDF8' }} />
            <span>
              {insightData?.summary
                ? 'NLG-generated insight from calculated TBInsight results'
                : insightError
                  ? 'NLG-generated insight unavailable'
                  : 'Awaiting NLG-generated insight'}
            </span>
          </div>
        </div>

        {/* Data Context Metadata Area */}
        <div
          className="pt-3 flex flex-col sm:flex-row sm:items-end justify-between gap-4"
          style={{ borderTop: '1px solid rgba(255, 255, 255, 0.12)' }}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 flex-1">
            {/* DATA SOURCE */}
            <div>
              <span
                className="text-[10px] font-bold uppercase tracking-wider block"
                style={{ color: '#94A3B8' }}
              >
                DATA SOURCE
              </span>
              <p className="text-xs sm:text-[13px] font-semibold mt-1" style={{ color: '#FFFFFF' }}>
                {dataSourceLabel}
              </p>
            </div>

            {/* MONITORING PERIOD — latest month actually covered by the data */}
            <div>
              <span
                className="text-[10px] font-bold uppercase tracking-wider block"
                style={{ color: '#94A3B8' }}
              >
                MONITORING PERIOD
              </span>
              <p className="text-xs sm:text-[13px] font-semibold mt-1" style={{ color: '#FFFFFF' }}>
                {monitoringPeriodLabel}
              </p>
            </div>

            {/* LAST DATA SYNC — most recent SUCCESSFUL transfer/import of TB
                data into TBInsight. Never the model-run timestamp, and never
                changed by opening or refreshing the Dashboard. */}
            <div>
              <span
                className="text-[10px] font-bold uppercase tracking-wider block"
                style={{ color: '#94A3B8' }}
              >
                LAST DATA SYNC
              </span>
              <p className="text-xs sm:text-[13px] font-semibold mt-1" style={{ color: '#FFFFFF' }}>
                {freshnessUnavailable ? 'Unavailable' : formattedLastSynced}
              </p>
              {!freshnessUnavailable && lastSyncedRelative && (
                <span className="text-[11px] font-medium block" style={{ color: '#94A3B8' }}>
                  {lastSyncedRelative}
                  {/* State the provenance when the value is NOT a successful
                      webhook sync, so an import timestamp is never read as a
                      confirmed transfer from PASIG TB-IS. */}
                  {syncSource === 'import' ? ' · from file import (no webhook sync logged)' : ''}
                  {syncSource === 'webhook' ? ' · webhook sync' : ''}
                </span>
              )}
            </div>

            {/* LAST MODEL RUN — latest analytics/model pipeline execution */}
            <div>
              <span
                className="text-[10px] font-bold uppercase tracking-wider block"
                style={{ color: '#94A3B8' }}
              >
                LAST MODEL RUN
              </span>
              <p className="text-xs sm:text-[13px] font-semibold mt-1" style={{ color: '#FFFFFF' }}>
                {formattedLastModelRun}
              </p>
              {lastModelRunRelative && (
                <span className="text-[11px] font-medium block" style={{ color: '#94A3B8' }}>
                  {lastModelRunRelative}
                </span>
              )}
            </div>
          </div>

          {/* Refresh Action */}
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition shrink-0 self-start sm:self-end disabled:opacity-60 disabled:cursor-not-allowed"
            style={{
              background: 'rgba(255, 255, 255, 0.08)',
              color: '#FFFFFF',
              border: '1px solid rgba(255, 255, 255, 0.22)',
              cursor: refreshing ? 'not-allowed' : 'pointer',
            }}
            onMouseEnter={(e) => {
              if (!refreshing) e.currentTarget.style.background = 'rgba(255, 255, 255, 0.16)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
            }}
            title="Refresh dashboard data"
          >
            <i className={`ri-refresh-line text-sm ${refreshing ? 'animate-spin' : ''}`} />
            {refreshing ? 'Refreshing...' : 'Refresh Data'}
          </button>
        </div>
      </div>

      {/* ─── 2. RIGHT SIDE: OVERALL TB INSIGHTS (30–35% on desktop, 40–45% on tablet) ─── */}
      <div
        className="w-full md:w-[42%] lg:w-[33%] bg-white rounded-2xl p-5 sm:p-6 flex flex-col justify-between"
        style={{
          border: '1px solid #E2E8F0',
          boxShadow: '0 4px 20px rgba(15, 45, 82, 0.06), 0 1px 3px rgba(15, 45, 82, 0.03)',
        }}
      >
        {/* Header */}
        <div
          className="flex items-start justify-between gap-2 pb-3"
          style={{ borderBottom: '1px solid #F1F5F9' }}
        >
          <div>
            <h3
              className="text-xs font-extrabold uppercase tracking-wider flex items-center gap-1.5"
              style={{ color: '#0F2D52' }}
            >
              <span style={{ color: '#2E6FAF' }}>✦</span> OVERALL TB INSIGHTS
            </h3>
            <p className="text-[11px] mt-0.5 leading-tight" style={{ color: '#64748B' }}>
              Template-based NLG summary of calculated TBInsight results
            </p>
          </div>
          <span
            className="text-[11px] font-bold px-2 py-0.5 rounded-full shrink-0"
            style={{ background: '#F1F5F9', color: '#64748B' }}
          >
            {activeSlide + 1} / {slides.length}
          </span>
        </div>

        {/* Dynamic Body: Loading, Error, or Carousel Slide */}
        {insightLoading ? (
          <div className="flex-1 flex flex-col items-center justify-center py-6 text-center">
            <div
              className="w-6 h-6 rounded-full animate-spin mb-2"
              style={{ border: '2.5px solid #E2E8F0', borderTopColor: '#0F2D52' }}
            />
            <p className="text-xs font-bold" style={{ color: '#0F2D52' }}>
              Generating interpretation...
            </p>
            <p className="text-[11px] mt-0.5" style={{ color: '#64748B' }}>
              Interpreting the latest model results
            </p>
          </div>
        ) : insightError ? (
          <div className="flex-1 flex flex-col items-center justify-center py-6 text-center">
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center mb-2"
              style={{ background: '#FEF2F2', color: '#EF4444' }}
            >
              <i className="ri-error-warning-line text-base" />
            </div>
            <p className="text-xs font-bold" style={{ color: '#991B1B' }}>
              ⚠ Unable to generate interpretation
            </p>
            <p className="text-[11px] mt-0.5" style={{ color: '#64748B' }}>
              The dashboard results are still available.
            </p>
            <button
              onClick={onRetryInsight}
              type="button"
              className="mt-3 px-3 py-1.5 text-xs font-semibold rounded text-white transition"
              style={{ background: '#0F2D52' }}
              onMouseEnter={(e) => { e.currentTarget.style.background = '#174A7E'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = '#0F2D52'; }}
            >
              Retry
            </button>
          </div>
        ) : (
          <div className="py-4 flex-1 flex flex-col justify-center min-h-[105px]">
            <div
              key={activeSlide}
              className="transition-all duration-300 ease-in-out"
              style={{ opacity: 1 }}
            >
              <div className="flex items-center gap-2 mb-1.5">
                <span className="flex items-center justify-center shrink-0 w-5 h-5 leading-none">{currentSlide.icon}</span>
                <h4
                  className="text-xs font-bold uppercase tracking-wider"
                  style={{ color: '#0F2D52' }}
                >
                  {currentSlide.title}
                </h4>
              </div>
              <p className="text-xs leading-relaxed" style={{ color: '#334155' }}>
                {renderFormattedText(currentSlide.text)}
              </p>
            </div>
          </div>
        )}

        {/* Carousel Navigation */}
        <div className="flex items-center justify-between pt-2 pb-3">
          <button
            onClick={prevSlide}
            type="button"
            aria-label="Previous insight"
            className="w-7 h-7 rounded-full flex items-center justify-center transition active:scale-95"
            style={{ border: '1px solid #E2E8F0', color: '#0F2D52', background: '#ffffff' }}
            onMouseEnter={(e) => { e.currentTarget.style.background = '#F8FAFC'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = '#ffffff'; }}
          >
            <i className="ri-arrow-left-s-line text-sm" />
          </button>

          <div className="flex items-center gap-1.5">
            {slides.map((_, idx) => (
              <button
                key={idx}
                onClick={() => setActiveSlide(idx)}
                type="button"
                aria-label={`Go to slide ${idx + 1}`}
                className={`h-2 rounded-full transition-all duration-200 ${activeSlide === idx ? 'w-4' : 'w-2'
                  }`}
                style={{
                  background: activeSlide === idx ? '#0F2D52' : '#CBD5E1',
                }}
              />
            ))}
          </div>

          <button
            onClick={nextSlide}
            type="button"
            aria-label="Next insight"
            className="w-7 h-7 rounded-full flex items-center justify-center transition active:scale-95"
            style={{ border: '1px solid #E2E8F0', color: '#0F2D52', background: '#ffffff' }}
            onMouseEnter={(e) => { e.currentTarget.style.background = '#F8FAFC'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = '#ffffff'; }}
          >
            <i className="ri-arrow-right-s-line text-sm" />
          </button>
        </div>

        {/* Footer */}
        <div
          className="pt-2 flex flex-col gap-0.5 text-[10px]"
          style={{ borderTop: '1px solid #F1F5F9', color: '#94A3B8' }}
        >
          <span>Based on: {monitoringPeriodLabel} • Pasig City</span>
          <span>NLG-generated from calculated TBInsight results</span>
        </div>
      </div>
    </div>
  );
}
