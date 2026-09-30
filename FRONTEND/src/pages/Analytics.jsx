import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  ComposedChart, BarChart, Bar, Line, Area, PieChart, Pie, Cell,
  CartesianGrid, XAxis, YAxis, Tooltip,
  ResponsiveContainer,
} from 'recharts';
import API from '../api/axios';
import AiInsightPanel from '../components/AiInsightPanel';
import TreatmentCascadeCard from '../components/TreatmentCascadeCard';
import FilterSelect from '../components/FilterSelect';
import { getAnalyticsInsight } from '../services/insightService';
import {
  categorizeAge,
  matchesNonYearFilters,
  buildMonthlySeries,
  buildPreviousYearComparison,
  mergeComparison,
} from '../utils/trendComparison';

/* ─── Constants ──────────────────────────────────────────────────────── */

const COLORS = {
  primary: '#0F2D52',
  blue: '#2E6FAF',
  cyan: '#5F9EA0',
  red: '#991B1B',
  green: '#047857',
  purple: '#6B7280',
  amber: '#92400E',
  gray: '#94A3B8',
};

const OUTCOME_COLORS = {
  'CURED': '#2a78d6',
  'TREATMENT COMPLETED': '#eb6834',
  'ON TREATMENT': '#1baf7a',
  'FAILED': '#eda100',
  'DIED': '#e87ba4',
  'LOST TO FF-UP': '#008300',
  'EXCLUDED': '#4a3aa7',
  'DIAGNOSED': '#0369A1',
  'NOT EVALUATED': '#94A3B8',
};

const OUTCOME_ORDER = [
  'CURED', 'TREATMENT COMPLETED', 'ON TREATMENT', 'FAILED',
  'DIAGNOSED', 'NOT EVALUATED', 'DIED', 'LOST TO FF-UP', 'EXCLUDED',
];

const AGE_GROUP_ORDER = ['0-14', '15-24', '25-34', '35-44', '45-54', '55-64', '65+'];

const MONTHS = [
  'All Months', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const OUTCOMES = [
  'All', 'CURED', 'TREATMENT COMPLETED', 'ON TREATMENT', 'FAILED',
  'DIAGNOSED', 'NOT EVALUATED', 'DIED', 'LOST TO FF-UP', 'EXCLUDED',
];

const ACTIVE_OUTCOMES = ['ON TREATMENT'];

/* ─── Helper Components ──────────────────────────────────────────────── */

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="px-3 py-2.5 rounded-lg text-xs shadow-lg" style={{
      background: '#ffffff',
      border: '1px solid #E2E8F0',
      minWidth: 120,
    }}>
      {label && <div className="text-[10px] font-semibold mb-1.5 pb-1" style={{ color: '#64748B', borderBottom: '1px solid #F1F5F9' }}>{label}</div>}
      {payload.map((entry, i) => (
        <div key={i} className="flex items-center justify-between gap-4 py-0.5">
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: entry.color || entry.fill }} />
            <span style={{ color: '#64748B' }}>{entry.name}</span>
          </div>
          <span className="font-bold" style={{ color: '#1E293B' }}>{entry.value != null ? Number(entry.value).toLocaleString() : '—'}</span>
        </div>
      ))}
    </div>
  );
}

function TrendBadge({ current, previous, inverse }) {
  if (previous == null || previous === 0 || current == null) return null;
  const diff = ((current - previous) / Math.abs(previous)) * 100;
  const pct = Math.abs(diff).toFixed(1);
  if (pct === '0.0') return null;
  const isUp = diff > 0;
  const isGood = inverse ? !isUp : isUp;
  return (
    <span className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0"
      style={{ background: isGood ? '#ECFDF5' : '#FEF2F2', color: isGood ? '#047857' : '#991B1B' }}>
      <i className={`${isUp ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} text-[10px]`} />
      {pct}%
    </span>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-3">
      <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{ background: '#F1F5F9' }}>
        <i className="ri-bar-chart-grouped-line text-2xl" style={{ color: '#CBD5E1' }} />
      </div>
      <p className="text-sm font-semibold" style={{ color: '#475569' }}>No Data Available</p>
      <p className="text-xs text-center max-w-xs" style={{ color: '#94A3B8' }}>
        No TB records match the selected filters. Try adjusting your filters and apply again.
      </p>
    </div>
  );
}


/* ─── Main Analytics Component ───────────────────────────────────────── */

export default function Analytics() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  /* Nonce re-triggering the metric-card effects (cascade/TSR/CFR/population)
   * on header Refresh — their deps are filter values only, so identical
   * filters would otherwise never refetch. */
  const [refreshTick, setRefreshTick] = useState(0);
  const [error, setError] = useState(null);

  /* Raw data from API */
  const [allCases, setAllCases] = useState([]);
  const [barangays, setBarangays] = useState([]);
  const [riskData, setRiskData] = useState([]);
  const [facilities, setFacilities] = useState([]);
  const [filterOptions, setFilterOptions] = useState({ sex: [], bacteriological_status: [], outcome_status: [] });

  /* Filter state */
  const [filterYear, setFilterYear] = useState('');
  const [filterMonth, setFilterMonth] = useState('');
  const [filterBarangay, setFilterBarangay] = useState('');
  const [filterFacility, setFilterFacility] = useState('');
  const [filterOutcome, setFilterOutcome] = useState('');
  const [filterSex, setFilterSex] = useState('');
  const [filterAgeGroup, setFilterAgeGroup] = useState('');
  const [filterBact, setFilterBact] = useState('');
  const [applied, setApplied] = useState(false);

  /* Applied filter state */
  const [aYear, setAYear] = useState('');
  const [aMonth, setAMonth] = useState('');
  const [aBarangay, setABarangay] = useState('');
  const [aFacility, setAFacility] = useState('');
  const [aOutcome, setAOutcome] = useState('');
  const [aSex, setASex] = useState('');
  const [aAgeGroup, setAAgeGroup] = useState('');
  const [aBact, setABact] = useState('');

  /* Enhancement toggles */
  const [compareYear, setCompareYear] = useState(false);
  const [showIncidence, setShowIncidence] = useState(false);

  // Incidence has no meaning across combined "All Years" data (see
  // barangayIncidenceData) — derive the effective toggle state instead of
  // resetting `showIncidence` in an effect, so clearing the year filter
  // falls back to the Cases view without an extra render pass.
  const incidenceViewActive = showIncidence && !!aYear;

  /* NLG Insight state */
  const [insightData, setInsightData] = useState(null);
  const [insightLoading, setInsightLoading] = useState(false);
  const [insightError, setInsightError] = useState(null);
  const [cascadeData, setCascadeData] = useState(null);
  const [tsrData, setTsrData] = useState(null);
  const [prevTsrData, setPrevTsrData] = useState(null);
  const [cfrData, setCfrData] = useState(null);
  const [cascadeLoading, setCascadeLoading] = useState(false);

  /* ── Data fetching ── */
  const loadAll = useCallback(async () => {
    try {
      setError(null);
      const [firstPageRes, brgyRes, riskRes, filterRes, facilityRes] = await Promise.all([
        API.get('/api/tb/cases?limit=1'),
        API.get('/api/tb/barangays'),
        API.get('/api/tb/gis/choropleth'),
        API.get('/api/tb/filter-options').catch(() => ({ data: {} })),
        API.get('/api/tb/facilities').catch(() => ({ data: { facilities: [] } })),
      ]);
      const totalCases = firstPageRes.data.pagination?.total || 0;
      const allCasesRes = totalCases > 0
        ? await API.get(`/api/tb/cases?limit=${totalCases}`)
        : firstPageRes;
      setAllCases(allCasesRes.data.cases || []);
      setBarangays(brgyRes.data.barangays || brgyRes.data || []);
      setRiskData(riskRes.data.choropleth || []);
      setFilterOptions(filterRes.data || {});
      setFacilities(facilityRes.data.facilities || []);
    } catch (err) {
      if (import.meta.env.DEV) console.error('Analytics fetch error:', err);
      setError('Failed to load analytics data. Make sure the backend is running.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  /* ── Apply filters ── */
  const handleApply = useCallback(() => {
    setAYear(filterYear);
    setAMonth(filterMonth);
    setABarangay(filterBarangay);
    setAFacility(filterFacility);
    setAOutcome(filterOutcome);
    setASex(filterSex);
    setAAgeGroup(filterAgeGroup);
    setABact(filterBact);
    setApplied(true);
  }, [filterYear, filterMonth, filterBarangay, filterFacility, filterOutcome, filterSex, filterAgeGroup, filterBact]);

  const handleClear = useCallback(() => {
    setFilterYear('');
    setFilterMonth('');
    setFilterBarangay('');
    setFilterFacility('');
    setFilterOutcome('');
    setFilterSex('');
    setFilterAgeGroup('');
    setFilterBact('');
    setAYear('');
    setAMonth('');
    setABarangay('');
    setAFacility('');
    setAOutcome('');
    setASex('');
    setAAgeGroup('');
    setABact('');
    setApplied(false);
  }, []);

  const handleGenerateInsight = useCallback(async () => {
    if (insightLoading) return;
    try {
      setInsightLoading(true);
      setInsightError(null);
      const insight = await getAnalyticsInsight({
        year: aYear,
        month: aMonth,
        barangay: aBarangay,
        facility: aFacility,
        outcome: aOutcome,
        sex: aSex,
        ageGroup: aAgeGroup,
        bacteriological: aBact,
      });
      setInsightData(insight);
    } catch (err) {
      if (import.meta.env.DEV) console.error('Insight generation failed:', err);
      setInsightError('Unable to generate insight.');
    } finally {
      setInsightLoading(false);
    }
  }, [insightLoading, aYear, aMonth, aBarangay, aFacility, aOutcome, aSex, aAgeGroup, aBact]);

  /* ── Header refresh: reload EVERYTHING — base data (loadAll), the metric
   * cards (refreshTick re-fires their effects), and a fresh NLG insight
   * (always regenerated, matching Dashboard's refresh). Spinner + disabled
   * button cover the whole batch; no page skeleton flash. ── */
  const handleRefresh = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    setRefreshTick((t) => t + 1);
    try {
      await Promise.all([loadAll(), handleGenerateInsight()]);
    } finally {
      setRefreshing(false);
    }
  }, [loadAll, refreshing, handleGenerateInsight]);

  /* ── Treatment Cascade — shared backend calculation with active filters ── */
  const activeCascadeFilters = useMemo(() => {
    const f = {};
    if (aYear) f.year = aYear;
    if (aMonth) f.month = aMonth;
    if (aBarangay) f.barangay = aBarangay;
    if (aSex) f.sex = aSex;
    if (aAgeGroup) f.ageGroup = aAgeGroup;
    if (aBact) f.bacteriological = aBact;
    return f;
  }, [aYear, aMonth, aBarangay, aSex, aAgeGroup, aBact]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setCascadeLoading(true);
        const res = await API.get('/api/tb/treatment-cascade', { params: activeCascadeFilters });
        if (!cancelled) setCascadeData(res.data);
      } catch (err) {
        if (!cancelled) {
          if (import.meta.env.DEV) console.error('Cascade fetch failed:', err);
          setCascadeData(null);
        }
      } finally {
        if (!cancelled) setCascadeLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [activeCascadeFilters, refreshTick]);

  /* ── Treatment Success Rate — shared backend cohort calculation ──
   * GET /api/tb/treatment-success-rate: (Cured+Completed) / patients whose
   * treatment started in year (aYear||currentYear)-1, optionally scoped to
   * aBarangay. Replaces a previous client-side calculation that filtered by
   * diagnosis date with no cohort — a different metric that disagreed with
   * the AI-generated insight text on this same page under the same label. */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const params = {};
        if (aYear) params.year = aYear;
        if (aBarangay) params.barangay = aBarangay;
        if (aSex) params.sex = aSex;
        if (aAgeGroup) params.ageGroup = aAgeGroup;
        if (aFacility) params.facility = aFacility;
        if (aBact) params.bacteriological = aBact;
        const res = await API.get('/api/tb/treatment-success-rate', { params });
        if (!cancelled) setTsrData(res.data);
      } catch (err) {
        if (!cancelled) {
          if (import.meta.env.DEV) console.error('TSR fetch failed:', err);
          setTsrData(null);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [aYear, aBarangay, aSex, aAgeGroup, aFacility, aBact, refreshTick]);

  /* ── Case Fatality Rate — shared backend calculation ──
   * GET /api/tb/case-fatality-rate: DIED / evaluated terminal outcomes,
   * scoped by diagnosis year (same year semantics as Total/Active Cases),
   * optionally scoped to aBarangay. */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const params = {};
        if (aYear) params.year = aYear;
        if (aMonth) params.month = aMonth;
        if (aBarangay) params.barangay = aBarangay;
        if (aSex) params.sex = aSex;
        if (aAgeGroup) params.ageGroup = aAgeGroup;
        if (aFacility) params.facility = aFacility;
        if (aBact) params.bacteriological = aBact;
        const res = await API.get('/api/tb/case-fatality-rate', { params });
        if (!cancelled) setCfrData(res.data);
      } catch (err) {
        if (!cancelled) {
          if (import.meta.env.DEV) console.error('CFR fetch failed:', err);
          setCfrData(null);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [aYear, aMonth, aBarangay, aSex, aAgeGroup, aFacility, aBact, refreshTick]);

  // Previous year's TSR, for the YoY trend badge — only meaningful when a
  // specific year is selected (mirrors previousMetrics' own aYear gate).
  useEffect(() => {
    if (!aYear) { setPrevTsrData(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const params = { year: String(Number(aYear) - 1) };
        if (aBarangay) params.barangay = aBarangay;
        if (aSex) params.sex = aSex;
        if (aAgeGroup) params.ageGroup = aAgeGroup;
        if (aFacility) params.facility = aFacility;
        if (aBact) params.bacteriological = aBact;
        const res = await API.get('/api/tb/treatment-success-rate', { params });
        if (!cancelled) setPrevTsrData(res.data);
      } catch (err) {
        if (!cancelled) {
          if (import.meta.env.DEV) console.error('Previous-year TSR fetch failed:', err);
          setPrevTsrData(null);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [aYear, aBarangay, aSex, aAgeGroup, aFacility, aBact, refreshTick]);

  /* ── Year-matched population (for Incidence per 100k) ──
   * Incidence must divide a year's cases by THAT SAME year's population
   * (populationService.computeYearIncidence's rule, already used correctly
   * by GIS) — never a flat, undated population figure. "All Years" has no
   * single matching year, so incidence is N/A there by design. */
  const [yearPopulationMap, setYearPopulationMap] = useState({});
  useEffect(() => {
    let cancelled = false;
    if (!aYear) { setYearPopulationMap({}); return undefined; }
    (async () => {
      try {
        const res = await API.get(`/api/tb/population/${aYear}`);
        const map = {};
        (res.data.data || []).forEach((r) => {
          const pop = Number(r.population);
          if (pop > 0) map[r.barangay_name] = pop;
        });
        if (!cancelled) setYearPopulationMap(map);
      } catch (err) {
        if (!cancelled) {
          if (import.meta.env.DEV) console.error('Year population fetch failed:', err);
          setYearPopulationMap({});
        }
      }
    })();
    return () => { cancelled = true; };
  }, [aYear, refreshTick]);

  /* ── Remove a single filter chip ── */
  const removeFilter = useCallback((key) => {
    const setters = {
      year: () => { setFilterYear(''); setAYear(''); },
      month: () => { setFilterMonth(''); setAMonth(''); },
      barangay: () => { setFilterBarangay(''); setABarangay(''); },
      facility: () => { setFilterFacility(''); setAFacility(''); },
      outcome: () => { setFilterOutcome(''); setAOutcome(''); },
      sex: () => { setFilterSex(''); setASex(''); },
      age: () => { setFilterAgeGroup(''); setAAgeGroup(''); },
      bacterio: () => { setFilterBact(''); setABact(''); },
    };
    if (setters[key]) setters[key]();
    setApplied(true);
  }, []);

  /* ── Derived barangay names ── */
  const barangayNames = useMemo(() => {
    return barangays.map((b) => b.barangay_name || b.name).filter(Boolean).sort();
  }, [barangays]);

  /* ── Available years from data ── */
  const availableYears = useMemo(() => {
    const years = new Set();
    allCases.forEach((c) => {
      if (c.date_of_diagnosis) {
        years.add(new Date(c.date_of_diagnosis).getFullYear());
      }
    });
    return [...years].sort((a, b) => b - a).map(String);
  }, [allCases]);

  /* ── Filtered cases ──
     Non-year filters go through the shared `matchesNonYearFilters`
     predicate — the SAME one the previous-year comparison uses, so both
     years of the trend chart can never diverge. Year/month stay here. */
  const filteredCases = useMemo(() => {
    if (!applied) return allCases;
    return allCases.filter((c) => {
      if (!matchesNonYearFilters(c, {
        barangay: aBarangay,
        facility: aFacility,
        outcome: aOutcome,
        sex: aSex,
        ageGroup: aAgeGroup,
        bacteriological: aBact,
      })) return false;
      if (aYear || aMonth) {
        const d = new Date(c.date_of_diagnosis);
        if (isNaN(d.getTime())) return false;
        if (aYear && d.getFullYear() !== Number(aYear)) return false;
        if (aMonth && (d.getMonth() + 1) !== Number(aMonth)) return false;
      }
      return true;
    });
  }, [allCases, applied, aYear, aMonth, aBarangay, aFacility, aOutcome, aSex, aAgeGroup, aBact]);

  /* ── Previous year cases (for trend indicators) ──
     Non-year filters go through the SAME `matchesNonYearFilters` predicate
     as `filteredCases`, so the badge and the chart can never disagree
     (the old inline substring check matched "Male" against "Female"). */
  const previousYearCases = useMemo(() => {
    if (!aYear) return [];
    const prevYear = String(Number(aYear) - 1);
    return allCases.filter((c) => {
      const d = new Date(c.date_of_diagnosis);
      if (isNaN(d.getTime())) return false;
      if (d.getFullYear() !== Number(prevYear)) return false;
      if (aMonth && (d.getMonth() + 1) !== Number(aMonth)) return false;
      return matchesNonYearFilters(c, {
        barangay: aBarangay,
        facility: aFacility,
        outcome: aOutcome,
        sex: aSex,
        ageGroup: aAgeGroup,
        bacteriological: aBact,
      });
    });
  }, [allCases, aYear, aMonth, aBarangay, aFacility, aOutcome, aSex, aAgeGroup, aBact]);

  /* ── Summary Metrics ── */
  const metrics = useMemo(() => {
    const total = filteredCases.length;
    const active = filteredCases.filter((c) => ACTIVE_OUTCOMES.includes((c.outcome_status || '').toUpperCase())).length;
    // Treatment Success Rate: from GET /api/tb/treatment-success-rate (the
    // cohort-based methodology — Cured+Completed / patients whose treatment
    // started in year Y-1). Previously computed here as
    // success/withOutcome from the currently-filtered, diagnosis-date-based
    // case list — a DIFFERENT metric that disagreed with the AI-generated
    // insight text on this same page under the same label. `null` (never
    // '0.0') when the cohort is empty.
    const successRate = tsrData?.successRate != null ? tsrData.successRate.toFixed(1) : null;
    // High-Risk Barangays: sourced ONLY from riskData (barangay_risk_scores
    // via /gis/choropleth) — the authoritative, RF-classified table. A
    // previous version of this preferred forecastsData (model_predictions)
    // first: model_predictions.risk_class is only ever a denormalized COPY
    // of the same barangay_risk_scores row (see storeResults in
    // scoring.js), so this was never actually a different model — just a
    // less complete, more fragile copy (it has no rows at all for a
    // historical snapshot year, since those intentionally skip
    // forecasting). Filter by selected barangay if set, otherwise count all.
    let highRisk;
    if (aBarangay) {
      // /gis/choropleth rows key the barangay by `name`, not `barangay_name`.
      const inRisk = riskData.find((r) => {
        const rc = (r.risk_class || '').toLowerCase();
        return rc === 'high' && r.name === aBarangay;
      });
      highRisk = inRisk ? 1 : 0;
    } else {
      const highRiskSet = new Set();
      riskData.forEach((r) => {
        const rc = (r.risk_class || '').toLowerCase();
        if (rc === 'high') highRiskSet.add(r.name);
      });
      highRisk = highRiskSet.size;
    }
    // Incidence per 100k: cases(scope, aYear) / population(scope, aYear) ×
    // 100,000 — same rule as populationService.computeYearIncidence. N/A
    // (not 0) for All Years (no single matching year) or missing population.
    let incidence = null;
    if (aYear) {
      const population = aBarangay
        ? (yearPopulationMap[aBarangay] ?? null)
        : Object.values(yearPopulationMap).reduce((s, v) => s + v, 0) || null;
      if (population != null && population > 0) {
        incidence = Math.round((total / population) * 100000 * 10) / 10;
      }
    }
    const fatalityRate = cfrData?.rate != null ? cfrData.rate.toFixed(1) : null;
    return { total, active, successRate, highRisk, incidence, fatalityRate };
  }, [filteredCases, riskData, aBarangay, aYear, tsrData, cfrData, yearPopulationMap]);

  /* ── Previous year metrics (for trend badges) ── */
  const previousMetrics = useMemo(() => {
    const total = previousYearCases.length;
    const active = previousYearCases.filter((c) => ACTIVE_OUTCOMES.includes((c.outcome_status || '').toUpperCase())).length;
    // Same cohort-based TSR, for the year before the selected one — see the
    // prevTsrData fetch above (year: aYear-1, so its own cohort is aYear-2).
    const successRate = prevTsrData?.successRate != null ? prevTsrData.successRate.toFixed(1) : null;
    return { total, active, successRate };
  }, [previousYearCases, prevTsrData]);

  /* ── TB Cases Trend (monthly, current selection) ── */
  const trendData = useMemo(() => buildMonthlySeries(filteredCases), [filteredCases]);

  /* ── Previous year trend (for YoY comparison) ──
     Built from the FULL `allCases` list — never from `filteredCases`,
     which already had the selected year removed — with the SAME non-year
     filters applied, then split on year = selected-1 inside the helper.
     Availability (complete coverage of the previous year) and the month
     filter are handled there; unavailable → { available: false, rows: [] }
     so no fabricated zero line is ever emitted. */
  const previousComparison = useMemo(() => {
    if (!compareYear || !aYear) {
      return { available: false, prevYear: aYear ? String(Number(aYear) - 1) : '', incompleteMonths: 0, reason: 'off', rows: [] };
    }
    return buildPreviousYearComparison({
      allCases,
      year: aYear,
      month: aMonth,
      filters: {
        barangay: aBarangay,
        facility: aFacility,
        outcome: aOutcome,
        sex: aSex,
        ageGroup: aAgeGroup,
        bacteriological: aBact,
      },
    });
  }, [compareYear, aYear, aMonth, allCases, aBarangay, aFacility, aOutcome, aSex, aAgeGroup, aBact]);

  /* ── Merged YoY trend data ──
     Merges by remapped month key ("2023-10" → "2024-10") and stores the
     count under the EXACT key the chart's dataKey reads
     (`Previous Year (YYYY)`). Unavailable comparison → current rows are
     returned untouched (no previous-year key → no dashed line). */
  const mergedTrendData = useMemo(() => {
    if (!compareYear || !previousComparison.available) return trendData;
    return mergeComparison(trendData, previousComparison);
  }, [compareYear, trendData, previousComparison]);

  /* ── Year-over-Year Trending ──
     YoY% = (current − previous) / previous × 100; previous = 0 → null (N/A). */
  const yoyData = useMemo(() => {
    const yearMap = new Map(); // year -> { count, months: Set }
    filteredCases.forEach((c) => {
      if (!c.date_of_diagnosis) return;
      const d = new Date(c.date_of_diagnosis);
      const year = d.getFullYear();
      if (Number.isNaN(year)) return;
      if (!yearMap.has(year)) yearMap.set(year, { count: 0, months: new Set() });
      const entry = yearMap.get(year);
      entry.count++;
      entry.months.add(d.getMonth());
    });
    // A year is "complete" for YoY comparison if it spans ≥3 distinct months.
    // An isolated historical record (e.g. 2022 with 1 case in 1 month) is incomplete.
    const COMPLETE_THRESHOLD = 3;
    const isComplete = (year) => {
      const entry = yearMap.get(year);
      return entry && entry.months.size >= COMPLETE_THRESHOLD;
    };
    const years = [...yearMap.keys()].sort((a, b) => a - b);
    const rows = years.map((year, i) => {
      const cases = yearMap.get(year).count;
      const complete = isComplete(year);
      let yoyPct = null;
      if (i > 0 && complete) {
        const prevYear = years[i - 1];
        if (isComplete(prevYear)) {
          const prev = yearMap.get(prevYear).count;
          if (prev > 0) yoyPct = Math.round(((cases - prev) / prev) * 100 * 10) / 10;
        }
      }
      return { year, cases, yoyPct, complete };
    });
    // Latest YoY Change: from the two most recent COMPLETE consecutive years
    const completeRows = rows.filter((r) => r.complete);
    let latestYoy = null;
    if (completeRows.length >= 2) {
      const curr = completeRows[completeRows.length - 1];
      const prev = completeRows[completeRows.length - 2];
      latestYoy = { pct: curr.yoyPct, currentYear: curr.year, previousYear: prev.year };
    }
    return { rows, latestYoy };
  }, [filteredCases]);

  /* ── TB Cases by Barangay ── */
  const barangayData = useMemo(() => {
    const byBarangay = {};
    filteredCases.forEach((c) => {
      const name = c.barangay_name || 'Unknown';
      if (!byBarangay[name]) byBarangay[name] = 0;
      byBarangay[name]++;
    });
    return Object.entries(byBarangay)
      .map(([name, count]) => ({ name, Cases: count }))
      .sort((a, b) => b.Cases - a.Cases);
  }, [filteredCases]);

  /* ── Barangay Incidence Data (per 100k) ──
   * Case year MUST match population year (populationService's rule). Uses
   * yearPopulationMap (fetched per aYear from /api/tb/population/:year),
   * never the flat, undated `barangays` population field. "All Years" has
   * no single matching year, so incidence is null (N/A), never 0 — a
   * previous version divided by a flat population regardless of which
   * year(s) were selected, silently summing multi-year cases over one
   * year's population. */
  const barangayIncidenceData = useMemo(() => {
    return barangayData.map((d) => {
      const pop = aYear ? (yearPopulationMap[d.name] ?? null) : null;
      return {
        ...d,
        Population: pop,
        Incidence: pop != null && pop > 0 ? Number(((d.Cases / pop) * 100000).toFixed(1)) : null,
      };
    });
  }, [barangayData, aYear, yearPopulationMap]);

  /* ── Cases by Health Facility ── */
  const facilityData = useMemo(() => {
    const byFacility = {};
    filteredCases.forEach((c) => {
      const name = c.screening_facility || c.treatment_facility || 'Unknown';
      if (!byFacility[name]) byFacility[name] = 0;
      byFacility[name]++;
    });
    return Object.entries(byFacility)
      .filter(([name]) => name !== 'Unknown')
      .map(([name, Cases]) => ({ name, Cases }))
      .sort((a, b) => b.Cases - a.Cases)
      .slice(0, 15);
  }, [filteredCases]);

  /* ── TB Cases by Age Group ── */
  const ageData = useMemo(() => {
    const byAge = {};
    filteredCases.forEach((c) => {
      const group = categorizeAge(c.age);
      if (!byAge[group]) byAge[group] = 0;
      byAge[group]++;
    });
    return AGE_GROUP_ORDER.map((group) => ({
      group,
      Cases: byAge[group] || 0,
    }));
  }, [filteredCases]);

  /* ── TB Cases by Sex ── */
  const sexData = useMemo(() => {
    const bySex = {};
    filteredCases.forEach((c) => {
      const sex = (c.sex || 'Unknown').trim();
      const key = sex.charAt(0).toUpperCase() + sex.slice(1).toLowerCase();
      if (!bySex[key]) bySex[key] = 0;
      bySex[key]++;
    });
    return Object.entries(bySex)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [filteredCases]);

  const totalSex = useMemo(() => sexData.reduce((s, r) => s + r.value, 0), [sexData]);

  /* ── Treatment Outcomes ── */
  const outcomeData = useMemo(() => {
    const byOutcome = {};
    filteredCases.forEach((c) => {
      const raw = (c.outcome_status || 'Unknown').toUpperCase();
      // Map DB variants to source-aligned display form
      const status = raw === 'TREATMENT FAILED' ? 'FAILED'
        : raw === 'LOST TO FOLLOW-UP' ? 'LOST TO FF-UP'
        : raw;
      if (!OUTCOME_ORDER.includes(status)) return; // exclude SCREENED etc.
      if (!byOutcome[status]) byOutcome[status] = 0;
      byOutcome[status]++;
    });
    return OUTCOME_ORDER
      .filter((name) => byOutcome[name])
      .map((name) => ({ name, Cases: byOutcome[name] }));
  }, [filteredCases]);

  /* ── Active Filter Chips ── */
  const activeFilters = useMemo(() => {
    const chips = [];
    if (aYear) chips.push({ key: 'year', label: 'Year', value: aYear });
    if (aMonth) chips.push({ key: 'month', label: 'Month', value: MONTHS[Number(aMonth)] || aMonth });
    if (aBarangay) chips.push({ key: 'barangay', label: 'Barangay', value: aBarangay });
    if (aFacility) chips.push({ key: 'facility', label: 'Facility', value: aFacility });
    if (aOutcome) chips.push({ key: 'outcome', label: 'Case Status / Outcome', value: aOutcome });
    if (aSex) chips.push({ key: 'sex', label: 'Sex', value: aSex });
    if (aAgeGroup) chips.push({ key: 'age', label: 'Age Group', value: aAgeGroup });
    if (aBact) chips.push({ key: 'bacterio', label: 'Bacterio', value: aBact });
    return chips;
  }, [aYear, aMonth, aBarangay, aFacility, aOutcome, aSex, aAgeGroup, aBact]);

  /* ── Last updated ── */
  const lastUpdated = useMemo(() => {
    const dates = allCases
      .map((c) => c.imported_at || c.date_of_diagnosis)
      .filter(Boolean)
      .map((d) => new Date(d).getTime())
      .filter((t) => !isNaN(t));
    if (dates.length === 0) return 'N/A';
    const latest = new Date(Math.max(...dates));
    return latest.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  }, [allCases]);

  /* ── Data coverage ── */
  const dataCoverage = useMemo(() => {
    const yearMonths = new Map(); // year -> Set of months
    const barangaySet = new Set();
    allCases.forEach((c) => {
      if (c.date_of_diagnosis) {
        const d = new Date(c.date_of_diagnosis);
        const yr = d.getFullYear();
        if (!Number.isNaN(yr)) {
          if (!yearMonths.has(yr)) yearMonths.set(yr, new Set());
          yearMonths.get(yr).add(d.getMonth());
        }
      }
      if (c.barangay_name) barangaySet.add(c.barangay_name);
    });
    // A year is "covered" if it spans ≥3 distinct months
    const coveredYears = [...yearMonths.entries()]
      .filter(([, months]) => months.size >= 3)
      .map(([yr]) => yr)
      .sort((a, b) => a - b);
    const range = coveredYears.length >= 2
      ? `${coveredYears[0]}–${coveredYears[coveredYears.length - 1]}`
      : coveredYears.length === 1
        ? String(coveredYears[0])
        : 'N/A';
    const brgyCount = barangaySet.size;
    // Population availability for selected year
    const popAvail = aYear
      ? (Object.keys(yearPopulationMap).length > 0 ? 'Available' : 'Unavailable')
      : null;
    return { range, brgyCount, popAvail };
  }, [allCases, aYear, yearPopulationMap]);

  /* ── Error state ── */
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: '#FEF2F2' }}>
          <i className="ri-error-warning-line text-3xl" style={{ color: COLORS.red }} />
        </div>
        <span className="text-sm font-medium" style={{ color: '#64748B' }}>{error}</span>
        <button
          onClick={loadAll}
          className="px-4 py-2 text-xs font-medium"
          style={{ background: '#F3F4F6', color: '#374151', border: '1px solid #D1D5DB', borderRadius: 4 }}
        >
          Retry
        </button>
      </div>
    );
  }

  const hasData = filteredCases.length > 0;
  const prevYearLabel = aYear ? String(Number(aYear) - 1) : '';

  return (
    <div className="space-y-6">
      {/* ─── Header + Filters ─── */}
      <div className="rounded-xl overflow-hidden" style={{ background: '#ffffff', boxShadow: '0 2px 16px rgba(15,45,82,0.07), 0 1px 3px rgba(15,45,82,0.04)' }}>
        {/* Header row */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-6 py-3.5" style={{ borderBottom: '1px solid #DBEAFE' }}>
          <div className="shrink-0">
            <h1 className="text-lg font-extrabold tracking-tight" style={{ color: '#0F2D52' }}>Analytics</h1>
            <p className="text-xs mt-0.5" style={{ color: '#94A3B8' }}>Analyze tuberculosis trends, case distribution, demographics, and treatment outcomes across Pasig City.</p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <div className="text-right mr-2">
              <span className="text-[11px] font-medium" style={{ color: '#94A3B8' }}>
                Last updated: {lastUpdated}
              </span>
              <p className="text-[10px]" style={{ color: '#CBD5E1' }}>
                Coverage: {dataCoverage.range} • {dataCoverage.brgyCount}/30 barangays
                {dataCoverage.popAvail && ` • Population: ${dataCoverage.popAvail}`}
              </p>
            </div>
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="text-xs font-semibold px-4 py-2"
              style={{ background: '#0F2D52', color: '#ffffff', border: '1px solid #0F2D52', borderRadius: 4, transition: 'background 0.15s, color 0.15s, border-color 0.15s, opacity 0.15s', opacity: refreshing ? 0.7 : 1, cursor: refreshing ? 'wait' : 'pointer' }}
              onMouseEnter={e => { if (!refreshing) { e.currentTarget.style.background = '#174A7E'; e.currentTarget.style.borderColor = '#174A7E'; } }}
              onMouseLeave={e => { e.currentTarget.style.background = '#0F2D52'; e.currentTarget.style.borderColor = '#0F2D52'; }}
            >
              <i className={`ri-refresh-line text-xs mr-1 ${refreshing ? 'animate-spin' : ''}`} />
              {refreshing ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
        </div>

        {/* Filter bar */}
        <div className="flex items-start justify-between gap-3 px-6 py-3" style={{ background: '#F8FAFC', borderTop: '1px solid #E2E8F0' }}>
          <div className="flex items-center gap-1.5 flex-wrap flex-1 min-w-0">
            <FilterSelect label="Year" value={filterYear} onChange={setFilterYear}>
              <option value="">All Years</option>
              {availableYears.map((y) => <option key={y} value={y}>{y}</option>)}
            </FilterSelect>
            <FilterSelect label="Month" value={filterMonth} onChange={setFilterMonth}>
              {MONTHS.map((m, i) => <option key={m} value={i === 0 ? '' : String(i)}>{m}</option>)}
            </FilterSelect>
            <FilterSelect label="Barangay" value={filterBarangay} onChange={setFilterBarangay} selectStyle={{ maxWidth: 140 }}>
              <option value="">All Barangays</option>
              {barangayNames.map((n) => <option key={n} value={n}>{n}</option>)}
            </FilterSelect>
            <FilterSelect label="Facility" value={filterFacility} onChange={setFilterFacility} selectStyle={{ maxWidth: 140 }}>
              <option value="">All Facilities</option>
              {facilities.map((f) => <option key={f.name} value={f.name}>{f.name}</option>)}
            </FilterSelect>
            <FilterSelect label="Case Status / Outcome" value={filterOutcome} onChange={setFilterOutcome} selectStyle={{ maxWidth: 150 }}>
              <option value="">All</option>
              {(filterOptions.outcome_status || OUTCOMES.filter(o => o !== 'All')).map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </FilterSelect>
            <FilterSelect label="Sex" value={filterSex} onChange={setFilterSex}>
              <option value="">All</option>
              {(filterOptions.sex || ['Male', 'Female']).map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </FilterSelect>
            <FilterSelect label="Age" value={filterAgeGroup} onChange={setFilterAgeGroup}>
              <option value="">All Ages</option>
              {AGE_GROUP_ORDER.map((g) => <option key={g} value={g}>{g}</option>)}
            </FilterSelect>
            <FilterSelect label="Bacterio" value={filterBact} onChange={setFilterBact} selectStyle={{ maxWidth: 130 }}>
              <option value="">All</option>
              {(filterOptions.bacteriological_status || []).map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </FilterSelect>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button onClick={handleClear} className="px-3 py-2 text-xs font-medium" style={{ background: '#F3F4F6', color: '#374151', border: '1px solid #D1D5DB', borderRadius: 4, transition: 'background 0.15s, color 0.15s, border-color 0.15s, opacity 0.15s' }} onMouseEnter={e => { e.currentTarget.style.background = '#E5E7EB'; }} onMouseLeave={e => { e.currentTarget.style.background = '#F3F4F6'; }}>
              Clear
            </button>
            <button onClick={handleApply} className="px-4 py-2 text-xs font-semibold" style={{ background: '#0F2D52', color: '#ffffff', border: '1px solid #0F2D52', borderRadius: 4, transition: 'background 0.15s, color 0.15s, border-color 0.15s, opacity 0.15s' }} onMouseEnter={e => { e.currentTarget.style.background = '#174A7E'; e.currentTarget.style.borderColor = '#174A7E'; }} onMouseLeave={e => { e.currentTarget.style.background = '#0F2D52'; e.currentTarget.style.borderColor = '#0F2D52'; }}>
              Apply Filters
            </button>
          </div>
        </div>
      </div>

      {/* ─── Active Filter Chips ─── */}
      {activeFilters.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          {activeFilters.map((f) => (
            <span key={f.key} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-semibold" style={{ background: '#F1F5F9', color: '#0F2D52', border: '1px solid #E2E8F0' }}>
              {f.label}: <span className="font-bold">{f.value}</span>
              <button onClick={() => removeFilter(f.key)} className="inline-flex items-center justify-center w-4 h-4" style={{ color: '#94A3B8' }}>
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {/* ─── Loading ─── */}
      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-xl p-5 animate-pulse" style={{ background: '#F8FAFC', border: '1px solid #E2E8F0' }}>
              <div className="h-3 w-24 rounded mb-3" style={{ background: '#E2E8F0' }} />
              <div className="h-7 w-16 rounded" style={{ background: '#E2E8F0' }} />
            </div>
          ))}
        </div>
      ) : !hasData ? (
        <EmptyState />
      ) : (
        <>
          {/* ─── KPI STRIP (full-width, single row) ─── */}
          <div className="rounded-xl" style={{ background: '#ffffff', boxShadow: '0 4px 24px rgba(15,45,82,0.12), 0 2px 8px rgba(15,45,82,0.08)' }}>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
              {/* Total TB Cases */}
              <div className="flex flex-col px-4 py-4 relative">
                <div className="flex items-center gap-2 h-5 min-w-0">
                  <i className="ri-file-list-3-line text-sm shrink-0" style={{ color: '#6B7FA3' }} />
                  <span className="text-[10px] font-bold uppercase tracking-wider leading-tight truncate" style={{ color: '#64748B' }}>Total TB Cases</span>
                </div>
                <div className="h-px my-3" style={{ background: '#E2E8F0' }} />
                <div className="flex items-end gap-1.5 flex-wrap">
                  <p className="text-2xl lg:text-3xl font-extrabold" style={{ color: '#0F2D52' }}>{metrics.total.toLocaleString()}</p>
                  {aYear && <TrendBadge current={metrics.total} previous={previousMetrics.total} inverse={true} />}
                </div>
                <span className="text-[11px] font-medium mt-1" style={{ color: '#94A3B8' }}>
                  {aYear ? `Diagnosed in ${aYear}` : availableYears.length > 0 ? `Total across ${availableYears[availableYears.length - 1]}–${availableYears[0]}` : 'Total across available years'}
                </span>
                <div className="hidden lg:block absolute right-0 top-1/2 -translate-y-1/2 w-px h-10" style={{ background: '#E2E8F0' }} />
              </div>

              {/* Incidence per 100k */}
              <div className="flex flex-col px-4 py-4 relative">
                <div className="flex items-center gap-2 h-5 min-w-0">
                  <i className="ri-pulse-line text-sm shrink-0" style={{ color: '#6B9E9E' }} />
                  <span className="text-[10px] font-bold uppercase tracking-wider leading-tight truncate" style={{ color: '#64748B' }}>Incidence / 100k</span>
                </div>
                <div className="h-px my-3" style={{ background: '#E2E8F0' }} />
                <p className="text-2xl lg:text-3xl font-extrabold" style={{ color: '#0F2D52' }}>{metrics.incidence == null ? 'N/A' : metrics.incidence}</p>
                <span className="text-[11px] font-medium mt-1" style={{ color: '#94A3B8' }}>
                  {!aYear ? 'Select a year — not applicable across combined years' : metrics.incidence == null ? 'No matching population data' : `${aYear} cases per 100,000 population`}
                </span>
                <div className="hidden lg:block absolute right-0 top-1/2 -translate-y-1/2 w-px h-10" style={{ background: '#E2E8F0' }} />
              </div>

              {/* Currently On Treatment */}
              <div className="flex flex-col px-4 py-4 relative">
                <div className="flex items-center justify-between gap-2 h-5">
                  <div className="flex items-center gap-2 min-w-0">
                    <i className="ri-first-aid-kit-line text-sm shrink-0" style={{ color: '#B8956A' }} />
                    <span className="text-[10px] font-bold uppercase tracking-wider leading-tight truncate" style={{ color: '#64748B' }}>Currently On Treatment</span>
                  </div>
                  {metrics.total > 0 && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0" style={{ background: '#FFFBEB', color: '#92400E' }}>
                      {((metrics.active / metrics.total) * 100).toFixed(1)}%
                    </span>
                  )}
                </div>
                <div className="h-px my-3" style={{ background: '#E2E8F0' }} />
                <div className="flex items-end gap-1.5 flex-wrap">
                  <p className="text-2xl lg:text-3xl font-extrabold" style={{ color: '#0F2D52' }}>{metrics.active.toLocaleString()}</p>
                  {aYear && <TrendBadge current={metrics.active} previous={previousMetrics.active} inverse={true} />}
                </div>
                <div className="hidden lg:block absolute right-0 top-1/2 -translate-y-1/2 w-px h-10" style={{ background: '#E2E8F0' }} />
              </div>

              {/* Treatment Success Rate (TSR) */}
              <div className="flex flex-col px-4 py-4 relative" title="TSR is a cohort-based indicator: (Cured + Treatment Completed) among patients whose treatment started in the previous year, divided by the total previous-year treatment cohort. This differs from the Treatment Cascade's Successful Outcome % of Evaluated.">
                <div className="flex items-center justify-between gap-2 h-5">
                  <div className="flex items-center gap-2 min-w-0">
                    <i className="ri-check-double-line text-sm shrink-0" style={{ color: '#6B9E8A' }} />
                    <span className="text-[10px] font-bold uppercase tracking-wider leading-tight truncate" style={{ color: '#64748B' }}>Treatment Success Rate (TSR)</span>
                  </div>
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0" style={{ background: '#ECFDF5', color: '#047857' }}>
                    {metrics.successRate == null ? 'N/A' : `${metrics.successRate}%`}
                  </span>
                </div>
                <div className="h-px my-3" style={{ background: '#E2E8F0' }} />
                <div className="flex items-end gap-1.5 flex-wrap">
                  <p className="text-2xl lg:text-3xl font-extrabold" style={{ color: '#0F2D52' }}>{metrics.successRate == null ? 'N/A' : `${metrics.successRate}%`}</p>
                  {aYear && metrics.successRate != null && previousMetrics.successRate != null &&
                    <TrendBadge current={Number(metrics.successRate)} previous={Number(previousMetrics.successRate)} inverse={false} />}
                </div>
                {tsrData?.cohortTotal != null && (
                  <span className="text-[10px] font-medium mt-1" style={{ color: '#94A3B8' }}>
                    Cohort: {tsrData.cohortYear || (aYear ? String(Number(aYear) - 1) : '—')} ({tsrData.cohortTotal.toLocaleString()} patients)
                  </span>
                )}
                {(aMonth || aOutcome) && (
                  <span className="text-[9px] mt-1 flex items-center gap-1" style={{ color: '#94A3B8' }}>
                    <i className="ri-information-line" />
                    TSR excludes Month and Outcome filters (annual cohort indicator)
                  </span>
                )}
                <div className="hidden lg:block absolute right-0 top-1/2 -translate-y-1/2 w-px h-10" style={{ background: '#E2E8F0' }} />
              </div>

              {/* Case Fatality Rate */}
              <div className="flex flex-col px-4 py-4 relative">
                <div className="flex items-center gap-2 h-5 min-w-0">
                  <i className="ri-heart-pulse-line text-sm shrink-0" style={{ color: '#B07070' }} />
                  <span className="text-[10px] font-bold uppercase tracking-wider leading-tight truncate" style={{ color: '#64748B' }}>Case Fatality Rate</span>
                </div>
                <div className="h-px my-3" style={{ background: '#E2E8F0' }} />
                <p className="text-2xl lg:text-3xl font-extrabold" style={{ color: '#0F2D52' }}>{metrics.fatalityRate == null ? 'N/A' : `${metrics.fatalityRate}%`}</p>
                <span className="text-[11px] font-medium mt-1" style={{ color: '#94A3B8' }}>Deaths / evaluated terminal outcomes</span>
                {cfrData?.total > 0 && cfrData?.evaluated != null && (cfrData.evaluated / cfrData.total) < 0.5 && (
                  <span className="text-[9px] mt-1" style={{ color: '#D97706' }}>
                    Only {cfrData.evaluated} of {cfrData.total} cases have reached a terminal outcome. CFR may not be representative.
                  </span>
                )}
                {aOutcome && (
                  <span className="text-[9px] mt-1 flex items-center gap-1" style={{ color: '#94A3B8' }}>
                    <i className="ri-information-line" />
                    CFR excludes Outcome filter (outcome is the indicator)
                  </span>
                )}
                <div className="hidden lg:block absolute right-0 top-1/2 -translate-y-1/2 w-px h-10" style={{ background: '#E2E8F0' }} />
              </div>

              {/* High-Risk Barangays */}
              <div className="flex flex-col px-4 py-4">
                <div className="flex items-center justify-between gap-2 h-5">
                  <div className="flex items-center gap-2 min-w-0">
                    <i className="ri-alarm-warning-line text-sm shrink-0" style={{ color: '#C4886A' }} />
                    <span className="text-[10px] font-bold uppercase tracking-wider leading-tight truncate" style={{ color: '#64748B' }}>High-Risk Barangays</span>
                  </div>
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0" style={{ background: '#FEF2F2', color: '#991B1B' }}>
                    {metrics.highRisk}/{barangayNames.length || 30}
                  </span>
                </div>
                <div className="h-px my-3" style={{ background: '#E2E8F0' }} />
                <p className="text-2xl lg:text-3xl font-extrabold" style={{ color: '#0F2D52' }}>{metrics.highRisk}</p>
              </div>
            </div>
          </div>

          <div className="flex gap-6">
            {/* ─── LEFT COLUMN: Cascade + Charts (scrollable) ─── */}
            <div className="flex-1 min-w-0 space-y-6">

          {/* ─── Treatment Cascade (shared backend calculation) ─── */}
          <TreatmentCascadeCard
            data={cascadeData}
            loading={cascadeLoading}
            description="Diagnosis-to-outcome progression for the active filters."
          />
          {aOutcome && (
            <p className="text-[9px] -mt-4 flex items-center gap-1" style={{ color: '#94A3B8' }}>
              <i className="ri-information-line" />
              Treatment Cascade excludes the Case Status / Outcome filter because outcome determines treatment progression stages.
            </p>
          )}

          {/* ─── TB Cases Trend (with YoY Comparison) ─── */}
          <div className="rounded-xl overflow-hidden" style={{ background: '#ffffff', border: '1px solid #E2E8F0' }}>
            <div className="flex items-center justify-between px-5 py-4">
              <div className="flex items-center gap-3">
                <div className="w-1 h-8 rounded-full" style={{ background: '#2563EB' }} />
                <div>
                  <h3 className="text-sm font-bold" style={{ color: '#1E293B' }}>TB Cases Trend</h3>
                  <p className="text-[11px] mt-0.5" style={{ color: '#94A3B8' }}>Monthly tuberculosis cases over the selected period.</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-3 mr-2">
                  <div className="flex items-center gap-1.5">
                    <span className="w-6 h-[3px] rounded-full" style={{ background: '#2563EB' }} />
                    <span className="text-[11px] font-medium" style={{ color: '#64748B' }}>Cases</span>
                  </div>
                  {compareYear && prevYearLabel && previousComparison.available && (
          <div className="flex items-center gap-1.5 shrink-0">
                      <span className="w-4 h-0 border-t-2" style={{ borderColor: '#CBD5E1', borderStyle: 'dashed' }} />
                      <span className="text-[11px] font-medium" style={{ color: '#94A3B8' }}>Previous Year ({prevYearLabel})</span>
                    </div>
                  )}
                </div>
                {aYear && (
                  <button onClick={() => setCompareYear(!compareYear)}
                    className="text-xs font-semibold px-3 py-1.5"
                    style={{ background: '#0F2D52', color: '#ffffff', border: '1px solid #0F2D52', borderRadius: 4, transition: 'background 0.15s, color 0.15s, border-color 0.15s, opacity 0.15s' }}
                    onMouseEnter={e => { e.currentTarget.style.background = '#174A7E'; e.currentTarget.style.borderColor = '#174A7E'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = '#0F2D52'; e.currentTarget.style.borderColor = '#0F2D52'; }}>
                    {compareYear ? (previousComparison.available ? `Comparing ${prevYearLabel}` : 'Comparison Unavailable') : `Compare Year`}
                  </button>
                )}
              </div>
            </div>
            <div className="px-5 pb-5">
              {mergedTrendData.length > 0 ? (
                <div className="w-full" style={{ height: 300 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={mergedTrendData} margin={{ top: 10, right: 15, left: -10, bottom: 0 }}>
                      <defs>
                        <linearGradient id="trendGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#2563EB" stopOpacity={0.08} />
                          <stop offset="100%" stopColor="#2563EB" stopOpacity={0.01} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E8ECF1" />
                      <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#94A3B8' }} axisLine={false} tickLine={false} tickMargin={6} />
                      <YAxis tick={{ fontSize: 10, fill: '#94A3B8' }} axisLine={false} tickLine={false} width={40} tickMargin={4} />
                      <Tooltip content={<ChartTooltip />} cursor={{ stroke: '#E2E8F0', strokeWidth: 1 }} />
                      <Area type="monotone" dataKey="Cases" stroke="#2563EB" strokeWidth={2.5} fill="url(#trendGrad)" dot={{ fill: '#2563EB', r: 3.5, strokeWidth: 2, stroke: '#ffffff' }} activeDot={{ r: 5, strokeWidth: 2, stroke: '#ffffff' }} name="Cases" />
                      {compareYear && prevYearLabel && previousComparison.available && (
                        <Line type="monotone" dataKey={`Previous Year (${prevYearLabel})`} stroke="#CBD5E1" strokeWidth={1.5} strokeDasharray="6 4" dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: '#ffffff' }} name={`Previous Year (${prevYearLabel})`} connectNulls />
                      )}
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="text-sm text-center py-10" style={{ color: '#94A3B8' }}>No trend data available for the selected filters.</p>
              )}
              {compareYear && aYear && !previousComparison.available && (
                <p className="text-[11px] mt-2 text-center" style={{ color: '#94A3B8' }}>
                  <i className="ri-information-line" /> Previous-year comparison unavailable due to incomplete {prevYearLabel} data.
                </p>
              )}
            </div>
          </div>

          {/* ─── Year-over-Year Trending ─── */}
          <div className="rounded-xl overflow-hidden" style={{ background: '#ffffff', border: '1px solid #E2E8F0' }}>
            <div className="flex items-center justify-between px-5 py-4">
              <div className="flex items-center gap-3">
                <div className="w-1 h-8 rounded-full" style={{ background: '#7C3AED' }} />
                <div>
                  <h3 className="text-sm font-bold" style={{ color: '#1E293B' }}>Year-over-Year Trending</h3>
                  <p className="text-[11px] mt-0.5" style={{ color: '#94A3B8' }}>Annual case counts and change versus the previous year.</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-[9px] font-bold uppercase tracking-wider" style={{ color: '#94A3B8' }}>Latest YoY Change</p>
                <p
                  className="text-lg font-extrabold"
                  style={{ color: yoyData.latestYoy?.pct == null ? '#94A3B8' : yoyData.latestYoy.pct > 0 ? '#DC2626' : yoyData.latestYoy.pct < 0 ? '#047857' : '#64748B' }}
                >
                  {yoyData.latestYoy?.pct == null ? 'N/A' : `${yoyData.latestYoy.pct > 0 ? '+' : ''}${yoyData.latestYoy.pct}%`}
                </p>
                {yoyData.latestYoy && (
                  <p className="text-[9px] mt-0.5" style={{ color: '#94A3B8' }}>
                    {yoyData.latestYoy.currentYear} vs {yoyData.latestYoy.previousYear}
                  </p>
                )}
              </div>
            </div>
            <div className="px-5 pb-5">
              {yoyData.rows.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr style={{ background: '#0F2D52', color: '#ffffff' }}>
                        <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider">Year</th>
                        <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-right">Cases</th>
                        <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-right">YoY Change</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...yoyData.rows].reverse().map((row) => (
                        <tr key={row.year} style={{ borderBottom: '1px solid #F1F5F9' }}>
                          <td className="px-3 py-2 text-[12px] font-bold" style={{ color: '#0F2D52' }}>{row.year}</td>
                          <td className="px-3 py-2 text-[12px] text-right font-semibold" style={{ color: '#475569' }}>{row.cases.toLocaleString()}</td>
                          <td className="px-3 py-2 text-right">
                            {!row.complete ? (
                              <span className="text-[10px] font-semibold px-2 py-0.5 rounded" style={{ background: '#FEF3C7', color: '#92400E' }}>Incomplete Data</span>
                            ) : row.yoyPct == null ? (
                              <span className="text-[11px] font-bold" style={{ color: '#94A3B8' }}>N/A</span>
                            ) : (
                              <span className="text-[11px] font-bold" style={{ color: row.yoyPct > 0 ? '#DC2626' : row.yoyPct < 0 ? '#047857' : '#64748B' }}>
                                {row.yoyPct > 0 ? '+' : ''}{row.yoyPct}%
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-center py-8" style={{ color: '#94A3B8' }}>No yearly data available for the selected filters.</p>
              )}
              <p className="text-[9px] mt-2" style={{ color: '#CBD5E1' }}>
                YoY% = (current − previous) / previous × 100. Years with fewer than 3 months of data are marked Incomplete. A zero previous-year count shows N/A.
              </p>
            </div>
          </div>

          {/* ─── TB Cases by Barangay ─── */}
          <div className="rounded-xl overflow-hidden" style={{ background: '#ffffff', border: '1px solid #E2E8F0' }}>
              <div className="flex items-center justify-between px-5 py-4">
                <div className="flex items-center gap-3">
                   <div className="w-1 h-8 rounded-full" style={{ background: incidenceViewActive ? '#92400E' : '#0D9488' }} />
                  <div>
                    <h3 className="text-sm font-bold" style={{ color: '#1E293B' }}>TB Cases by Barangay</h3>
                    <p className="text-[11px] mt-0.5" style={{ color: '#94A3B8' }}>{incidenceViewActive ? 'Incidence rate per 100,000 population across Pasig City barangays.' : 'Distribution of reported TB cases across the 30 barangays of Pasig City.'}</p>
                  </div>
                </div>
                <button onClick={() => setShowIncidence(!showIncidence)}
                  disabled={!aYear}
                  title={!aYear ? 'Select a specific year to view incidence — not applicable across combined years' : undefined}
                  className="text-xs font-semibold px-3 py-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ background: '#0F2D52', color: '#ffffff', border: '1px solid #0F2D52', borderRadius: 4, transition: 'background 0.15s, color 0.15s, border-color 0.15s, opacity 0.15s' }}
                  onMouseEnter={e => { if (aYear) { e.currentTarget.style.background = '#174A7E'; e.currentTarget.style.borderColor = '#174A7E'; } }}
                  onMouseLeave={e => { e.currentTarget.style.background = '#0F2D52'; e.currentTarget.style.borderColor = '#0F2D52'; }}>
                  {incidenceViewActive ? 'Show Cases' : 'Show Incidence'}
                </button>
              </div>
              <div className="px-5 pb-5">
                {barangayIncidenceData.length > 0 ? (
                  <div className="w-full" style={{ height: 420 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={barangayIncidenceData} margin={{ top: 10, right: 10, left: 0, bottom: 60 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#E8ECF1" />
                        <XAxis
                          type="category"
                          dataKey="name"
                          interval={0}
                          angle={-45}
                          textAnchor="end"
                          height={65}
                          tick={{ fontSize: 10, fill: '#64748B', fontWeight: 500 }}
                          axisLine={false}
                          tickLine={false}
                          tickMargin={4}
                        />
                        <YAxis
                          type="number"
                          tick={{ fontSize: 10, fill: '#94A3B8' }}
                          axisLine={false}
                          tickLine={false}
                          tickMargin={4}
                        />
                        <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(0,0,0,0.02)' }} />
                        <Bar dataKey={incidenceViewActive ? 'Incidence' : 'Cases'} radius={[6, 6, 0, 0]} barSize={20} name={incidenceViewActive ? 'Per 100k' : 'Cases'}>
                          {barangayIncidenceData.map((entry, i) => (
                            <Cell key={i} fill={incidenceViewActive
                               ? (entry.Incidence == null ? '#94A3B8' : entry.Incidence > 100 ? '#991B1B' : entry.Incidence > 50 ? '#92400E' : '#047857')
                              : (i === 0 ? '#0D9488' : i < 5 ? '#14B8A6' : '#99F6E4')
                            } />
                          ))}
                        </Bar>
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <p className="text-sm text-center py-10" style={{ color: '#94A3B8' }}>No barangay data available.</p>
                )}
              </div>
            </div>

            {/* ─── Cases by Health Facility + Treatment Outcomes (2:1 row) ─── */}
            <div className={`grid grid-cols-1 gap-6 ${facilityData.length > 0 ? 'lg:grid-cols-3' : ''}`}>
            {facilityData.length > 0 && (
              <div className="lg:col-span-2 rounded-xl overflow-hidden" style={{ background: '#ffffff', border: '1px solid #E2E8F0' }}>
                <div className="px-5 py-4">
                  <div className="flex items-center gap-3">
                    <div className="w-1 h-8 rounded-full" style={{ background: '#6B7280' }} />
                    <div>
                      <h3 className="text-sm font-bold" style={{ color: '#1E293B' }}>Cases by Health Facility</h3>
                      <p className="text-[11px] mt-0.5" style={{ color: '#94A3B8' }}>Top 15 health facilities handling TB cases in Pasig City.</p>
                    </div>
                  </div>
                </div>
                <div className="px-5 pb-5">
                  <div className="w-full" style={{ height: 400 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={facilityData} margin={{ top: 10, right: 10, left: 0, bottom: 75 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#E8ECF1" />
                        <XAxis
                          type="category"
                          dataKey="name"
                          interval={0}
                          angle={-45}
                          textAnchor="end"
                          height={75}
                          tickFormatter={(v) => (String(v).length > 16 ? String(v).slice(0, 15) + '…' : v)}
                          tick={{ fontSize: 10, fill: '#64748B', fontWeight: 500 }}
                          axisLine={false}
                          tickLine={false}
                          tickMargin={4}
                        />
                        <YAxis
                          type="number"
                          tick={{ fontSize: 10, fill: '#94A3B8' }}
                          axisLine={false}
                          tickLine={false}
                          tickMargin={4}
                        />
                        <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(0,0,0,0.02)' }} />
                        <Bar dataKey="Cases" radius={[6, 6, 0, 0]} barSize={24} name="Cases">
                          {facilityData.map((entry, i) => (
                            <Cell key={i} fill={i === 0 ? '#374151' : i < 5 ? '#6B7280' : '#9CA3AF'} />
                          ))}
                        </Bar>
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            )}

              {/* Treatment Outcomes Pie Chart (aligned beside the facility chart) */}
              <div className="lg:col-span-1 rounded-xl overflow-hidden" style={{ background: '#ffffff', border: '1px solid #E2E8F0' }}>
                <div className="px-5 py-4">
                  <div className="flex items-center gap-3">
                    <div className="w-1 h-8 rounded-full" style={{ background: '#047857' }} />
                    <div>
                      <h3 className="text-sm font-bold" style={{ color: '#1E293B' }}>Case Status / Outcome Distribution</h3>
                      <p className="text-[11px] mt-0.5" style={{ color: '#94A3B8' }}>Distribution of reported TB records by the Outcome/Status values recorded in the source data.</p>
                    </div>
                  </div>
                </div>
                <div className="px-5 pb-5">
                  {outcomeData.length > 0 ? (
                    <div className="flex flex-wrap items-center justify-center gap-6">
                      <div className="w-[180px] h-[180px] shrink-0">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={outcomeData}
                              cx="50%"
                              cy="50%"
                              innerRadius={45}
                              outerRadius={80}
                              paddingAngle={2}
                              dataKey="Cases"
                            >
                              {outcomeData.map((entry) => (
                                <Cell key={entry.name} fill={OUTCOME_COLORS[entry.name] || '#94A3B8'} />
                              ))}
                            </Pie>
                            <Tooltip formatter={(value) => value.toLocaleString()} />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="space-y-1.5">
                        {outcomeData.map((entry) => (
                          <div key={entry.name} className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: OUTCOME_COLORS[entry.name] || '#94A3B8' }} />
                            <span className="text-[10px] font-medium" style={{ color: '#64748B' }}>
                              {entry.name?.length > 16 ? entry.name.slice(0, 14) + '...' : entry.name}
                            </span>
                            <span className="text-[10px] font-bold" style={{ color: '#0F2D52' }}>{entry.Cases}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-16 gap-2">
                      <i className="ri-pie-chart-2-line text-xl" style={{ color: '#CBD5E1' }} />
                      <p className="text-xs" style={{ color: '#94A3B8' }}>No outcome data available.</p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* ─── Demographics: Sex + Age Group ─── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Sex Distribution Pie Chart */}
              <div className="rounded-xl overflow-hidden" style={{ background: '#ffffff', border: '1px solid #E2E8F0' }}>
                <div className="flex items-center justify-between px-5 py-4">
                  <div className="flex items-center gap-3">
                    <div className="w-1 h-8 rounded-full" style={{ background: '#2563EB' }} />
                    <div>
                      <h3 className="text-sm font-bold" style={{ color: '#1E293B' }}>Cases by Sex</h3>
                      <p className="text-[11px] mt-0.5" style={{ color: '#94A3B8' }}>TB case distribution by sex.</p>
                    </div>
                  </div>
                </div>
                <div className="px-5 pb-5">
                  {sexData.length > 0 ? (
                    <div className="flex items-center justify-center gap-6">
                      <div className="w-[180px] h-[180px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={sexData}
                              cx="50%"
                              cy="50%"
                              innerRadius={45}
                              outerRadius={80}
                              paddingAngle={3}
                              dataKey="value"
                            >
                              {sexData.map((entry) => (
                                <Cell key={entry.name} fill={entry.name.toLowerCase() === 'male' ? '#3B82F6' : entry.name.toLowerCase() === 'female' ? '#B48EAD' : '#94A3B8'} />
                              ))}
                            </Pie>
                            <Tooltip formatter={(value) => value.toLocaleString()} />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="space-y-2">
                        {sexData.map((entry) => (
                          <div key={entry.name} className="flex items-center gap-2">
                            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: entry.name.toLowerCase() === 'male' ? '#3B82F6' : entry.name.toLowerCase() === 'female' ? '#B48EAD' : '#94A3B8' }} />
                            <span className="text-xs font-semibold" style={{ color: '#475569' }}>{entry.name}</span>
                            <span className="text-xs font-bold" style={{ color: '#0F2D52' }}>{entry.value.toLocaleString()}</span>
                            <span className="text-[10px]" style={{ color: '#94A3B8' }}>({totalSex > 0 ? ((entry.value / totalSex) * 100).toFixed(1) : 0}%)</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-center py-10" style={{ color: '#94A3B8' }}>No data.</p>
                  )}
                </div>
              </div>

              {/* Age Group Distribution Bar Chart */}
              <div className="rounded-xl overflow-hidden" style={{ background: '#ffffff', border: '1px solid #E2E8F0' }}>
                <div className="flex items-center justify-between px-5 py-4">
                  <div className="flex items-center gap-3">
                    <div className="w-1 h-8 rounded-full" style={{ background: '#7C3AED' }} />
                    <div>
                      <h3 className="text-sm font-bold" style={{ color: '#1E293B' }}>Cases by Age Group</h3>
                      <p className="text-[11px] mt-0.5" style={{ color: '#94A3B8' }}>TB case distribution by age group.</p>
                    </div>
                  </div>
                </div>
                <div className="px-5 pb-5">
                  {ageData.some((d) => d.Cases > 0) ? (
                    <div style={{ height: Math.max(220, ageData.length * 30) }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={ageData} layout="vertical" margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#E8ECF1" />
                          <XAxis type="number" tick={{ fontSize: 10, fill: '#94A3B8' }} axisLine={false} tickLine={false} tickMargin={4} />
                          <YAxis type="category" dataKey="group" tick={{ fontSize: 10, fill: '#64748B', fontWeight: 500 }} axisLine={false} tickLine={false} width={50} tickMargin={4} />
                          <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(0,0,0,0.02)' }} />
                          <Bar dataKey="Cases" radius={[0, 6, 6, 0]} barSize={16} name="Cases">
                            {ageData.map((entry, i) => (
                              <Cell key={entry.group} fill={`hsl(250, 40%, ${55 + i * 5}%)`} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <p className="text-sm text-center py-10" style={{ color: '#94A3B8' }}>No age data available for the selected filters.</p>
                  )}
                </div>
              </div>
            </div>

          </div>

          {/* ─── RIGHT COLUMN: Sticky NLG Insight Panel ─── */}
          <div className="w-[420px] shrink-0 hidden lg:block">
            <div className="sticky top-4">
              <AiInsightPanel
                type="analytics"
                data={insightData}
                loading={insightLoading}
                error={insightError}
                onRetry={handleGenerateInsight}
                onGenerate={handleGenerateInsight}
              />
            </div>
          </div>
        </div>
        </>
      )}
    </div>
  );
}

