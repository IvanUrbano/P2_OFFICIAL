import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  ComposedChart, BarChart, Bar, Line, PieChart, Pie, Cell,
  CartesianGrid, XAxis, YAxis, Tooltip,
  ResponsiveContainer,
} from 'recharts';
import API from '../api/axios';
import AnalyticsInsightPanel from '../components/AnalyticsInsightPanel';
import ChartInsight from '../components/ChartInsight';
import { trendInsight, caseTrendInsight, rankingInsight, incidenceInsight, shareInsight, outcomeInsight } from '../utils/chartInsights';
import OutcomeStatusPanel from '../components/OutcomeStatusPanel';
import FilterSelect from '../components/FilterSelect';
import { latestCompleteYear, incidencePer100k } from '../utils/analyticsKpis';
import { getAnalyticsInsight } from '../services/insightService';
import {
  APPROVED_OUTCOMES,
} from '../utils/outcomeStatus';
import {
  categorizeAge,
  matchesNonYearFilters,
  buildMonthlySeries,
  buildCaseTrendComparison,
  buildPreviousYearComparison,
  mergeComparison,
} from '../utils/trendComparison';

/* ─── Constants ──────────────────────────────────────────────────────── */

// Canonical risk_class values from barangay_risk_scores are High/Medium/Low;
// 'Medium' is shown as "Moderate" here exactly as on the GIS page. Anything
// else means the snapshot never assessed that barangay — "No Assessment",
// never "Low".
const RISK_DISPLAY = { High: 'High', Medium: 'Moderate', Low: 'Low' };
const riskDisplay = (cls) => RISK_DISPLAY[cls] || 'No Assessment';
// Same palette the choropleth legend uses. 'Low' is rendered a shade deeper
// than the map's #FBBF24 so the text stays legible on a white card.
const RISK_CLASS_COLORS = { High: '#EF4444', Medium: '#F97316', Low: '#B45309' };

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

// Categories, order and colours come from the single shared frontend contract
// (src/utils/outcomeStatus.js), which mirrors the backend's
// outcomeNormalization.js — not a private copy per page.
const OUTCOME_ORDER = APPROVED_OUTCOMES;

const AGE_GROUP_ORDER = ['0-14', '15-24', '25-34', '35-44', '45-54', '55-64', '65+'];


/* ─── Helper Components ──────────────────────────────────────────────── */

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="border border-[#E2E8F0] bg-white px-3 py-2 text-xs shadow-sm" style={{
      background: '#ffffff',
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
  /* Nonce re-triggering the metric-card effects (TSR/CFR/population)
   * on header Refresh — their deps are filter values only, so identical
   * filters would otherwise never refetch. */
  const [refreshTick, setRefreshTick] = useState(0);
  const [error, setError] = useState(null);

  /* Raw data from API */
  const [allCases, setAllCases] = useState([]);
  const [barangays, setBarangays] = useState([]);
  const [riskData, setRiskData] = useState([]);
  const [riskYear, setRiskYear] = useState(null);
  const [filterOptions, setFilterOptions] = useState({ sex: [], bacteriological_status: [], outcome_status: [] });

  /* Filter state */
  const [filterYear, setFilterYear] = useState('');
  const [filterMonth, setFilterMonth] = useState('');
  const [filterBarangay, setFilterBarangay] = useState('');
  const [filterOutcome, setFilterOutcome] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterSex, setFilterSex] = useState('');
  const [filterAgeGroup, setFilterAgeGroup] = useState('');
  const [filterBact, setFilterBact] = useState('');
  const [applied, setApplied] = useState(false);

  /* Applied filter state */
  const [aYear, setAYear] = useState('');
  const [aMonth, setAMonth] = useState('');
  const [aBarangay, setABarangay] = useState('');
  const [aOutcome, setAOutcome] = useState('');
  const [aStatus, setAStatus] = useState('');
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
  const [tsrData, setTsrData] = useState(null);
  const [prevTsrData, setPrevTsrData] = useState(null);
  const [cfrData, setCfrData] = useState(null);

  /* ── Data fetching ── */
  const loadAll = useCallback(async () => {
    try {
      setError(null);
      // Every case, but only the fields this page computes from (no identifiers).
      const [allCasesRes, brgyRes, riskRes, filterRes] = await Promise.all([
        API.get('/api/tb/cases/analytics-dataset'),
        API.get('/api/tb/barangays'),
        API.get('/api/tb/gis/choropleth'),
        API.get('/api/tb/filter-options').catch(() => ({ data: {} })),
      ]);
      setAllCases(allCasesRes.data.cases || []);
      setBarangays(brgyRes.data.barangays || brgyRes.data || []);
      setRiskData(riskRes.data.choropleth || []);
      // Assessment year of the risk snapshot returned by /gis/choropleth
      // (this call sends no ?year, so it is always the latest snapshot).
      // Retained for the KPI's hover text: this is a per-year assessment,
      // not an all-time count.
      setRiskYear(riskRes.data.assessment_year ?? riskRes.data.year ?? null);
      setFilterOptions(filterRes.data || {});
    } catch (err) {
      if (import.meta.env.DEV) console.error('Analytics fetch error:', err);
      setError('Failed to load analytics data. Make sure the backend is running.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
    window.addEventListener('focus', loadAll);
    return () => window.removeEventListener('focus', loadAll);
  }, [loadAll]);

  /* ── Apply filters ── */
  const handleApply = useCallback(() => {
    setAYear(filterYear);
    setAMonth(filterMonth);
    setABarangay(filterBarangay);
    setAOutcome(filterOutcome);
    setAStatus(filterStatus);
    setASex(filterSex);
    setAAgeGroup(filterAgeGroup);
    setABact(filterBact);
    setApplied(true);
  }, [filterYear, filterMonth, filterBarangay, filterOutcome, filterStatus, filterSex, filterAgeGroup, filterBact]);

  const handleClear = useCallback(() => {
    setFilterYear('');
    setFilterMonth('');
    setFilterBarangay('');
    setFilterOutcome('');
    setFilterStatus('');
    setFilterSex('');
    setFilterAgeGroup('');
    setFilterBact('');
    setAYear('');
    setAMonth('');
    setABarangay('');
    setAOutcome('');
    setAStatus('');
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
        outcome: aOutcome,
        status: aStatus,
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
  }, [insightLoading, aYear, aMonth, aBarangay, aOutcome, aStatus, aSex, aAgeGroup, aBact]);

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
  }, [aYear, aBarangay, aSex, aAgeGroup, aBact, refreshTick]);

  /* ── Case Fatality Rate — shared backend calculation ──
   * GET /api/tb/case-fatality-rate: DIED / evaluated terminal outcomes,
   * scoped by diagnosis year (same year semantics as Total Cases / On Treatment),
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
  }, [aYear, aMonth, aBarangay, aSex, aAgeGroup, aBact, refreshTick]);

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
  }, [aYear, aBarangay, aSex, aAgeGroup, aBact, refreshTick]);

  /* ── Year-matched population (for Incidence per 100k) ──
   * Incidence must divide a year's cases by THAT SAME year's population
   * (populationService.computeYearIncidence's rule, already used correctly
   * by GIS) — never a flat, undated population figure. "All Years" has no
   * single matching year, so incidence is N/A there by design. */
  const [yearPopulationMap, setYearPopulationMap] = useState({});
  // The year the Incidence card reports: the selected year, otherwise (All Years, no month filter)
  // the latest COMPLETE year, so the card is not empty on first load and never divides a partial
  // year's cases by a full year's population. The card names the year it uses.
  const latestFullYear = useMemo(() => latestCompleteYear(allCases), [allCases]);
  const incidenceYear = aYear || (aMonth ? '' : latestFullYear);
  useEffect(() => {
    let cancelled = false;
    if (!incidenceYear) { setYearPopulationMap({}); return undefined; }
    (async () => {
      try {
        const res = await API.get(`/api/tb/population/${incidenceYear}`);
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
  }, [incidenceYear, refreshTick]);

  /* ── Remove a single filter chip ── */
  const removeFilter = useCallback((key) => {
    const setters = {
      year: () => { setFilterYear(''); setAYear(''); },
      month: () => { setFilterMonth(''); setAMonth(''); },
      barangay: () => { setFilterBarangay(''); setABarangay(''); },
      outcome: () => { setFilterOutcome(''); setAOutcome(''); },
      status: () => { setFilterStatus(''); setAStatus(''); },
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
  const availableMonths = useMemo(() => [...new Set(allCases
    .filter(c => c.date_of_diagnosis && (!filterYear || String(new Date(c.date_of_diagnosis).getFullYear()) === filterYear))
    .map(c => new Date(c.date_of_diagnosis).getMonth() + 1))]
    .filter(Number.isInteger).sort((a, b) => a - b), [allCases, filterYear]);
  const availableAgeGroups = useMemo(() => new Set(allCases.map(c => categorizeAge(c.age))), [allCases]);

  /* ── Filtered cases ──
     Non-year filters go through the shared `matchesNonYearFilters`
     predicate — the SAME one the previous-year comparison uses, so both
     years of the trend chart can never diverge. Year/month stay here. */
  const filteredCases = useMemo(() => {
    if (!applied) return allCases;
    return allCases.filter((c) => {
      if (!matchesNonYearFilters(c, {
        barangay: aBarangay,
        outcome: aOutcome,
        status: aStatus,
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
  }, [allCases, applied, aYear, aMonth, aBarangay, aOutcome, aStatus, aSex, aAgeGroup, aBact]);

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
        outcome: aOutcome,
        status: aStatus,
        sex: aSex,
        ageGroup: aAgeGroup,
        bacteriological: aBact,
      });
    });
  }, [allCases, aYear, aMonth, aBarangay, aOutcome, aStatus, aSex, aAgeGroup, aBact]);

  /* ── Summary Metrics ── */
  const metrics = useMemo(() => {
    const total = filteredCases.length;
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
    // City-wide classification breakdown for the SAME snapshot
    const selectedRiskClass = aBarangay
      ? riskData.find((r) => r.name === aBarangay)?.risk_class || null
      : null;
    // 0 rows, or a snapshot in which nothing was ever assessed, must read
    // "no risk assessment available yet" — never a fabricated "0 of 30".
    const hasRiskData = riskData.some(
      (r) => r.risk_class && (r.risk_class || '').trim().toLowerCase() !== 'no data'
    );
    const totalBarangays = riskData.length || 30;
    // Incidence per 100k: that year's cases / that same year's population x 100,000 (see
    // utils/analyticsKpis.js). The year is the selected one, else the latest complete year.
    const incidence = incidencePer100k(filteredCases, incidenceYear, yearPopulationMap, aBarangay);
    const fatalityRate = cfrData?.rate != null ? cfrData.rate.toFixed(1) : null;
    return {
      total, successRate, highRisk, incidence, fatalityRate,
      hasRiskData, totalBarangays, selectedRiskClass,
    };
  }, [filteredCases, riskData, aBarangay, incidenceYear, tsrData, cfrData, yearPopulationMap]);

  /* ── Previous year metrics (for trend badges) ── */
  const previousMetrics = useMemo(() => {
    const total = previousYearCases.length;
    // Same cohort-based TSR, for the year before the selected one — see the
    // prevTsrData fetch above (year: aYear-1, so its own cohort is aYear-2).
    const successRate = prevTsrData?.successRate != null ? prevTsrData.successRate.toFixed(1) : null;
    return { total, successRate };
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
        outcome: aOutcome,
        status: aStatus,
        sex: aSex,
        ageGroup: aAgeGroup,
        bacteriological: aBact,
      },
    });
  }, [compareYear, aYear, aMonth, allCases, aBarangay, aOutcome, aStatus, aSex, aAgeGroup, aBact]);

  /* ── Merged YoY trend data ──
     Merges by remapped month key ("2023-10" → "2024-10") and stores the
     count under the EXACT key the chart's dataKey reads
     (`Previous Year (YYYY)`). Unavailable comparison → current rows are
     returned untouched (no previous-year key → no dashed line). */
  const mergedTrendData = useMemo(() => {
    if (!compareYear || !previousComparison.available) return trendData;
    return mergeComparison(trendData, previousComparison);
  }, [compareYear, trendData, previousComparison]);

  /* Compare each year's reported months with those same months in the prior
     year. Period filters are intentionally excluded so incomplete years are
     compared on matching available coverage instead of against full years. */
  const caseTrendComparison = useMemo(() => buildCaseTrendComparison(allCases, {
    filters: {
      barangay: aBarangay,
      outcome: aOutcome,
      status: aStatus,
      sex: aSex,
      ageGroup: aAgeGroup,
      bacteriological: aBact,
    },
  }), [allCases, aBarangay, aOutcome, aStatus, aSex, aAgeGroup, aBact]);

  /* ── TB Cases by Barangay ──
   * Only Pasig residents appear here. A Non-Pasig resident treated at a Pasig
   * facility has no Pasig barangay (barangay_name is NULL) and belongs to no
   * population denominator, so they are counted in the city-wide totals above
   * but never folded into a barangay bar or an incidence figure. */
  const barangayData = useMemo(() => {
    const byBarangay = {};
    filteredCases.forEach((c) => {
      if (!c.barangay_name) return;
      const name = c.barangay_name;
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
  const rankedBarangayChartData = useMemo(() => {
    const key = incidenceViewActive ? 'Incidence' : 'Cases';
    return [...barangayIncidenceData].sort((a, b) => (b[key] ?? -1) - (a[key] ?? -1));
  }, [barangayIncidenceData, incidenceViewActive]);
  const barangayChartValueKey = incidenceViewActive ? 'Incidence' : 'Cases';
  const barangayChartMaximum = Math.max(1, ...rankedBarangayChartData.map((row) => Number(row[barangayChartValueKey]) || 0));
  const barangayChartColor = incidenceViewActive ? '#C24146' : '#2E6FAF';
  const barangayChartMaximumLabel = barangayChartMaximum.toLocaleString('en-US', { maximumFractionDigits: 1 });

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

  /* ── Case status (current state; never an outcome) ── */
  const statusCounts = useMemo(() => ({
    diagnosed: filteredCases.filter((c) => c.case_status === 'DIAGNOSED').length,
    onTreatment: filteredCases.filter((c) => c.case_status === 'ON TREATMENT').length,
  }), [filteredCases]);

  /* ── Treatment Outcomes ── */
  const outcomeData = useMemo(() => {
    const byOutcome = {};
    filteredCases.forEach((c) => {
      const raw = (c.outcome_status || 'Unknown').toUpperCase();
      // Map DB variants to source-aligned display form
      const status = raw;
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
    if (aMonth) chips.push({ key: 'month', label: 'Month', value: new Date(2000, Number(aMonth) - 1, 1).toLocaleDateString('en-US', { month: 'long' }) });
    if (aBarangay) chips.push({ key: 'barangay', label: 'Barangay', value: aBarangay });
    if (aOutcome) chips.push({ key: 'outcome', label: 'Treatment Outcome', value: aOutcome });
    if (aStatus) chips.push({ key: 'status', label: 'Case Status', value: aStatus });
    if (aSex) chips.push({ key: 'sex', label: 'Sex', value: aSex });
    if (aAgeGroup) chips.push({ key: 'age', label: 'Age Group', value: aAgeGroup });
    if (aBact) chips.push({ key: 'bacterio', label: 'Bacterio', value: aBact });
    return chips;
  }, [aYear, aMonth, aBarangay, aOutcome, aStatus, aSex, aAgeGroup, aBact]);

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
            <FilterSelect label="Year" value={filterYear} onChange={value => { setFilterYear(value); setFilterMonth(''); }}>
              <option value="">All Years</option>
              {availableYears.map((y) => <option key={y} value={y}>{y}</option>)}
            </FilterSelect>
            <FilterSelect label="Month" value={filterMonth} onChange={setFilterMonth}>
              <option value="">All Months</option>
              {availableMonths.map(m => <option key={m} value={String(m)}>{new Date(2000, m - 1, 1).toLocaleDateString('en-US', { month: 'long' })}</option>)}
            </FilterSelect>
            <FilterSelect label="Barangay" value={filterBarangay} onChange={setFilterBarangay} selectStyle={{ maxWidth: 140 }}>
              <option value="">All Barangays</option>
              {barangayNames.map((n) => <option key={n} value={n}>{n}</option>)}
            </FilterSelect>
            <FilterSelect label="Treatment Outcome" value={filterOutcome} onChange={setFilterOutcome} selectStyle={{ maxWidth: 150 }}>
              <option value="">All</option>
              {(filterOptions.outcome_status || []).map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </FilterSelect>
            <FilterSelect label="Case Status" value={filterStatus} onChange={setFilterStatus} selectStyle={{ maxWidth: 150 }}>
              <option value="">All</option>
              {(filterOptions.case_status || []).map(status => <option key={status} value={status}>{status}</option>)}
            </FilterSelect>
            <FilterSelect label="Sex" value={filterSex} onChange={setFilterSex}>
              <option value="">All</option>
              {(filterOptions.sex || []).map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </FilterSelect>
            <FilterSelect label="Age" value={filterAgeGroup} onChange={setFilterAgeGroup}>
              <option value="">All Ages</option>
              {AGE_GROUP_ORDER.filter(g => availableAgeGroups.has(g)).map((g) => <option key={g} value={g}>{g}</option>)}
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
                <div className="flex items-start gap-2 min-h-5 min-w-0">
                  <i className="ri-file-list-3-line text-sm shrink-0" style={{ color: '#6B7FA3' }} />
                  <span className="text-[10px] font-bold uppercase tracking-wider leading-tight" style={{ color: '#64748B' }}>Total TB Cases ({aYear || 'All Years'})</span>
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
              <div
                className="flex flex-col px-4 py-4 relative"
                title="Cases ÷ Population × 100,000 — cases diagnosed in the year shown over that same year's population. With All Years selected it shows the latest complete year."
              >
                <div className="flex items-start gap-2 min-h-5 min-w-0">
                  <i className="ri-pulse-line text-sm shrink-0" style={{ color: '#6B9E9E' }} />
                  <span className="text-[10px] font-bold uppercase tracking-wider leading-tight" style={{ color: '#64748B' }}>Incidence / 100k ({incidenceYear || 'All Years'})</span>
                </div>
                <div className="h-px my-3" style={{ background: '#E2E8F0' }} />
                <p className="text-2xl lg:text-3xl font-extrabold" style={{ color: '#0F2D52' }}>{metrics.incidence == null ? 'N/A' : metrics.incidence}</p>
                <span className="text-[11px] font-medium mt-1" style={{ color: '#94A3B8' }}>
                  {!incidenceYear
                    ? 'Select a year — not applicable across combined years'
                    : metrics.incidence == null
                      ? 'No matching population data'
                      : aYear ? `${aYear} cases per 100,000 population` : `Latest complete year — select a year to change`}
                </span>
                <div className="hidden lg:block absolute right-0 top-1/2 -translate-y-1/2 w-px h-10" style={{ background: '#E2E8F0' }} />
              </div>

              {/* Treatment Success Rate (TSR) */}
              <div className="flex flex-col px-4 py-4 relative" title="TSR is a cohort-based indicator: (Cured + Treatment Completed) among patients whose treatment started in the previous year, divided by the total previous-year treatment cohort.">
                <div className="flex items-start justify-between gap-2 min-h-5">
                  <div className="flex items-start gap-2 min-w-0">
                    <i className="ri-check-double-line text-sm shrink-0" style={{ color: '#6B9E8A' }} />
                    <span className="text-[10px] font-bold uppercase tracking-wider leading-tight" style={{ color: '#64748B' }}>
                      {(tsrData?.cohortYear || aYear)
                        ? `Treatment Success Rate — ${tsrData?.cohortYear || Number(aYear) - 1} Cohort`
                        : 'Treatment Success Rate'}
                    </span>
                  </div>
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

              {/* Lost to Follow-up — the same treatment cohort as the Success Rate, so the two
                  describe the same patients (2025 cohort: 81.2% succeeded, 6.6% lost to follow-up). */}
              <div className="flex flex-col px-4 py-4 relative" title="Lost to follow-up among patients whose treatment started in the previous year (the same cohort as the Treatment Success Rate), divided by the whole cohort.">
                <div className="flex items-start gap-2 min-h-5 min-w-0">
                  <i className="ri-user-unfollow-line text-sm shrink-0" style={{ color: '#8B7BA3' }} />
                  <span className="text-[10px] font-bold uppercase tracking-wider leading-tight" style={{ color: '#64748B' }}>
                    {(tsrData?.cohortYear || aYear)
                      ? `Lost to Follow-up — ${tsrData?.cohortYear || Number(aYear) - 1} Cohort`
                      : 'Lost to Follow-up'}
                  </span>
                </div>
                <div className="h-px my-3" style={{ background: '#E2E8F0' }} />
                <div className="flex items-end gap-1.5 flex-wrap">
                  <p className="text-2xl lg:text-3xl font-extrabold" style={{ color: '#0F2D52' }}>{tsrData?.ltfuRate == null ? 'N/A' : `${tsrData.ltfuRate}%`}</p>
                  {aYear && tsrData?.ltfuRate != null && prevTsrData?.ltfuRate != null &&
                    <TrendBadge current={Number(tsrData.ltfuRate)} previous={Number(prevTsrData.ltfuRate)} inverse={true} />}
                </div>
                {tsrData?.ltfuRate != null && (
                  <span className="text-[10px] font-medium mt-1" style={{ color: '#94A3B8' }}>
                    {(tsrData.cohortLtfu || 0).toLocaleString()} of {(tsrData.cohortTotal || 0).toLocaleString()} patients
                  </span>
                )}
                {(aMonth || aOutcome) && (
                  <span className="text-[9px] mt-1 flex items-center gap-1" style={{ color: '#94A3B8' }}>
                    <i className="ri-information-line" />
                    Excludes Month and Outcome filters (annual cohort indicator)
                  </span>
                )}
                <div className="hidden lg:block absolute right-0 top-1/2 -translate-y-1/2 w-px h-10" style={{ background: '#E2E8F0' }} />
              </div>

              {/* Case Fatality Rate */}
              <div className="flex flex-col px-4 py-4 relative">
                <div className="flex items-start gap-2 min-h-5 min-w-0">
                  <i className="ri-heart-pulse-line text-sm shrink-0" style={{ color: '#B07070' }} />
                  <span className="text-[10px] font-bold uppercase tracking-wider leading-tight" style={{ color: '#64748B' }}>Case Fatality Rate ({aYear || 'All Years'})</span>
                </div>
                <div className="h-px my-3" style={{ background: '#E2E8F0' }} />
                <p className="text-2xl lg:text-3xl font-extrabold" style={{ color: '#0F2D52' }}>{metrics.fatalityRate == null ? 'N/A' : `${metrics.fatalityRate}%`}</p>
                <span className="text-[11px] font-medium mt-1" style={{ color: '#94A3B8' }}>Deaths / evaluated terminal outcomes{aYear ? ` — ${aYear} diagnoses` : ''}</span>
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

              {/* Keep the risk KPI focused on the headline classification. */}
              <div className="flex flex-col px-4 py-4">
                <div className="flex items-start gap-2 min-h-5 min-w-0">
                  <i className="ri-alarm-warning-line text-sm shrink-0" style={{ color: '#C4886A' }} />
                  <span className="text-[10px] font-bold uppercase tracking-wider leading-tight" style={{ color: '#64748B' }}>
                    {aBarangay ? `${aBarangay} Risk Classification` : 'High-Risk Barangays'}
                  </span>
                </div>
                <div className="h-px my-3" style={{ background: '#E2E8F0' }} />
                {!metrics.hasRiskData ? (
                  <>
                    <p className="text-2xl lg:text-3xl font-extrabold" style={{ color: '#0F2D52' }}>N/A</p>
                    <span className="text-[11px] font-medium mt-1 leading-snug" style={{ color: '#94A3B8' }}>
                      No risk assessment available yet
                    </span>
                  </>
                ) : aBarangay ? (
                  /* Barangay filter active: this card shows that barangay's
                     own classification. The city-wide counts are hidden — a
                     filtered 0/1 sitting next to city totals would be
                     contradictory, and the period is already in the heading. */
                  <>
                    <p
                      className="text-xl lg:text-2xl font-extrabold"
                      style={{ color: RISK_CLASS_COLORS[metrics.selectedRiskClass] || '#64748B' }}
                    >
                      {riskDisplay(metrics.selectedRiskClass)}
                    </p>
                    <span className="text-[11px] font-medium mt-1 leading-snug" style={{ color: '#94A3B8' }}>
                      City-wide breakdown hidden by the barangay filter
                    </span>
                  </>
                ) : (
                  <>
                    <p className="text-2xl lg:text-3xl font-extrabold" style={{ color: '#0F2D52' }}>{metrics.highRisk}</p>
                    <span
                      className="text-[11px] font-medium mt-1 leading-snug"
                      style={{ color: '#94A3B8' }}
                      title={`Pasig barangays classified as High Risk in the ${riskYear || 'latest'} assessment.`}
                    >
                      of {metrics.totalBarangays} barangays classified as High Risk
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-6 xl:flex-row">
            {/* Charts */}
            <div className="flex-1 min-w-0 space-y-6">

          {/* ─── TB Cases Trend (with YoY Comparison) ─── */}
          <div className="overflow-hidden rounded-lg border border-[#E2E8F0] bg-white">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E2E8F0] px-5 py-4">
              <div className="flex items-center gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-[#0F2D52]">TB case trend</h3>
                  <p className="mt-1 text-xs text-[#64748B]">Monthly reported cases for the selected period.</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-3 mr-2">
                  <div className="flex items-center gap-1.5">
                    <span className="h-0 w-6 border-t-2 border-[#2E6FAF]" />
                    <span className="text-[11px] font-medium" style={{ color: '#64748B' }}>Cases</span>
                  </div>
                  {compareYear && prevYearLabel && previousComparison.available && (
                    <div className="flex shrink-0 items-center gap-1.5">
                      <span className="w-4 h-0 border-t-2" style={{ borderColor: '#CBD5E1', borderStyle: 'dashed' }} />
                      <span className="text-[11px] font-medium" style={{ color: '#94A3B8' }}>Previous Year ({prevYearLabel})</span>
                    </div>
                  )}
                </div>
                {aYear && (
                  <button type="button" onClick={() => setCompareYear(!compareYear)} aria-pressed={compareYear}
                    className="rounded border border-[#CBD5E1] bg-white px-2.5 py-1 text-xs font-medium text-[#0F2D52] hover:bg-[#F8FAFC] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0F2D52]">
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
                      <CartesianGrid vertical={false} stroke="#E8EDF2" />
                      <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#94A3B8' }} axisLine={false} tickLine={false} tickMargin={6} />
                      <YAxis tick={{ fontSize: 12, fill: '#94A3B8' }} axisLine={false} tickLine={false} width={40} tickMargin={4} />
                      <Tooltip content={<ChartTooltip />} cursor={{ stroke: '#E2E8F0', strokeWidth: 1 }} />
                      <Line type="monotone" dataKey="Cases" stroke="#2E6FAF" strokeWidth={2} dot={{ fill: '#2E6FAF', r: 2.5, strokeWidth: 0 }} activeDot={{ r: 4, strokeWidth: 2, stroke: '#ffffff' }} name="Cases" connectNulls={false} isAnimationActive={false} />
                      {compareYear && prevYearLabel && previousComparison.available && (
                        <Line type="monotone" dataKey={`Previous Year (${prevYearLabel})`} stroke="#CBD5E1" strokeWidth={1.5} strokeDasharray="6 4" dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: '#ffffff' }} name={`Previous Year (${prevYearLabel})`} connectNulls />
                      )}
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="text-sm text-center py-10" style={{ color: '#94A3B8' }}>No trend data available for the selected filters.</p>
              )}
              <ChartInsight text={trendInsight(trendData, { valueKey: 'Cases' })} plain />
              {compareYear && aYear && !previousComparison.available && (
                <p className="text-[11px] mt-2 text-center" style={{ color: '#94A3B8' }}>
                  <i className="ri-information-line" /> Previous-year comparison unavailable due to incomplete {prevYearLabel} data.
                </p>
              )}
            </div>
          </div>

          {/* ─── Case Trend Comparison ─── */}
          <div className="overflow-hidden rounded-lg border border-[#E2E8F0] bg-white">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E2E8F0] px-5 py-4">
              <div className="flex items-center gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-[#0F2D52]">Case trend comparison</h3>
                  <p className="mt-1 text-xs text-[#64748B]">Each year is compared with the same reported months of the previous year.</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-[9px] font-bold uppercase tracking-wider" style={{ color: '#94A3B8' }}>Latest Period Change</p>
                <p
                  className="text-lg font-extrabold"
                  style={{ color: caseTrendComparison.latestPeriod?.changePct == null ? '#94A3B8' : caseTrendComparison.latestPeriod.changePct > 0 ? '#DC2626' : caseTrendComparison.latestPeriod.changePct < 0 ? '#047857' : '#64748B' }}
                >
                  {caseTrendComparison.latestPeriod?.changePct == null
                    ? 'N/A'
                    : `${caseTrendComparison.latestPeriod.changePct > 0 ? '+' : ''}${caseTrendComparison.latestPeriod.changePct}%`}
                </p>
                {caseTrendComparison.latestPeriod && (
                  <p className="text-[9px] mt-0.5" style={{ color: '#94A3B8' }}>
                    {caseTrendComparison.latestPeriod.period} {caseTrendComparison.latestPeriod.year} vs{' '}
                    {caseTrendComparison.latestPeriod.period} {caseTrendComparison.latestPeriod.previousYear}
                  </p>
                )}
              </div>
            </div>
            <div className="px-5 pb-5">
              {caseTrendComparison.rows.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr style={{ background: '#0F2D52', color: '#ffffff' }}>
                        <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider">Year</th>
                        <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-right">Cases</th>
                        <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider">Data Coverage</th>
                        <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-right">Change vs Same Period</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...caseTrendComparison.rows].reverse().map((row) => (
                        <tr key={row.year} style={{ borderBottom: '1px solid #F1F5F9' }}>
                          <td className="px-3 py-2 text-[12px] font-bold" style={{ color: '#0F2D52' }}>{row.year}</td>
                          <td className="px-3 py-2 text-[12px] text-right font-semibold" style={{ color: '#475569' }}>{row.cases.toLocaleString()}</td>
                          <td className="px-3 py-2 text-[11px] font-medium" style={{ color: '#64748B' }}>
                            {row.coverage}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {!row.comparable ? (
                              <span className="text-[10px] font-medium" style={{ color: '#94A3B8' }}>Not enough matching coverage</span>
                            ) : row.changePct == null ? (
                              <span className="text-[11px] font-bold" style={{ color: '#94A3B8' }}>N/A</span>
                            ) : (
                              <span className="text-[11px] font-bold" style={{ color: row.changePct > 0 ? '#DC2626' : row.changePct < 0 ? '#047857' : '#64748B' }}>
                                {row.changePct > 0 ? '+' : ''}{row.changePct}%
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-center py-8" style={{ color: '#94A3B8' }}>No case data available for the selected filters.</p>
              )}
              <ChartInsight text={caseTrendInsight(caseTrendComparison.rows, caseTrendComparison.latestPeriod)} plain />
              <p className="text-[9px] mt-2" style={{ color: '#CBD5E1' }}>
                Changes compare the months with reported cases in each year against those same months in the previous year. A change is shown only when matching month coverage is available.
              </p>
            </div>
          </div>

          {/* ─── TB Cases by Barangay ─── */}
          <div className="overflow-hidden rounded-lg border border-[#E2E8F0] bg-white">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E2E8F0] px-5 py-4">
                <div>
                  <h3 className="text-sm font-semibold text-[#0F2D52]">{incidenceViewActive ? 'TB incidence by barangay' : 'TB cases by barangay'}</h3>
                  <p className="mt-1 text-xs text-[#64748B]">{incidenceViewActive ? 'Cases per 100,000 residents · highest to lowest' : 'Reported cases · highest to lowest'}</p>
                </div>
                <button type="button" onClick={() => setShowIncidence(!showIncidence)} aria-pressed={incidenceViewActive}
                  disabled={!aYear}
                  title={!aYear ? 'Select a specific year to view incidence — not applicable across combined years' : undefined}
                  className="rounded border border-[#CBD5E1] bg-white px-3 py-1.5 text-xs font-medium text-[#0F2D52] hover:border-[#94A3B8] hover:bg-[#F8FAFC] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0F2D52] disabled:cursor-not-allowed disabled:opacity-50">
                  {incidenceViewActive ? 'Show Cases' : 'Show Incidence'}
                </button>
              </div>
              <div className="px-5 pb-5 pt-4">
                {barangayIncidenceData.length > 0 ? (
                  <>
                    <div className="max-h-[320px] overflow-y-auto" tabIndex={0} role="region" aria-label={incidenceViewActive ? 'TB incidence by barangay horizontal bar chart' : 'TB cases by barangay horizontal bar chart'}>
                      <div className="sticky top-0 z-10 grid grid-cols-[minmax(110px,175px)_minmax(0,1fr)_56px] items-end gap-3 border-b border-[#CBD5E1] bg-white pb-2 text-[11px] text-[#64748B]">
                        <span>Barangay</span>
                        <div className="text-right tabular-nums">{barangayChartMaximumLabel}</div>
                        <span className="text-right">{incidenceViewActive ? 'Rate' : 'Cases'}</span>
                      </div>
                      <ol className="divide-y divide-[#E8EDF2]">
                        {rankedBarangayChartData.map((row) => {
                          const value = row[barangayChartValueKey];
                          const width = value == null ? 0 : Math.max(0, (Number(value) / barangayChartMaximum) * 100);
                          return (
                            <li key={row.name} className="grid grid-cols-[minmax(110px,175px)_minmax(0,1fr)_56px] items-center gap-3 py-2.5">
                              <span className="min-w-0 truncate text-xs font-medium text-[#334155]" title={row.name}>{row.name}</span>
                              <span className="relative block h-4 border-l border-[#CBD5E1]" aria-hidden="true">
                                <span className="absolute inset-y-0 left-1/4 border-l border-dashed border-[#E2E8F0]" />
                                <span className="absolute inset-y-0 left-1/2 border-l border-dashed border-[#E2E8F0]" />
                                <span className="absolute inset-y-0 left-3/4 border-l border-dashed border-[#E2E8F0]" />
                                <span className="relative block h-full rounded-r-md" style={{ width: `${width}%`, backgroundColor: barangayChartColor }} />
                              </span>
                              <span className="text-right text-xs font-semibold tabular-nums text-[#0F2D52]">
                                {value == null ? 'N/A' : Number(value).toLocaleString('en-US', { maximumFractionDigits: 1 })}
                              </span>
                            </li>
                          );
                        })}
                      </ol>
                    </div>
                    <p className="mt-2 text-[11px] text-[#64748B]">{rankedBarangayChartData.length} barangays shown{rankedBarangayChartData.length > 7 ? ' · Scroll for more' : ''}{incidenceViewActive ? ' · N/A means no population data for the selected year' : ''}</p>
                  </>
                ) : (
                  <p className="text-sm text-center py-10" style={{ color: '#94A3B8' }}>No barangay data available.</p>
                )}
                <ChartInsight text={incidenceViewActive ? incidenceInsight(barangayIncidenceData) : rankingInsight(barangayIncidenceData, { valueKey: 'Cases' })} plain />
              </div>
            </div>

            {/* ─── Cases by Health Facility + Treatment Outcomes (2:1 row) ─── */}
            <div className={`grid grid-cols-1 gap-6 ${facilityData.length > 0 ? 'lg:grid-cols-3' : ''}`}>
            {facilityData.length > 0 && (
              <div className="lg:col-span-2 overflow-hidden rounded-lg border border-[#E2E8F0] bg-white">
                <div className="border-b border-[#E2E8F0] px-5 py-4">
                  <div className="flex items-center gap-3">
                    <div>
                      <h3 className="text-sm font-semibold text-[#0F2D52]">Cases by health facility</h3>
                      <p className="mt-1 text-xs text-[#64748B]">Top 15 facilities by recorded cases.</p>
                    </div>
                  </div>
                </div>
                <div className="px-5 pb-5">
                  <div className="max-h-[480px] overflow-y-auto" tabIndex={0} role="img" aria-label="TB cases by health facility bar chart">
                    <div style={{ height: Math.max(280, facilityData.length * 30) }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={facilityData} layout="vertical" margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
                        <CartesianGrid horizontal={false} stroke="#E8EDF2" />
                        <YAxis
                          type="category"
                          dataKey="name"
                          interval={0}
                          width={136}
                          tickFormatter={(v) => (String(v).length > 21 ? `${String(v).slice(0, 20)}…` : v)}
                          tick={{ fontSize: 12, fill: '#475569' }}
                          axisLine={false}
                          tickLine={false}
                        />
                        <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12, fill: '#64748B' }} axisLine={false} tickLine={false} />
                        <Tooltip content={<ChartTooltip />} cursor={{ fill: '#F8FAFC' }} />
                        <Bar dataKey="Cases" fill="#6B7FA3" radius={[0, 6, 6, 0]} barSize={12} name="Cases" isAnimationActive={false} />
                      </BarChart>
                    </ResponsiveContainer>
                    </div>
                  </div>
                  <ChartInsight text={rankingInsight(facilityData, { valueKey: 'Cases', noun: 'facility' })} plain />
                </div>
              </div>
            )}

              {/* Treatment Outcomes Pie Chart (aligned beside the facility chart) */}
              <div className="lg:col-span-1 overflow-hidden rounded-lg border border-[#E2E8F0] bg-white">
                <div className="border-b border-[#E2E8F0] px-5 py-4">
                  <div className="flex items-center gap-3">
                    <div>
                      <h3 className="text-sm font-semibold text-[#0F2D52]">Treatment outcomes and case status</h3>
                      <p className="mt-1 text-xs text-[#64748B]">Final outcomes with active cases shown separately.</p>
                    </div>
                  </div>
                </div>
                <div className="px-5 pb-5">
                  <OutcomeStatusPanel
                    outcomes={Object.fromEntries(outcomeData.map((e) => [e.name, e.Cases]))}
                    diagnosed={statusCounts.diagnosed}
                    onTreatment={statusCounts.onTreatment}
                    plain
                  />
                  <ChartInsight text={outcomeInsight(outcomeData)} plain />
                </div>
              </div>
            </div>

            {/* ─── Demographics: Sex + Age Group ─── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Sex Distribution Pie Chart */}
              <div className="overflow-hidden rounded-lg border border-[#E2E8F0] bg-white">
                <div className="flex items-center justify-between border-b border-[#E2E8F0] px-5 py-4">
                  <div className="flex items-center gap-3">
                    <div>
                      <h3 className="text-sm font-semibold text-[#0F2D52]">Cases by sex</h3>
                      <p className="mt-1 text-xs text-[#64748B]">Recorded cases by sex.</p>
                    </div>
                  </div>
                </div>
                <div className="px-5 pb-5">
                  {sexData.length > 0 ? (
                    <div className="flex flex-wrap items-center justify-center gap-6">
                      <div className="w-[180px] h-[180px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={sexData}
                              cx="50%"
                              cy="50%"
                              innerRadius={45}
                              outerRadius={80}
                              paddingAngle={1}
                              dataKey="value"
                            >
                              {sexData.map((entry) => (
                                <Cell key={entry.name} fill={entry.name.toLowerCase() === 'male' ? '#2E6FAF' : entry.name.toLowerCase() === 'female' ? '#6B9E8A' : '#94A3B8'} />
                              ))}
                            </Pie>
                            <Tooltip formatter={(value) => value.toLocaleString()} />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="space-y-2">
                        {sexData.map((entry) => (
                          <div key={entry.name} className="flex items-center gap-2">
                            <span className="h-2.5 w-2.5 shrink-0" style={{ background: entry.name.toLowerCase() === 'male' ? '#2E6FAF' : entry.name.toLowerCase() === 'female' ? '#6B9E8A' : '#94A3B8' }} />
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
                  <ChartInsight text={shareInsight(sexData, { noun: 'sex' })} plain />
                </div>
              </div>

              {/* Age Group Distribution Bar Chart */}
              <div className="overflow-hidden rounded-lg border border-[#E2E8F0] bg-white">
                <div className="flex items-center justify-between border-b border-[#E2E8F0] px-5 py-4">
                  <div className="flex items-center gap-3">
                    <div>
                      <h3 className="text-sm font-semibold text-[#0F2D52]">Cases by age group</h3>
                      <p className="mt-1 text-xs text-[#64748B]">Recorded cases by age group.</p>
                    </div>
                  </div>
                </div>
                <div className="px-5 pb-5">
                  {ageData.some((d) => d.Cases > 0) ? (
                    <div style={{ height: Math.max(220, ageData.length * 30) }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={ageData} layout="vertical" margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#E8ECF1" />
                          <XAxis type="number" tick={{ fontSize: 12, fill: '#94A3B8' }} axisLine={false} tickLine={false} tickMargin={4} />
                          <YAxis type="category" dataKey="group" tick={{ fontSize: 12, fill: '#64748B', fontWeight: 500 }} axisLine={false} tickLine={false} width={50} tickMargin={4} />
                          <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(0,0,0,0.02)' }} />
                          <Bar dataKey="Cases" radius={[0, 6, 6, 0]} barSize={16} name="Cases">
                            {ageData.map((entry) => (
                              <Cell key={entry.group} fill="#6B7FA3" />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <p className="text-sm text-center py-10" style={{ color: '#94A3B8' }}>No age data available for the selected filters.</p>
                  )}
                  <ChartInsight text={shareInsight(ageData, { nameKey: 'group', valueKey: 'Cases', noun: 'age group' })} plain />
                </div>
              </div>
            </div>

          </div>

          {/* Interpretation remains available on smaller screens below the charts. */}
          <div className="w-full shrink-0 xl:w-[360px]">
            <div className="xl:sticky xl:top-4">
              <AnalyticsInsightPanel
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
