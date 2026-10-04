import { useEffect, useState } from 'react';

/**
 * Blocking progress dialog for long actions (import, validate, delete, sync).
 *
 * - `percent` (0–100) shows a real, filling bar — use it only when progress is
 *   actually measured (e.g. file upload). Leave it null for server-side work whose
 *   remaining time is unknown: the bar then animates without claiming a percentage.
 * - `steps` + `activeStep` list the stages; only advance `activeStep` when a stage
 *   has really finished (upload done → server processing).
 * - An elapsed-time counter shows the action is still alive.
 * - `inline` renders the same card in the page flow instead of a blocking dialog,
 *   for work that keeps running if the user leaves (e.g. a background sync).
 * - `startedAt` (ISO time) counts elapsed time from when the work really began, e.g.
 *   a sync started before this page was opened.
 */
export default function ProgressOverlay({
  open,
  title,
  detail,
  percent = null,
  steps = [],
  activeStep = 0,
  icon = 'ri-loader-4-line',
  tone = '#0F2D52',
  note,
  inline = false,
  startedAt,
}) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!open) return undefined;
    const parsed = startedAt ? new Date(startedAt).getTime() : NaN;
    const started = Number.isNaN(parsed) ? Date.now() : Math.min(parsed, Date.now());
    const tick = () => setElapsed(Math.floor((Date.now() - started) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [open, startedAt]);

  if (!open) return null;

  const determinate = typeof percent === 'number';
  const pct = determinate ? Math.max(0, Math.min(100, Math.round(percent))) : null;
  const mins = Math.floor(elapsed / 60);
  const secs = String(elapsed % 60).padStart(2, '0');

  const card = (
      <div
        className={inline ? 'bg-white border border-gray-200 w-full overflow-hidden' : 'bg-white border border-gray-200 shadow-xl w-full max-w-[420px] mx-4 overflow-hidden'}
        style={{ borderRadius: inline ? '12px' : '8px', boxShadow: inline ? '0 4px 16px rgba(15,23,42,0.04)' : undefined }}
        role={inline ? 'status' : undefined}
      >
        <div className="px-5 pt-5 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ background: `${tone}14` }}>
              <i className={`${icon} text-xl ${icon === 'ri-loader-4-line' ? 'animate-spin' : ''}`} style={{ color: tone }} />
            </div>
            <div className="min-w-0">
              <h3 id="progress-title" className="text-sm font-bold" style={{ color: '#0F2D52' }}>{title}</h3>
              {detail && <p className="text-xs mt-0.5" style={{ color: '#64748B' }}>{detail}</p>}
            </div>
          </div>

          <div className="mt-4">
            <div
              className="h-2 w-full rounded-full overflow-hidden"
              style={{ background: '#E2E8F0' }}
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pct ?? undefined}
              aria-busy="true"
            >
              {determinate ? (
                <div className="h-full rounded-full transition-[width] duration-300" style={{ width: `${pct}%`, background: tone }} />
              ) : (
                <div className="h-full w-2/5 rounded-full progress-indeterminate" style={{ background: tone }} />
              )}
            </div>
            <div className="flex justify-between mt-1.5 text-[11px] tabular-nums" style={{ color: '#64748B' }}>
              <span>{determinate ? `${pct}%` : 'Working…'}</span>
              <span>{mins > 0 ? `${mins}:${secs}` : `${elapsed}s`} elapsed</span>
            </div>
          </div>

          {steps.length > 0 && (
            <ol className="mt-4 space-y-2">
              {steps.map((label, i) => {
                const done = i < activeStep;
                const active = i === activeStep;
                return (
                  <li key={label} className="flex items-center gap-2.5 text-xs">
                    {done ? (
                      <i className="ri-checkbox-circle-fill text-base" style={{ color: '#10B981' }} />
                    ) : active ? (
                      <i className="ri-loader-4-line animate-spin text-base" style={{ color: tone }} />
                    ) : (
                      <i className="ri-checkbox-blank-circle-line text-base" style={{ color: '#CBD5E1' }} />
                    )}
                    <span style={{ color: done ? '#475569' : active ? '#0F2D52' : '#94A3B8', fontWeight: active ? 700 : 500 }}>{label}</span>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
        {note && (
          <div className="px-5 py-3 text-[11px] border-t border-gray-100" style={{ background: '#F8FAFC', color: '#64748B' }}>
            {note}
          </div>
        )}
      </div>
  );

  if (inline) return card;

  return (
    <div className="fixed inset-0 z-[1300] flex items-center justify-center bg-black/40 backdrop-blur-[2px]" role="dialog" aria-modal="true" aria-labelledby="progress-title">
      {card}
    </div>
  );
}
