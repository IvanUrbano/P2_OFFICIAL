import { useEffect, useState } from 'react';
import { useTheme } from '../theme';

/**
 * Blocking progress dialog for long actions (import, delete/undo, pipeline runs).
 *
 * - `percent` (0–100) shows a real, filling bar — use it only when progress is
 *   actually measured (e.g. file upload). Leave it null for server-side work whose
 *   remaining time is unknown: the bar then animates without claiming a percentage.
 * - `steps` + `activeStep` list the stages; only advance `activeStep` when a stage
 *   has really finished (upload done → server processing).
 * - An elapsed-time counter shows the action is still alive.
 */
export default function ProgressOverlay({
  open,
  title,
  detail,
  percent = null,
  steps = [],
  activeStep = 0,
  icon = 'ri-loader-4-line',
  tone = '#2E6FAF',
  note,
}) {
  const { t } = useTheme();
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!open) return undefined;
    const started = Date.now();
    const tick = () => setElapsed(Math.floor((Date.now() - started) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [open]);

  if (!open) return null;

  const determinate = typeof percent === 'number';
  const pct = determinate ? Math.max(0, Math.min(100, Math.round(percent))) : null;
  const mins = Math.floor(elapsed / 60);
  const secs = String(elapsed % 60).padStart(2, '0');

  return (
    <div className="fixed inset-0 z-[1300] flex items-center justify-center bg-black/40 backdrop-blur-[2px]" role="dialog" aria-modal="true" aria-labelledby="progress-title">
      <div className="w-full max-w-[420px] mx-4 overflow-hidden shadow-xl" style={{ background: t.cardSolid, border: `1px solid ${t.borderStrong}`, borderRadius: '8px' }}>
        <div className="px-5 pt-5 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ background: `${tone}1F` }}>
              <i className={`${icon} text-xl ${icon === 'ri-loader-4-line' ? 'animate-spin' : ''}`} style={{ color: tone }} />
            </div>
            <div className="min-w-0">
              <h3 id="progress-title" className="text-sm font-bold" style={{ color: t.text }}>{title}</h3>
              {detail && <p className="text-xs mt-0.5" style={{ color: t.textSecondary }}>{detail}</p>}
            </div>
          </div>

          <div className="mt-4">
            <div
              className="h-2 w-full rounded-full overflow-hidden"
              style={{ background: t.borderStrong }}
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
            <div className="flex justify-between mt-1.5 text-[11px] tabular-nums" style={{ color: t.textSecondary }}>
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
                      <i className="ri-checkbox-blank-circle-line text-base" style={{ color: t.textMuted }} />
                    )}
                    <span style={{ color: done ? t.textSecondary : active ? t.text : t.textMuted, fontWeight: active ? 700 : 500 }}>{label}</span>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
        {note && (
          <div className="px-5 py-3 text-[11px]" style={{ background: t.panel, borderTop: `1px solid ${t.border}`, color: t.textSecondary }}>
            {note}
          </div>
        )}
      </div>
    </div>
  );
}
