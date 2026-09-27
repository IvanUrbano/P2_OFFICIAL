/**
 * Treatment Cascade — shared presentation for Dashboard and Analytics.
 *
 * Both pages MUST fetch the same shared backend calculation
 * (GET /api/tb/treatment-cascade) — no client-side cascade math.
 * Null rates (division by zero) render as "N/A", never 0.
 *
 * Stage rates are cascade progression metrics. They are NOT the
 * client-defined Treatment Success Rate (TSR) — never label them TSR.
 */

const STAGE_LABELS = [
  { key: 'diagnosed', label: 'Diagnosed', note: 'Valid date of diagnosis', rateKey: null },
  { key: 'started_treatment', label: 'Started Treatment', note: 'Treatment start date recorded', rateKey: 'started_pct' },
  { key: 'evaluated', label: 'Evaluated', note: 'Terminal outcome recorded', rateKey: 'evaluated_pct' },
  { key: 'successful_outcome', label: 'Successful Outcome', note: 'Cured or Treatment Completed', rateKey: 'successful_outcome_pct_of_diagnosed' },
];

const RATE_TILES = [
  { key: 'started_pct', label: 'Started', of: '% of Diagnosed' },
  { key: 'evaluated_pct', label: 'Evaluated', of: '% of Diagnosed' },
  { key: 'successful_outcome_pct_of_evaluated', label: 'Successful Outcome', of: '% of Evaluated' },
  { key: 'successful_outcome_pct_of_diagnosed', label: 'Successful Outcome', of: '% of Diagnosed' },
];

const fmtCount = (n) => (n == null ? 'N/A' : Number(n).toLocaleString());
const fmtPct = (v) => (v == null ? 'N/A' : `${v}%`);

function TreatmentCascadeCard({ data, loading = false, description }) {
  const cascade = data?.cascade || null;
  const rates = data?.rates || null;
  const breakdown = data?.breakdown || null;
  const diagnosed = cascade?.diagnosed || 0;

  const stageWidth = (count) => {
    if (!diagnosed || count == null) return 0;
    return Math.max(Math.min((count / diagnosed) * 100, 100), 3);
  };

  return (
    <div className="rounded-xl overflow-hidden" style={{ background: '#ffffff', border: '1px solid #E2E8F0' }}>
      <div className="flex items-center justify-between px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="w-1 h-8 rounded-full" style={{ background: '#0F2D52' }} />
          <div>
            <h3 className="text-sm font-bold" style={{ color: '#1E293B' }}>Treatment Cascade</h3>
            <p className="text-[11px] mt-0.5" style={{ color: '#94A3B8' }}>
              {description || 'Diagnosis-to-outcome progression.'}
            </p>
          </div>
        </div>
        {Object.values(data?.meta?.filters || {}).some((v) => v != null && v !== '') && (
          <span className="text-[9px] font-bold uppercase tracking-wider px-2 py-1 rounded" style={{ background: '#F1F5F9', color: '#64748B' }}>
            Filtered view
          </span>
        )}
      </div>

      {loading && (
        <div className="flex items-center justify-center py-12 gap-3">
          <div className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: '#DBEAFE', borderTopColor: '#0F2D52' }} />
          <p className="text-xs" style={{ color: '#94A3B8' }}>Computing cascade...</p>
        </div>
      )}

      {!loading && !cascade && (
        <div className="flex flex-col items-center justify-center py-12 gap-2">
          <i className="ri-flow-chart text-xl" style={{ color: '#CBD5E1' }} />
          <p className="text-xs" style={{ color: '#94A3B8' }}>No cascade data available.</p>
        </div>
      )}

      {!loading && cascade && (
        <div className="px-5 pb-5">
          {/* Funnel stages */}
          <div className="space-y-3 pt-1">
            {STAGE_LABELS.map((stage, idx) => {
              const count = cascade[stage.key];
              const width = stageWidth(count);
              const pctOfDiagnosed = stage.rateKey == null
                ? (diagnosed ? 100 : null)
                : rates?.[stage.rateKey];
              return (
                <div key={stage.key}>
                  <div className="flex items-baseline justify-between mb-1">
                    <span className="text-[12px] font-bold" style={{ color: '#0F2D52' }}>
                      {idx + 1}. {stage.label}
                    </span>
                    <span className="text-[11px] font-semibold" style={{ color: '#64748B' }}>
                      {fmtCount(count)}
                      <span className="ml-2 font-bold" style={{ color: idx === 3 ? '#047857' : '#0F2D52' }}>
                        {idx === 0 ? fmtPct(diagnosed ? 100 : null) : fmtPct(pctOfDiagnosed)}
                      </span>
                    </span>
                  </div>
                  <div className="h-4 rounded" style={{ background: '#F1F5F9' }}>
                    <div
                      className="h-4 rounded transition-all"
                      style={{
                        width: `${width}%`,
                        background: idx === 3 ? '#047857' : ['#0F2D52', '#2E6FAF', '#2563EB'][idx] || '#0F2D52',
                      }}
                    />
                  </div>
                  <p className="text-[9px] mt-0.5" style={{ color: '#94A3B8' }}>{stage.note}</p>
                </div>
              );
            })}
          </div>

          {/* Rate tiles */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4 pt-4" style={{ borderTop: '1px solid #F1F5F9' }}>
            {RATE_TILES.map((tile) => {
              const value = rates?.[tile.key];
              return (
                <div key={tile.key} className="rounded-lg px-3 py-2" style={{ background: '#F8FAFC', border: '1px solid #E8ECF1' }}>
                  <p className="text-[9px] font-bold uppercase tracking-wider" style={{ color: '#94A3B8' }}>{tile.label}</p>
                  <p className="text-sm font-extrabold" style={{ color: value == null ? '#94A3B8' : '#0F2D52' }}>{fmtPct(value)}</p>
                  <p className="text-[9px]" style={{ color: '#CBD5E1' }}>{tile.of}</p>
                </div>
              );
            })}
          </div>

          {/* Bacteriological breakdown — not a cascade stage */}
          {breakdown && (
            <div className="mt-4 pt-4" style={{ borderTop: '1px solid #F1F5F9' }}>
              <p className="text-[9px] font-bold uppercase tracking-wider mb-2" style={{ color: '#94A3B8' }}>
                Bacteriological Breakdown (of Diagnosed)
              </p>
              <div className="flex items-center gap-4">
                <div className="flex-1 rounded-lg px-3 py-2" style={{ background: '#F8FAFC', border: '1px solid #E8ECF1' }}>
                  <p className="text-[11px] font-bold" style={{ color: '#0F2D52' }}>Bacteriologically Confirmed</p>
                  <p className="text-sm font-extrabold" style={{ color: '#0F2D52' }}>{fmtCount(breakdown.bacteriologically_confirmed)}</p>
                </div>
                <div className="flex-1 rounded-lg px-3 py-2" style={{ background: '#F8FAFC', border: '1px solid #E8ECF1' }}>
                  <p className="text-[11px] font-bold" style={{ color: '#0F2D52' }}>Clinically Diagnosed</p>
                  <p className="text-sm font-extrabold" style={{ color: '#0F2D52' }}>{fmtCount(breakdown.clinically_diagnosed)}</p>
                </div>
              </div>
            </div>
          )}

          <p className="text-[9px] mt-3" style={{ color: '#CBD5E1' }}>
            Stage rates are cascade progression metrics (not TSR). Rates with a zero denominator show N/A.
          </p>
        </div>
      )}
    </div>
  );
}

export default TreatmentCascadeCard;
