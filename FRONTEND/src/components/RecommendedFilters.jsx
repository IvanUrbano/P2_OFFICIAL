import FilterSelect from './FilterSelect';

/**
 * Dashboard filter bar, under the KPI strip.
 *
 * The pills are views suggested by the latest data (see utils/dashboardFilters.js): click one
 * to apply it, click it again to remove it. Year and Barangay are the same filter set by hand.
 * The pill's hover text explains why it is suggested.
 */
export default function RecommendedFilters({
  recommendations,
  filters,
  yearOptions,
  barangayOptions,
  view,
  updating,
  onToggle,
  onYearChange,
  onBarangayChange,
  onClear,
}) {
  const { year, scope } = filters;
  const active = Boolean(year || scope);
  const barangayValue = scope ? (scope.mode === 'manual' ? scope.barangays[0] : '__group__') : '';
  const isOn = (rec) => (rec.kind === 'year' ? rec.year === year : scope?.key === rec.key);

  return (
    <div className="rounded-xl overflow-hidden" style={{ background: '#ffffff', border: '1px solid #E2E8F0' }}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          {recommendations.map((rec) => {
            const on = isOn(rec);
            const empty = rec.count === 0;
            return (
              <button
                key={rec.key}
                type="button"
                aria-pressed={on}
                disabled={empty && !on}
                onClick={() => onToggle(rec)}
                title={empty ? 'Nothing to suggest right now.' : rec.hint}
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-semibold transition-colors disabled:cursor-not-allowed"
                style={on
                  ? { background: '#0F2D52', color: '#ffffff', border: '1px solid #0F2D52' }
                  : { background: '#ffffff', color: empty ? '#94A3B8' : '#0F2D52', border: '1px solid #E2E8F0', opacity: empty ? 0.6 : 1 }}
                onMouseEnter={(e) => { if (!on && !empty) e.currentTarget.style.background = '#F1F5F9'; }}
                onMouseLeave={(e) => { if (!on && !empty) e.currentTarget.style.background = '#ffffff'; }}
              >
                {rec.label}
                {!empty && (
                  <span
                    className="rounded-full px-1.5 text-[10px] font-bold"
                    style={on ? { background: 'rgba(255,255,255,0.18)', color: '#ffffff' } : { background: '#F1F5F9', color: '#64748B' }}
                  >
                    {rec.kind === 'year' ? rec.year : rec.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {updating && (
            <span className="inline-flex items-center gap-1.5 text-[11px] font-medium" style={{ color: '#64748B' }}>
              <i className="ri-loader-4-line animate-spin" /> Updating
            </span>
          )}
          <FilterSelect label="Year" value={year} onChange={onYearChange}>
            <option value="">All years</option>
            {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
          </FilterSelect>
          <FilterSelect label="Barangay" value={barangayValue} onChange={onBarangayChange}>
            <option value="">All barangays</option>
            {scope && scope.mode !== 'manual' && <option value="__group__" disabled>{scope.label} (group)</option>}
            {barangayOptions.map((b) => <option key={b} value={b}>{b}</option>)}
          </FilterSelect>
          {active && (
            <button
              type="button"
              onClick={onClear}
              className="text-[11px] font-semibold px-1 hover:underline"
              style={{ color: '#2E6FAF' }}
            >
              Clear all
            </button>
          )}
        </div>
      </div>

      {active && (
        <div className="px-4 py-2 text-[11px]" style={{ borderTop: '1px solid #E2E8F0', background: '#FAFBFC', color: '#64748B' }}>
          Showing {view.cases.toLocaleString()} case{view.cases === 1 ? '' : 's'} in {view.barangays} of {view.totalBarangays} barangays.
          The overall insight below still covers all of Pasig City.
        </div>
      )}
    </div>
  );
}
