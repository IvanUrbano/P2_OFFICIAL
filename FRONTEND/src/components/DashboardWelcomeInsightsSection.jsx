import { useState, useMemo } from 'react';

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

export default function DashboardWelcomeInsightsSection({
  user = null,
  lastUpdated = null,
  lastUpdatedRelative = '',
  refreshing = false,
  onRefresh = () => { },
  insightData = null,
  insightLoading = false,
  insightError = null,
  onRetryInsight = () => { },
}) {
  const [activeSlide, setActiveSlide] = useState(0);

  // Format last updated timestamp with fallback to prompt's default
  const formattedLastUpdated = useMemo(() => {
    if (!lastUpdated) return 'September 3, 2026 at 4:05 AM';
    try {
      const dateStr = lastUpdated.toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      });
      const timeStr = lastUpdated.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });
      return `${dateStr} at ${timeStr}`;
    } catch {
      return 'September 3, 2026 at 4:05 AM';
    }
  }, [lastUpdated]);

  const displayRelative = lastUpdatedRelative || '5 days ago';

  // Define 3 insight slides
  const slides = useMemo(() => [
    {
      id: 'analytics',
      icon: <ChartLineIcon />,
      title: 'ANALYTICS SUMMARY',
      text:
        insightData?.sections?.find((s) => s.id === 'overallSummary' || s.id === 'keyTrend')?.text ||
        'TB activity is increasing during the current monitoring period, with several barangays showing elevated risk.',
    },
    {
      id: 'forecast',
      icon: <ChartLineIcon />,
      title: 'FORECAST OUTLOOK',
      text:
        'TB cases are projected to increase over the next three months, indicating the need for continued monitoring of future case activity.',
    },
    {
      id: 'overall',
      icon: <span className="text-sm font-bold leading-none" style={{ color: '#2E6FAF' }}>✦</span>,
      title: 'OVERALL TB SITUATION',
      text:
        insightData?.summary ||
        'TB activity is increasing, with several barangays requiring closer monitoring. Forecasted cases are also expected to rise, while treatment performance remains an important area for continued attention.',
    },
  ], [insightData]);

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
            Recent TB activity indicates an increasing trend, highlighting the need to monitor areas with elevated risk and review projected case activity for the coming months.
          </p>

          <div className="mt-2.5 flex items-center gap-1.5 text-[10px]" style={{ color: '#94A3B8' }}>
            <i className="ri-sparkling-line text-[11px]" style={{ color: '#38BDF8' }} />
            <span>Generated from current TB monitoring results</span>
          </div>
        </div>

        {/* Data Context Metadata Area */}
        <div
          className="pt-3 flex flex-col sm:flex-row sm:items-end justify-between gap-4"
          style={{ borderTop: '1px solid rgba(255, 255, 255, 0.12)' }}
        >
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6 flex-1">
            {/* DATA SOURCE */}
            <div>
              <span
                className="text-[10px] font-bold uppercase tracking-wider block"
                style={{ color: '#94A3B8' }}
              >
                DATA SOURCE
              </span>
              <p className="text-xs sm:text-[13px] font-semibold mt-1" style={{ color: '#FFFFFF' }}>
                Centralized TB Records
              </p>
            </div>

            {/* MONITORING PERIOD */}
            <div>
              <span
                className="text-[10px] font-bold uppercase tracking-wider block"
                style={{ color: '#94A3B8' }}
              >
                MONITORING PERIOD
              </span>
              <p className="text-xs sm:text-[13px] font-semibold mt-1" style={{ color: '#FFFFFF' }}>
                August 2026
              </p>
            </div>

            {/* LAST UPDATED */}
            <div>
              <span
                className="text-[10px] font-bold uppercase tracking-wider block"
                style={{ color: '#94A3B8' }}
              >
                LAST UPDATED
              </span>
              <p className="text-xs sm:text-[13px] font-semibold mt-1" style={{ color: '#FFFFFF' }}>
                September 3, 2026 at 4:05 AM
              </p>
              <span className="text-[11px] font-medium" style={{ color: '#94A3B8' }}>
                5 days ago
              </span>
            </div>
          </div>

          {/* Refresh Action (Visual only) */}
          <button
            type="button"
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition shrink-0 self-start sm:self-end"
            style={{
              background: 'rgba(255, 255, 255, 0.08)',
              color: '#FFFFFF',
              border: '1px solid rgba(255, 255, 255, 0.22)',
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.16)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
            }}
            title="Refresh dashboard data"
          >
            <i className="ri-refresh-line text-sm" />
            Refresh Data
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
              Automated interpretation of Analytics and Forecasting results
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
                {currentSlide.text}
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
          <span>Based on: August 2026 • Pasig City</span>
          <span>Generated from calculated TBInsight model results</span>
        </div>
      </div>
    </div>
  );
}
