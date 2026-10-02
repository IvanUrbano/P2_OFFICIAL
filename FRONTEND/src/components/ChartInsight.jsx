/** One-line plain-language interpretation shown directly under a chart. */
export default function ChartInsight({ text }) {
  if (!text) return null;
  return (
    <div className="mt-3 flex gap-2 rounded-lg px-3 py-2 text-[11px] leading-relaxed" style={{ background: '#F0F7FF', border: '1px solid #DBEAFE', color: '#1E3A5F' }}>
      <i className="ri-lightbulb-line text-sm shrink-0" style={{ color: '#2563EB' }} />
      <p><span className="font-bold">Interpretation: </span>{text}</p>
    </div>
  );
}
