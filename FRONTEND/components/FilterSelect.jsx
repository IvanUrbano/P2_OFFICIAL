export default function FilterSelect({ label, value, onChange, children }) {
  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[11px] pointer-events-none" style={{ color: '#94A3B8' }}>{label}:</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg pr-7 py-[7px] text-[11px] font-semibold outline-none transition cursor-pointer appearance-none"
        style={{
          background: '#ffffff',
          color: '#0F2D52',
          border: '1px solid #E2E8F0',
          paddingLeft: `${(label.length * 6.5) + 24}px`,
        }}
      >
        {children}
      </select>
      <i className="ri-arrow-down-s-line absolute right-2 top-1/2 -translate-y-1/2 text-[10px] pointer-events-none" style={{ color: '#64748B' }} />
    </div>
  );
}
