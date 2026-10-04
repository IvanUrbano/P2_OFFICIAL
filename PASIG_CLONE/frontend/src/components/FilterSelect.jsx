/* Shared compact filter dropdown — label pill + native select, used by the
 * inline horizontal filter bars (Analytics, Forecasting, GIS Hotspots,
 * Intervention Planning). Left padding on the <select> itself carries into
 * the native dropdown list's option indentation in Chromium, so keep pl-2
 * rather than removing it. */
export default function FilterSelect({ label, value, onChange, children, selectStyle, style }) {
  return (
    <div className="relative flex items-center gap-1.5 shrink-0 rounded-lg px-2.5 py-[7px]" style={{ background: '#ffffff', border: '1px solid #E2E8F0', ...style }}>
      <span className="text-[11px] whitespace-nowrap pointer-events-none" style={{ color: '#94A3B8' }}>{label}:</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className="bg-transparent text-[11px] font-semibold outline-none cursor-pointer appearance-none pl-2 pr-4 min-w-0"
        style={{ color: '#0F2D52', ...selectStyle }}
      >
        {children}
      </select>
      <i className="ri-arrow-down-s-line text-[10px] pointer-events-none shrink-0" style={{ color: '#64748B' }} />
    </div>
  );
}
