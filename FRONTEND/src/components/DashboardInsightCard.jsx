function DashboardInsightCard({
  data = null,
  loading = false,
  error = null,
  onGenerate,
  onRetry,
}) {
  // Loading state
  if (loading) {
    return (
      <div className="rounded-xl" style={{ background: '#ffffff', boxShadow: '0 4px 24px rgba(15,45,82,0.12), 0 2px 8px rgba(15,45,82,0.08)' }}>
        <div className="px-5 py-4 flex items-center gap-3">
          <div
            className="w-6 h-6 rounded-full animate-spin"
            style={{ border: '3px solid #E2E8F0', borderTopColor: '#0F2D52' }}
          />
          <div>
            <h3 className="text-sm font-semibold" style={{ color: '#0F2D52' }}>
              Generating TB Situation...
            </h3>
            <p className="text-xs mt-0.5" style={{ color: '#64748B' }}>
              Interpreting the latest calculated results
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="rounded-xl" style={{ background: '#ffffff', boxShadow: '0 4px 24px rgba(15,45,82,0.12), 0 2px 8px rgba(15,45,82,0.08)' }}>
        <div className="px-5 py-4 flex items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold" style={{ color: '#0F2D52' }}>
              {'\u2726'} Overall TB Situation
            </h3>
            <p className="text-xs mt-0.5" style={{ color: '#64748B' }}>
              Unable to generate the current interpretation.
            </p>
          </div>
          <button
            onClick={onRetry || onGenerate}
            className="px-3 py-2 text-xs font-semibold"
            style={{
              background: '#0F2D52',
              color: '#ffffff',
              border: '1px solid #0F2D52',
              borderRadius: 4,
              transition: 'background 0.15s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#174A7E';
              e.currentTarget.style.borderColor = '#174A7E';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = '#0F2D52';
              e.currentTarget.style.borderColor = '#0F2D52';
            }}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // Empty state
  if (!data) {
    return (
      <div className="rounded-xl" style={{ background: '#ffffff', boxShadow: '0 4px 24px rgba(15,45,82,0.12), 0 2px 8px rgba(15,45,82,0.08)' }}>
        <div className="px-5 py-4 flex items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold" style={{ color: '#0F2D52' }}>
              {'\u2726'} Overall TB Situation
            </h3>
            <p className="text-xs mt-0.5" style={{ color: '#64748B' }}>
              Generate a concise interpretation of the current TB situation.
            </p>
          </div>
          <button
            onClick={onGenerate}
            className="shrink-0 px-4 py-2 text-xs font-semibold"
            style={{
              background: '#0F2D52',
              color: '#ffffff',
              border: '1px solid #0F2D52',
              borderRadius: 4,
              transition: 'background 0.15s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#174A7E';
              e.currentTarget.style.borderColor = '#174A7E';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = '#0F2D52';
              e.currentTarget.style.borderColor = '#0F2D52';
            }}
          >
            Generate Insight
          </button>
        </div>
      </div>
    );
  }

  // Success state
  return (
    <div className="rounded-xl overflow-hidden" style={{ background: '#ffffff', boxShadow: '0 4px 24px rgba(15,45,82,0.12), 0 2px 8px rgba(15,45,82,0.08)' }}>
      {/* Header */}
      <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid #E2E8F0' }}>
        <div>
          <h3 className="text-sm font-bold" style={{ color: '#0F2D52' }}>
            {'\u2726'} OVERALL TB SITUATION
          </h3>
          <p className="text-xs mt-0.5" style={{ color: '#64748B' }}>
            {data.meta?.basedOn || 'Current TB results'}
          </p>
        </div>
        <button
          onClick={onGenerate}
          className="text-[11px] font-medium"
          style={{ color: '#0F2D52', transition: 'opacity 0.15s' }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.7'; }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
        >
          {'\u21bb'} Regenerate
        </button>
      </div>

      {/* Summary */}
      <div className="px-5 py-4">
        <p className="text-xs leading-relaxed" style={{ color: '#334155' }}>
          {data.summary}
        </p>

        {/* Metrics */}
        {data.metrics && data.metrics.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
            {data.metrics.map((metric) => (
              <div
                key={metric.label}
                className="rounded-lg p-3"
                style={{ background: '#F8FAFC', border: '1px solid #E2E8F0' }}
              >
                <p className="text-lg font-extrabold" style={{ color: '#0F2D52' }}>
                  {metric.value}
                </p>
                <p className="text-[10px] font-medium mt-0.5" style={{ color: '#64748B' }}>
                  {metric.label}
                </p>
              </div>
            ))}
          </div>
        )}

        {/* Footer */}
        <div className="mt-4 pt-3" style={{ borderTop: '1px solid #E2E8F0' }}>
          <p className="text-[10px]" style={{ color: '#64748B' }}>
            Generated from calculated TBInsight model results
          </p>
        </div>
      </div>
    </div>
  );
}

export default DashboardInsightCard;
