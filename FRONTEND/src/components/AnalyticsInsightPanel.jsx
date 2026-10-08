import renderFormattedText from '../utils/renderFormattedText.jsx';

export default function AnalyticsInsightPanel({ data, loading, error, onRetry, onGenerate, compact = false, embedded = false, sectionDisclosure = false, title = 'Analytics interpretation', description = 'A written summary of the current results.', titleId = 'analytics-interpretation-title' }) {
  const sections = data?.sections || [];
  const summary = sections.find((section) => section.id === 'overallSummary');
  const details = sections.filter((section) => section.id !== 'overallSummary');
  const detailList = details.length > 0 && (
    <div className="divide-y divide-[#E8EDF2]">
      {details.map((section) => (
        <div key={section.id} className="py-3 last:pb-0">
          <h4 className="text-sm font-semibold text-[#0F2D52]">{section.title}</h4>
          <p className="mt-1 text-sm leading-relaxed text-[#475569]">{renderFormattedText(section.text)}</p>
        </div>
      ))}
    </div>
  );

  return (
    <section className={embedded ? 'bg-white' : 'overflow-hidden rounded-lg border border-[#E2E8F0] bg-white'} aria-labelledby={titleId}>
      <div className={`bg-[#0F2D52] px-5 py-4 ${embedded ? 'pr-14' : ''}`}>
        <h3 id={titleId} className="text-base font-semibold text-white">{title}</h3>
        <p className="mt-1 text-sm text-[#CBD5E1]">{description}</p>
      </div>

      {loading ? (
        <div className="flex items-center gap-3 px-5 py-6" role="status">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#CBD5E1] border-t-[#0F2D52]" aria-hidden="true" />
          <p className="text-xs text-[#475569]">Preparing the interpretation…</p>
        </div>
      ) : error ? (
        <div className="px-5 py-5">
          <p className="text-xs leading-relaxed text-[#475569]">The interpretation could not be generated. The charts remain available.</p>
          {onRetry && <button type="button" onClick={onRetry} className="mt-3 text-xs font-semibold text-[#047857] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#047857]">Retry &rarr;</button>}
        </div>
      ) : !data ? (
        <div className="px-5 py-5">
          <p className="text-xs leading-relaxed text-[#475569]">Generate a written interpretation of the charts and indicators.</p>
          {onGenerate && <button type="button" onClick={onGenerate} className="mt-3 text-xs font-semibold text-[#047857] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#047857]">Generate interpretation &rarr;</button>}
        </div>
      ) : (
        <>
          <div className="px-5 py-5">
            {summary && (
              <div className="pb-4">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-[#0F2D52]">Overview</h4>
                <p className="mt-1 text-sm leading-relaxed text-[#475569]">{renderFormattedText(summary.text)}</p>
              </div>
            )}
            {details.length > 0 ? (
              sectionDisclosure ? (
                <div className="border-t border-[#DCE4ED]">
                  <h4 className="pt-4 text-xs font-semibold uppercase tracking-wide text-[#64748B]">Detailed findings</h4>
                  <div className="mt-1 divide-y divide-[#E2E8F0]">
                    {details.map((section) => (
                      <details key={section.id} className="group">
                        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-3 text-sm font-semibold text-[#0F2D52] marker:hidden hover:text-[#174A7E] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0F2D52] [&::-webkit-details-marker]:hidden">
                          <span>{section.title}</span>
                          <i className="ri-arrow-down-s-line shrink-0 text-base transition-transform group-open:rotate-180" aria-hidden="true" />
                        </summary>
                        <p className="pb-4 text-[13px] leading-6 text-[#475569] [&_strong]:font-semibold [&_strong]:text-[#0F2D52]">
                          {renderFormattedText(section.text)}
                        </p>
                      </details>
                    ))}
                  </div>
                </div>
              ) : compact && summary ? (
                <details className="group border-t border-[#E8EDF2] pt-3">
                  <summary className="flex cursor-pointer list-none items-center justify-between text-xs font-semibold text-[#0F2D52] marker:hidden focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0F2D52] [&::-webkit-details-marker]:hidden">
                    Read detailed findings
                    <i className="ri-arrow-down-s-line text-base transition-transform group-open:rotate-180" aria-hidden="true" />
                  </summary>
                  <div className="pt-2">{detailList}</div>
                </details>
              ) : <div className="border-t border-[#E8EDF2]">{detailList}</div>
            ) : !summary ? (
              <p className="text-xs text-[#64748B]">No interpretation is available for this selection.</p>
            ) : null}
          </div>
          {(data?.meta?.basedOn || data?.meta?.generatedAt) && (
            <div className="border-t border-[#E2E8F0] px-5 py-3 text-[11px] leading-relaxed text-[#64748B]">
              {data.meta.basedOn && <p>Based on {data.meta.basedOn}</p>}
              {data.meta.generatedAt && <p>Generated {new Date(data.meta.generatedAt).toLocaleString()}</p>}
            </div>
          )}
        </>
      )}
    </section>
  );
}
