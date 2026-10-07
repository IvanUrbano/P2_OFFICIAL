/** One-line plain-language interpretation shown directly under a chart. */
export default function ChartInsight({ text, plain = false }) {
  if (!text) return null;
  if (plain) {
    return (
      <div className="mt-5 border-t border-[#E2E8F0] pt-3">
        <p className="text-xs font-semibold text-[#0F2D52]">Interpretation</p>
        <p className="mt-1 text-xs leading-relaxed text-[#475569]">{text}</p>
      </div>
    );
  }
  return (
    <div className="mt-3 flex gap-2 rounded-lg px-3 py-2 text-[11px] leading-relaxed" style={{ background: '#F0F7FF', border: '1px solid #DBEAFE', color: '#1E3A5F' }}>
      <i className="ri-lightbulb-line text-sm shrink-0" style={{ color: '#2563EB' }} />
      <p><span className="font-bold">Interpretation: </span>{text}</p>
    </div>
  );
}
