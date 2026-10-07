import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { APPROVED_OUTCOMES, OUTCOME_COLORS, STATUS_COLORS } from '../utils/outcomeStatus';

const titleCase = (v) => String(v).toLowerCase().replace(/(^|[\s-])\w/g, (m) => m.toUpperCase());

/**
 * Treatment outcomes (donut) and current case status, kept visibly separate.
 * Outcomes are final results; Diagnosed / On Treatment are current states — they are
 * listed below the chart and never drawn as slices, and never count as success.
 *
 * Props:
 *   outcomes    { [OUTCOME]: count } — keys from APPROVED_OUTCOMES (others ignored)
 *   diagnosed   number of cases with case status DIAGNOSED
 *   onTreatment number of cases with case status ON TREATMENT
 */
export default function OutcomeStatusPanel({ outcomes = {}, diagnosed = 0, onTreatment = 0, plain = false }) {
  const rows = APPROVED_OUTCOMES.map((key) => ({ key, name: titleCase(key), value: Number(outcomes[key] || 0) }));
  const slices = rows.filter((r) => r.value > 0);
  const total = slices.reduce((n, r) => n + r.value, 0);
  const pct = (v) => (total > 0 ? `${((v / total) * 100).toFixed(1)}%` : '—');
  const statuses = [
    { key: 'DIAGNOSED', label: 'Diagnosed', value: Number(diagnosed || 0) },
    { key: 'ON TREATMENT', label: 'On Treatment', value: Number(onTreatment || 0) },
  ];

  return (
    <div className="space-y-4">
      {total > 0 ? (
        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-4">
          <div className="relative w-[168px] h-[168px] shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={slices} dataKey="value" nameKey="name" innerRadius={52} outerRadius={80}
                  paddingAngle={1} stroke="#ffffff" isAnimationActive={false}>
                  {slices.map((s) => <Cell key={s.key} fill={OUTCOME_COLORS[s.key] || '#94A3B8'} />)}
                </Pie>
                <Tooltip formatter={(v, n) => [`${Number(v).toLocaleString()} (${pct(v)})`, n]} />
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className={`text-lg leading-none ${plain ? 'font-semibold' : 'font-extrabold'}`} style={{ color: '#0F2D52' }}>{total.toLocaleString()}</span>
              <span className={plain ? 'mt-1 text-[10px]' : 'mt-1 text-[9px] uppercase tracking-wider'} style={{ color: '#64748B' }}>{plain ? 'final outcomes' : 'with outcome'}</span>
            </div>
          </div>
          <ul className="space-y-1.5 min-w-[190px] flex-1 max-w-[260px]">
            {rows.map((r) => (
              <li key={r.key} className="flex items-center justify-between gap-3 text-[11px]">
                <span className="flex items-center gap-2 min-w-0">
                  <span className={`w-2.5 h-2.5 shrink-0 ${plain ? '' : 'rounded-sm'}`} style={{ background: OUTCOME_COLORS[r.key] || '#94A3B8' }} />
                  <span className="truncate" style={{ color: r.value ? '#334155' : '#94A3B8' }}>{r.name}</span>
                </span>
                <span className="tabular-nums whitespace-nowrap">
                  <span className="font-bold" style={{ color: r.value ? '#0F2D52' : '#94A3B8' }}>{r.value.toLocaleString()}</span>
                  <span className="ml-1.5 inline-block w-11 text-right" style={{ color: '#94A3B8' }}>{r.value ? pct(r.value) : ''}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-10 gap-2">
          {!plain && <i className="ri-pie-chart-2-line text-xl" style={{ color: '#CBD5E1' }} />}
          <p className="text-xs text-[#64748B]">No final outcomes recorded yet.</p>
        </div>
      )}

      <div className={plain ? 'border-t border-[#E2E8F0] pt-4' : 'rounded-lg px-4 py-3'} style={plain ? undefined : { background: '#F8FAFC', border: '1px solid #EEF2F7' }}>
        <div className="flex items-center justify-between gap-3 mb-2">
          <p className={plain ? 'text-[11px] font-semibold text-[#0F2D52]' : 'text-[10px] font-bold uppercase tracking-wider text-[#64748B]'}>{plain ? 'Current case status' : 'Case status'}</p>
          <p className={plain ? 'text-[10px] text-[#64748B]' : 'text-[10px] text-[#94A3B8]'}>No final outcome yet</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {statuses.map((s) => (
            <div key={s.key} className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-[11px]" style={{ color: '#334155' }}>
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: STATUS_COLORS[s.key] }} />
                {s.label}
              </span>
              <span className={`text-sm tabular-nums ${plain ? 'font-semibold' : 'font-extrabold'}`} style={{ color: '#0F2D52' }}>{s.value.toLocaleString()}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
