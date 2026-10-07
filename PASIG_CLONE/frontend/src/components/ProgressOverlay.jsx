export default function ProgressOverlay({
  open,
  title,
  detail,
  percent = null,
  tone = '#0F2D52',
  note,
  inline = false,
  borderless = false,
}) {
  if (!open) return null;

  const determinate = typeof percent === 'number';
  const pct = determinate ? Math.max(0, Math.min(100, Math.round(percent))) : null;
  const card = (
    <div
      className={`w-full overflow-hidden ${borderless ? 'border-0 bg-transparent' : 'border border-gray-200 bg-white'} ${inline ? '' : 'mx-4 max-w-[420px] shadow-md'}`}
      style={{ borderRadius: 4 }}
      aria-busy="true"
      role={inline ? 'status' : undefined}
    >
      <div className="flex items-start gap-3 px-5 py-4">
        <i className="ri-loader-4-line mt-0.5 animate-spin text-sm shrink-0" aria-hidden="true" style={{ color: tone }} />
        <div className="min-w-0">
          <h3 id="progress-title" className="text-sm font-semibold" style={{ color: '#0F2D52' }}>{title}</h3>
          {detail && <p className="mt-1 text-xs leading-relaxed" style={{ color: '#64748B' }}>{detail}</p>}
        </div>
      </div>
      <div className="px-5 pb-4">
        <div
          className="h-1 w-full overflow-hidden"
          style={{ background: '#E8EDF2' }}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct ?? undefined}
          aria-busy="true"
        >
          {determinate ? (
            <div className="h-full transition-[width] duration-300" style={{ width: `${pct}%`, background: tone }} />
          ) : (
            <div className="h-full w-2/5 progress-indeterminate" style={{ background: tone }} />
          )}
        </div>
        {determinate && <p className="mt-1.5 text-[11px] tabular-nums" style={{ color: '#64748B' }}>{pct}% complete</p>}
      </div>
      {note && <div className="px-5 py-2.5 text-[11px] border-t" style={{ borderColor: '#E8EDF2', color: '#64748B' }}>{note}</div>}
    </div>
  );

  if (inline) return card;

  return (
    <div className="fixed inset-0 z-[1300] flex items-center justify-center bg-black/35" role="dialog" aria-modal="true" aria-labelledby="progress-title">
      {card}
    </div>
  );
}
