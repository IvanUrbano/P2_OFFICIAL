import renderFormattedText from '../utils/renderFormattedText.jsx';

function AiInsightPanel({
  type = 'analytics',
  data = null,
  loading = false,
  error = null,
  onRetry,
  onGenerate,
}) {
  const title =
    type === 'forecasting'
      ? 'NLG-GENERATED FORECASTING INSIGHT'
      : type === 'gis'
        ? 'NLG-GENERATED GIS INSIGHT'
        : 'NLG-GENERATED ANALYTICS INSIGHT';

  // Loading state
  if (loading) {
    return (
      <div className="rounded-xl overflow-hidden" style={{ background: '#ffffff', border: '1px solid #E2E8F0' }}>
        <div className="px-5 py-4" style={{ background: '#0F2D52' }}>
          <h3 className="text-sm font-semibold" style={{ color: '#ffffff' }}>
            {title}
          </h3>
        </div>
        <div className="flex flex-col items-center justify-center py-12">
          <div
            className="w-8 h-8 rounded-full animate-spin mb-4"
            style={{ border: '4px solid #E2E8F0', borderTopColor: '#0F2D52' }}
          />
          <p className="text-sm font-medium" style={{ color: '#0F2D52' }}>
            Generating interpretation...
          </p>
          <p className="text-xs mt-1" style={{ color: '#64748B' }}>
            Interpreting the current model results
          </p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="rounded-xl overflow-hidden" style={{ background: '#ffffff', border: '1px solid #E2E8F0' }}>
        <div className="px-5 py-4" style={{ background: '#0F2D52' }}>
          <h3 className="text-sm font-semibold" style={{ color: '#ffffff' }}>
            {title}
          </h3>
        </div>
        <div className="px-5 py-8 text-center">
          <p className="text-sm font-medium" style={{ color: '#0F2D52' }}>
            Unable to generate the interpretation.
          </p>
          <p className="text-xs mt-1 mb-4" style={{ color: '#64748B' }}>
            Your {type} results are still available below.
          </p>
          {onRetry && (
            <button
              onClick={onRetry}
              className="px-4 py-2 text-xs font-semibold"
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
          )}
        </div>
      </div>
    );
  }

  // Empty state — show prompt to generate
  if (!data) {
    return (
      <div className="rounded-xl overflow-hidden" style={{ background: '#ffffff', border: '1px solid #E2E8F0' }}>
        <div className="px-5 py-4" style={{ background: '#0F2D52' }}>
          <h3 className="text-sm font-semibold" style={{ color: '#ffffff' }}>
            {title}
          </h3>
        </div>
        <div className="px-5 py-6 flex flex-col items-center text-center gap-4">
          <p className="text-sm font-medium" style={{ color: '#0F2D52' }}>
            Generate an interpretation based on the current {type} results.
          </p>
          {onGenerate && (
            <button
              onClick={onGenerate}
              className="px-4 py-2 text-xs font-semibold"
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
          )}
          <p className="text-xs" style={{ color: '#64748B' }}>
            Click the button to produce a natural-language summary.
          </p>
        </div>
      </div>
    );
  }

  const sections = data?.sections || [];

  return (
    <div className="rounded-xl overflow-hidden" style={{ background: '#ffffff', border: '1px solid #E2E8F0' }}>
      {/* Header */}
      <div className="px-5 py-4 flex items-center justify-between" style={{ background: '#0F2D52' }}>
        <div>
          <h3 className="text-sm font-semibold" style={{ color: '#ffffff' }}>
            {title}
          </h3>
          {data?.meta?.basedOn && (
            <p className="text-xs mt-1" style={{ color: '#94A3B8' }}>
              Based on: {data.meta.basedOn}
            </p>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="px-5 py-5">
        <div className="space-y-4">
          {sections
            .filter((section) => section.id !== 'overallSummary')
            .map((section) => (
              <div key={section.id}>
                <h4
                  className="text-[10px] font-bold uppercase tracking-wider mb-1"
                  style={{ color: '#0F2D52' }}
                >
                  {section.title}
                </h4>
                <p className="text-xs leading-relaxed" style={{ color: '#64748B' }}>
                  {renderFormattedText(section.text)}
                </p>
              </div>
            ))}
        </div>

        {/* Overall Summary */}
        {sections.find((s) => s.id === 'overallSummary') && (
          <div className="mt-5 pt-4" style={{ borderTop: '1px solid #E2E8F0' }}>
            <div
              className="rounded-lg p-4"
              style={{ background: '#F8FAFC', border: '1px solid #E2E8F0' }}
            >
              <div className="mb-2">
                <h4
                  className="text-[10px] font-bold uppercase tracking-wider"
                  style={{ color: '#0F2D52' }}
                >
                  Overall Summary
                </h4>
              </div>
              <p className="text-xs leading-relaxed" style={{ color: '#334155' }}>
                {renderFormattedText(sections.find((s) => s.id === 'overallSummary')?.text)}
              </p>
            </div>
          </div>
        )}

        {/* Footer */}
        <div
          className="mt-4 pt-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1"
          style={{ borderTop: '1px solid #E2E8F0' }}
        >
          <p className="text-[10px]" style={{ color: '#94A3B8' }}>
            Generated from TBInsight analytical indicators and model outputs
          </p>
          {data?.meta?.generatedAt && (
            <p className="text-[10px]" style={{ color: '#94A3B8' }}>
              Generated {new Date(data.meta.generatedAt).toLocaleString()}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export default AiInsightPanel;
