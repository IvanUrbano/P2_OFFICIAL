import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  ComposedChart, Bar, Line, Area, PieChart, Pie, Cell,
  CartesianGrid, XAxis, YAxis, Tooltip,
  ResponsiveContainer,
} from 'recharts';
import API from '../api/axios';

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
  'CURED': '#047857',
  'TREATMENT COMPLETED': '#2E6FAF',
  'ON TREATMENT': '#92400E',
  'FAILED': '#991B1B',
  'DIED': '#7F1D1D',
  'LOST TO FOLLOW-UP': '#6B7280',
  'EXCLUDED': '#64748B',
  'NOT EVALUATED': '#94A3B8',
};

const AGE_GROUP_ORDER = ['0-14', '15-24', '25-34', '35-44', '45-54', '55-64', '65+'];

function categorizeAge(age) {
  const n = Number(age);
  if (isNaN(n) || n < 0) return 'Unknown';
  if (n <= 14) return '0-14';
  if (n <= 24) return '15-24';
  if (n <= 34) return '25-34';
  if (n <= 44) return '35-44';
  if (n <= 54) return '45-54';
  if (n <= 64) return '55-64';
  return '65+';
}

const MONTHS = [
  'All Months', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const OUTCOMES = [
  'All Outcomes', 'CURED', 'TREATMENT COMPLETED', 'ON TREATMENT',
  'FAILED', 'DIED', 'LOST TO FOLLOW-UP', 'EXCLUDED', 'NOT EVALUATED',
];

const ACTIVE_OUTCOMES = ['ON TREATMENT'];
const SUCCESS_OUTCOMES = ['CURED', 'TREATMENT COMPLETED'];

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
    <span className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded"
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

/* ─── Filter Select (same as DashboardPage) ─── */
function FilterSelect({ label, value, onChange, children, selectStyle }) {
  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[11px] pointer-events-none whitespace-nowrap" style={{ color: '#94A3B8' }}>{label}:</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg pr-7 py-[7px] text-[11px] font-semibold outline-none transition cursor-pointer appearance-none"
        style={{
          background: '#ffffff',
          color: '#0F2D52',
          border: '1px solid #E2E8F0',
          paddingLeft: `${(label.length * 6.5) + 24}px`,
          ...selectStyle,
        }}
      >
        {children}
      </select>
      <i className="ri-arrow-down-s-line absolute right-2 top-1/2 -translate-y-1/2 text-[10px] pointer-events-none" style={{ color: '#64748B' }} />
    </div>
  );
}

/* ─── Main Analytics Component ───────────────────────────────────────── */

export default function Analytics() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  /* Raw data from API */
  const [allCases, setAllCases] = useState([]);
  const [barangays, setBarangays] = useState([]);
  const [riskData, setRiskData] = useState([]);
  const [forecastsData, setForecastsData] = useState([]);
  const [filterOptions, setFilterOptions] = useState({ sex: [], bacteriological_status: [], outcome_status: [] });

  /* Filter state */
  const [filterYear, setFilterYear] = useState('');
  const [filterMonth, setFilterMonth] = useState('');
  const [filterBarangay, setFilterBarangay] = useState('');
  const [filterOutcome, setFilterOutcome] = useState('');
  const [filterSex, setFilterSex] = useState('');
  const [filterAgeGroup, setFilterAgeGroup] = useState('');
  const [filterBact, setFilterBact] = useState('');
  const [applied, setApplied] = useState(false);

  /* Applied filter state */
  const [aYear, setAYear] = useState('');
  const [aMonth, setAMonth] = useState('');
  const [aBarangay, setABarangay] = useState('');
  const [aOutcome, setAOutcome] = useState('');
  const [aSex, setASex] = useState('');
  const [aAgeGroup, setAAgeGroup] = useState('');
  const [aBact, setABact] = useState('');

  /* Enhancement toggles */
  const [compareYear, setCompareYear] = useState(false);
  const [showIncidence, setShowIncidence] = useState(false);

  /* ── Data fetching ── */
  const loadAll = useCallback(async () => {
    try {
      setError(null);
      const [firstPageRes, brgyRes, riskRes, filterRes, fcRes] = await Promise.all([
        API.get('/api/tb/cases?limit=1'),
        API.get('/api/tb/barangays'),
        API.get('/api/tb/gis/choropleth'),
        API.get('/api/tb/filter-options').catch(() => ({ data: {} })),
        API.get('/api/tb/forecasts').catch(() => ({ data: { forecasts: [] } })),
      ]);
      const totalCases = firstPageRes.data.pagination?.total || 0;
      const allCasesRes = totalCases > 0
        ? await API.get(`/api/tb/cases?limit=${totalCases}`)
        : firstPageRes;
      setAllCases(allCasesRes.data.cases || []);
      setBarangays(brgyRes.data.barangays || brgyRes.data || []);
      setRiskData(riskRes.data.choropleth || []);
      setFilterOptions(filterRes.data || {});
      setForecastsData(fcRes.data.forecasts || []);
    } catch (err) {
      console.error('Analytics fetch error:', err);
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
    setAOutcome(filterOutcome);
    setASex(filterSex);
    setAAgeGroup(filterAgeGroup);
    setABact(filterBact);
    setApplied(true);
  }, [filterYear, filterMonth, filterBarangay, filterOutcome, filterSex, filterAgeGroup, filterBact]);

  const handleClear = useCallback(() => {
    setFilterYear('');
    setFilterMonth('');
    setFilterBarangay('');
    setFilterOutcome('');
    setFilterSex('');
    setFilterAgeGroup('');
    setFilterBact('');
    setAYear('');
    setAMonth('');
    setABarangay('');
    setAOutcome('');
    setASex('');
    setAAgeGroup('');
    setABact('');
    setApplied(false);
  }, []);

  /* ── Remove a single filter chip ── */
  const removeFilter = useCallback((key) => {
    const setters = {
      year: () => { setFilterYear(''); setAYear(''); },
      month: () => { setFilterMonth(''); setAMonth(''); },
      barangay: () => { setFilterBarangay(''); setABarangay(''); },
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

  /* ── Filtered cases ── */
  const filteredCases = useMemo(() => {
    if (!applied) return allCases;
    return allCases.filter((c) => {
      if (aBarangay && c.barangay_name !== aBarangay) return false;
      if (aSex && !(c.sex || '').toLowerCase().includes(aSex.toLowerCase())) return false;
      if (aOutcome && c.outcome_status !== aOutcome) return false;
      if (aBact && !(c.bacteriological_status || '').toLowerCase().includes(aBact.toLowerCase())) return false;
      if (aYear || aMonth) {
        const d = new Date(c.date_of_diagnosis);
        if (isNaN(d.getTime())) return false;
        if (aYear && d.getFullYear() !== Number(aYear)) return false;
        if (aMonth && (d.getMonth() + 1) !== Number(aMonth)) return false;
      }
      if (aAgeGroup) {
        const group = categorizeAge(c.age);
        if (group !== aAgeGroup) return false;
      }
      return true;
    });
  }, [allCases, applied, aYear, aMonth, aBarangay, aOutcome, aSex, aAgeGroup, aBact]);

  /* ── Previous year cases (for trend indicators) ── */
  const previousYearCases = useMemo(() => {
    if (!aYear) return [];
    const prevYear = String(Number(aYear) - 1);
    return allCases.filter((c) => {
      const d = new Date(c.date_of_diagnosis);
      if (isNaN(d.getTime())) return false;
      if (d.getFullYear() !== Number(prevYear)) return false;
      if (aBarangay && c.barangay_name !== aBarangay) return false;
      if (aSex && !(c.sex || '').toLowerCase().includes(aSex.toLowerCase())) return false;
      if (aOutcome && c.outcome_status !== aOutcome) return false;
      if (aBact && !(c.bacteriological_status || '').toLowerCase().includes(aBact.toLowerCase())) return false;
      if (aMonth && (d.getMonth() + 1) !== Number(aMonth)) return false;
      if (aAgeGroup && categorizeAge(c.age) !== aAgeGroup) return false;
      return true;
    });
  }, [allCases, aYear, aMonth, aBarangay, aOutcome, aSex, aAgeGroup, aBact]);

  /* ── Summary Metrics ── */
  const metrics = useMemo(() => {
    const total = filteredCases.length;
    const active = filteredCases.filter((c) => ACTIVE_OUTCOMES.includes((c.outcome_status || '').toUpperCase())).length;
    const withOutcome = filteredCases.filter((c) => c.outcome_status && c.outcome_status !== 'NOT EVALUATED');
    const success = withOutcome.filter((c) => SUCCESS_OUTCOMES.includes(c.outcome_status.toUpperCase())).length;
    const successRate = withOutcome.length > 0 ? ((success / withOutcome.length) * 100).toFixed(1) : '0.0';
    // High-Risk Barangays: filter by selected barangay if set, otherwise count all
    let highRisk = 0;
    const highRiskSet = new Set();
    if (aBarangay) {
      // If a specific barangay is selected, check if it's high risk
      const inForecasts = forecastsData.find((r) => {
        const rc = (r.risk_class || '').toLowerCase();
        return rc === 'high' && r.barangay_name === aBarangay;
      });
      const inRisk = riskData.find((r) => {
        const rc = (r.risk_class || '').toLowerCase();
        return rc === 'high' && r.barangay_name === aBarangay;
      });
      highRisk = (inForecasts || inRisk) ? 1 : 0;
    } else {
      // Count all high-risk barangays
      forecastsData.forEach((r) => {
        const rc = (r.risk_class || '').toLowerCase();
        if (rc === 'high') highRiskSet.add(r.barangay_name);
      });
      if (highRiskSet.size === 0) {
        riskData.forEach((r) => {
          const rc = (r.risk_class || '').toLowerCase();
          if (rc === 'high') highRiskSet.add(r.barangay_name);
        });
      }
      highRisk = highRiskSet.size;
    }
    return { total, active, successRate, highRisk };
  }, [filteredCases, riskData, forecastsData, aBarangay]);

  /* ── Previous year metrics (for trend badges) ── */
  const previousMetrics = useMemo(() => {
    const total = previousYearCases.length;
    const active = previousYearCases.filter((c) => ACTIVE_OUTCOMES.includes((c.outcome_status || '').toUpperCase())).length;
    const withOutcome = previousYearCases.filter((c) => c.outcome_status && c.outcome_status !== 'NOT EVALUATED');
    const success = withOutcome.filter((c) => SUCCESS_OUTCOMES.includes(c.outcome_status.toUpperCase())).length;
    const successRate = withOutcome.length > 0 ? ((success / withOutcome.length) * 100).toFixed(1) : '0.0';
    return { total, active, successRate };
  }, [previousYearCases]);

  /* ── TB Cases Trend (monthly) ── */
  const trendData = useMemo(() => {
    const byMonth = {};
    filteredCases.forEach((c) => {
      if (!c.date_of_diagnosis) return;
      const d = new Date(c.date_of_diagnosis);
      if (isNaN(d.getTime())) return;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (!byMonth[key]) byMonth[key] = 0;
      byMonth[key]++;
    });
    return Object.entries(byMonth)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, count]) => {
        const d = new Date(month + '-01');
        return {
          key: month,
          label: d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
          Cases: count,
        };
      });
  }, [filteredCases]);

  /* ── Previous year trend (for YoY comparison) ── */
  const previousYearTrendData = useMemo(() => {
    if (!compareYear || !aYear) return [];
    const prevYear = String(Number(aYear) - 1);
    const prevCases = allCases.filter((c) => {
      const d = new Date(c.date_of_diagnosis);
      if (isNaN(d.getTime())) return false;
      if (d.getFullYear() !== Number(prevYear)) return false;
      if (aBarangay && c.barangay_name !== aBarangay) return false;
      if (aSex && !(c.sex || '').toLowerCase().includes(aSex.toLowerCase())) return false;
      if (aOutcome && c.outcome_status !== aOutcome) return false;
      if (aBact && !(c.bacteriological_status || '').toLowerCase().includes(aBact.toLowerCase())) return false;
      if (aAgeGroup && categorizeAge(c.age) !== aAgeGroup) return false;
      return true;
    });
    const byMonth = {};
    prevCases.forEach((c) => {
      if (!c.date_of_diagnosis) return;
      const d = new Date(c.date_of_diagnosis);
      if (isNaN(d.getTime())) return;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (!byMonth[key]) byMonth[key] = 0;
      byMonth[key]++;
    });
    return Object.entries(byMonth)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, count]) => {
        const d = new Date(month + '-01');
        return {
          key: month,
          label: d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
          [`Prev (${prevYear})`]: count,
        };
      });
  }, [compareYear, aYear, allCases, aBarangay, aOutcome, aSex, aBact, aAgeGroup]);

  /* ── Merged YoY trend data ── */
  const mergedTrendData = useMemo(() => {
    if (!compareYear || previousYearTrendData.length === 0) return trendData;
    const prevMap = {};
    previousYearTrendData.forEach((d) => { prevMap[d.key] = d; });
    return trendData.map((item) => ({
      ...item,
      [`Prev (${Number(aYear) - 1})`]: prevMap[item.key]?.[`Prev (${Number(aYear) - 1})`] || 0,
    }));
  }, [compareYear, trendData, previousYearTrendData, aYear]);

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

  /* ── Barangay Incidence Data (per 100k) ── */
  const barangayIncidenceData = useMemo(() => {
    const popMap = {};
    barangays.forEach((b) => {
      const name = b.barangay_name || b.name;
      if (name) popMap[name] = Number(b.population) || 0;
    });
    return barangayData.map((d) => {
      const pop = popMap[d.name] || 0;
      return {
        ...d,
        Population: pop,
        Incidence: pop > 0 ? Number(((d.Cases / pop) * 100000).toFixed(1)) : 0,
      };
    });
  }, [barangayData, barangays]);

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
      const status = (c.outcome_status || 'Unknown').toUpperCase();
      if (!byOutcome[status]) byOutcome[status] = 0;
      byOutcome[status]++;
    });
    return Object.entries(byOutcome)
      .map(([name, count]) => ({ name, Cases: count }))
      .sort((a, b) => b.Cases - a.Cases);
  }, [filteredCases]);

  /* ── Active Filter Chips ── */
  const activeFilters = useMemo(() => {
    const chips = [];
    if (aYear) chips.push({ key: 'year', label: 'Year', value: aYear });
    if (aMonth) chips.push({ key: 'month', label: 'Month', value: MONTHS[Number(aMonth)] || aMonth });
    if (aBarangay) chips.push({ key: 'barangay', label: 'Barangay', value: aBarangay });
    if (aOutcome) chips.push({ key: 'outcome', label: 'Outcome', value: aOutcome });
    if (aSex) chips.push({ key: 'sex', label: 'Sex', value: aSex });
    if (aAgeGroup) chips.push({ key: 'age', label: 'Age Group', value: aAgeGroup });
    if (aBact) chips.push({ key: 'bacterio', label: 'Bacterio', value: aBact });
    return chips;
  }, [aYear, aMonth, aBarangay, aOutcome, aSex, aAgeGroup, aBact]);

  /* ── Key Insights ── */
  const insights = useMemo(() => {
    const list = [];
    if (filteredCases.length === 0) return list;

    if (barangayData.length > 0) {
      const top = barangayData[0];
      list.push({
        category: 'HOTSPOT',
        color: '#991B1B',
        stat: top.Cases.toLocaleString(),
        unit: 'cases',
        text: `${top.name} has the highest number of reported TB cases.`,
      });
    }

    if (trendData.length >= 2) {
      const recent = trendData.slice(-3).reduce((s, r) => s + r.Cases, 0) / 3;
      const older = trendData.slice(0, 3).reduce((s, r) => s + r.Cases, 0) / 3;
      if (older > 0) {
        const pct = (((recent - older) / older) * 100).toFixed(0);
        if (pct > 5) list.push({ category: 'TREND', color: '#0D9488', stat: `+${pct}`, unit: '%', text: 'TB cases have increased compared to the earlier period.' });
        else if (pct < -5) list.push({ category: 'TREND', color: '#047857', stat: `${pct}`, unit: '%', text: 'TB cases have decreased compared to the earlier period.' });
        else list.push({ category: 'TREND', color: '#64748B', stat: '~0', unit: '%', text: 'TB cases have remained relatively stable across the selected period.' });
      }
    }

    if (ageData.length > 0) {
      const topAge = ageData.reduce((max, r) => r.Cases > max.Cases ? r : max, ageData[0]);
      if (topAge.Cases > 0) {
        list.push({
          category: 'DEMOGRAPHICS',
          color: '#1E293B',
          stat: topAge.Cases.toLocaleString(),
          unit: 'cases',
          text: `The ${topAge.group} age group accounts for the largest proportion of cases.`,
        });
      }
    }

    if (Number(metrics.successRate) > 0) {
      const rate = Number(metrics.successRate);
      const isBelow = rate < 85;
      list.push({
        category: 'TREATMENT',
        color: isBelow ? '#991B1B' : '#047857',
        stat: metrics.successRate,
        unit: '%',
        text: isBelow ? 'Treatment success rate is currently below target.' : 'Treatment success rate meets the target threshold.',
      });
    }

    if (metrics.highRisk > 0) {
      list.push({
        category: 'HIGH RISK',
        color: '#991B1B',
        stat: String(metrics.highRisk),
        unit: `barangay${metrics.highRisk > 1 ? 's' : ''}`,
        text: `${metrics.highRisk} barangay${metrics.highRisk > 1 ? 's are' : ' is'} currently classified as high risk.`,
      });
    }

    if (sexData.length >= 2) {
      const topSex = sexData[0];
      list.push({
        category: 'DEMOGRAPHICS',
        color: '#1E293B',
        stat: `${((topSex.value / totalSex) * 100).toFixed(0)}`,
        unit: '%',
        text: `${topSex.name} cases account for the majority of all reported TB cases.`,
      });
    }

    if (facilityData.length > 0) {
      const top = facilityData[0];
      list.push({
        category: 'FACILITY LOAD',
         color: '#6B7280',
        stat: top.Cases.toLocaleString(),
        unit: 'cases',
        text: `${top.name} handles the most TB cases among health facilities.`,
      });
    }

    if (barangayIncidenceData.length > 0) {
      const sorted = [...barangayIncidenceData].filter((d) => d.Population > 0).sort((a, b) => b.Incidence - a.Incidence);
      if (sorted.length > 0) {
        list.push({
          category: 'INCIDENCE',
           color: '#92400E',
          stat: sorted[0].Incidence.toLocaleString(),
          unit: 'per 100k',
          text: `${sorted[0].name} has the highest incidence rate among Pasig City barangays.`,
        });
      }
    }

    return list;
  }, [filteredCases, barangayData, trendData, ageData, metrics, sexData, totalSex, facilityData, barangayIncidenceData]);

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

  /* ── Error state ── */
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: '#FEF2F2' }}>
          <i className="ri-error-warning-line text-3xl" style={{ color: COLORS.red }} />
        </div>
        <span className="text-sm font-medium" style={{ color: '#64748B' }}>{error}</span>
        <button onClick={loadAll} className="text-xs font-medium px-5 py-2.5" style={{ background: '#F3F4F6', color: '#374151', border: '1px solid #D1D5DB', borderRadius: 4, transition: 'background 0.15s, color 0.15s, border-color 0.15s, opacity 0.15s' }} onMouseEnter={e => { e.currentTarget.style.background = '#E5E7EB'; }} onMouseLeave={e => { e.currentTarget.style.background = '#F3F4F6'; }}>Retry</button>
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
            <span className="text-[11px] font-medium mr-2" style={{ color: '#94A3B8' }}>
              Last updated: {lastUpdated}
            </span>
            <button onClick={() => {
              if (!filteredCases.length) return;
              const escapeCSV = (val) => {
                const s = String(val == null ? '' : val);
                if (s.includes(',') || s.includes('"') || s.includes('\n')) {
                  return '"' + s.replace(/"/g, '""') + '"';
                }
                return s;
              };
              const headers = ['Barangay', 'Sex', 'Age', 'Date of Diagnosis', 'Outcome', 'Bacteriological Status'];
              const rows = filteredCases.map((c) => [c.barangay_name, c.sex, c.age, c.date_of_diagnosis, c.outcome_status, c.bacteriological_status]);
              const csv = [headers.map(escapeCSV).join(','), ...rows.map((r) => r.map(escapeCSV).join(','))].join('\n');
              const blob = new Blob([csv], { type: 'text/csv' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `tb-analytics-${aYear || 'all'}.csv`;
              a.click();
              URL.revokeObjectURL(url);
            }} className="text-xs font-semibold px-4 py-2" style={{ background: '#0F2D52', color: '#ffffff', border: '1px solid #0F2D52', borderRadius: 4, transition: 'background 0.15s, color 0.15s, border-color 0.15s, opacity 0.15s' }} onMouseEnter={e => { e.currentTarget.style.background = '#174A7E'; e.currentTarget.style.borderColor = '#174A7E'; }} onMouseLeave={e => { e.currentTarget.style.background = '#0F2D52'; e.currentTarget.style.borderColor = '#0F2D52'; }}>
              Download CSV
            </button>
          </div>
        </div>

        {/* Filter bar */}
        <div className="flex items-center justify-between px-6 py-3" style={{ background: '#F8FAFC', borderTop: '1px solid #E2E8F0' }}>
          <div className="flex items-center gap-1.5 flex-wrap">
            <FilterSelect label="Year" value={filterYear} onChange={setFilterYear}>
              <option value="">All Years</option>
              {availableYears.map((y) => <option key={y} value={y}>{y}</option>)}
            </FilterSelect>
            <FilterSelect label="Month" value={filterMonth} onChange={setFilterMonth}>
              {MONTHS.map((m, i) => <option key={m} value={i === 0 ? '' : String(i)}>{m}</option>)}
            </FilterSelect>
            <FilterSelect label="Barangay" value={filterBarangay} onChange={setFilterBarangay} selectStyle={{ maxWidth: 160 }}>
              <option value="">All Barangays</option>
              {barangayNames.map((n) => <option key={n} value={n}>{n}</option>)}
            </FilterSelect>
            <FilterSelect label="Outcome" value={filterOutcome} onChange={setFilterOutcome} selectStyle={{ maxWidth: 160 }}>
              <option value="">All Outcomes</option>
              {(filterOptions.outcome_status || OUTCOMES.filter(o => o !== 'All Outcomes')).map((o) => (
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
            <FilterSelect label="Bacterio" value={filterBact} onChange={setFilterBact} selectStyle={{ maxWidth: 180 }}>
              <option value="">All</option>
              {(filterOptions.bacteriological_status || []).map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </FilterSelect>
          </div>
          <div className="flex items-center gap-1.5">
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
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
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
          {/* ─── Metric Cards (with Trend Indicators) ─── */}
          <div className="rounded-xl" style={{ background: '#ffffff', boxShadow: '0 4px 24px rgba(15,45,82,0.12), 0 2px 8px rgba(15,45,82,0.08)' }}>
            <div className="grid grid-cols-2 lg:grid-cols-4">
              {/* Total TB Cases */}
              <div className="flex flex-col px-5 py-5 relative">
                <div className="flex items-center gap-2">
                  <i className="ri-file-list-3-line text-sm" style={{ color: '#6B7FA3' }} />
                  <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#64748B' }}>Total TB Cases</span>
                </div>
                <div className="h-px my-3" style={{ background: '#E2E8F0' }} />
                <div className="flex items-end gap-2">
                  <p className="text-2xl lg:text-3xl font-extrabold" style={{ color: '#0F2D52' }}>{metrics.total.toLocaleString()}</p>
                  {aYear && <TrendBadge current={metrics.total} previous={previousMetrics.total} inverse={true} />}
                </div>
                <div className="hidden lg:block absolute right-0 top-1/2 -translate-y-1/2 w-px h-10" style={{ background: '#E2E8F0' }} />
              </div>

              {/* Active TB Cases */}
              <div className="flex flex-col px-5 py-5 relative">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <i className="ri-first-aid-kit-line text-sm" style={{ color: '#B8956A' }} />
                    <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#64748B' }}>Active Cases</span>
                  </div>
                  {metrics.total > 0 && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: '#FFFBEB', color: '#92400E' }}>
                      {((metrics.active / metrics.total) * 100).toFixed(1)}%
                    </span>
                  )}
                </div>
                <div className="h-px my-3" style={{ background: '#E2E8F0' }} />
                <div className="flex items-end gap-2">
                  <p className="text-2xl lg:text-3xl font-extrabold" style={{ color: '#0F2D52' }}>{metrics.active.toLocaleString()}</p>
                  {aYear && <TrendBadge current={metrics.active} previous={previousMetrics.active} inverse={true} />}
                </div>
                <div className="hidden lg:block absolute right-0 top-1/2 -translate-y-1/2 w-px h-10" style={{ background: '#E2E8F0' }} />
              </div>

              {/* Treatment Success Rate */}
              <div className="flex flex-col px-5 py-5 relative">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <i className="ri-check-double-line text-sm" style={{ color: '#6B9E8A' }} />
                    <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#64748B' }}>Treatment Success</span>
                  </div>
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: '#ECFDF5', color: '#047857' }}>
                    {metrics.successRate}%
                  </span>
                </div>
                <div className="h-px my-3" style={{ background: '#E2E8F0' }} />
                <div className="flex items-end gap-2">
                  <p className="text-2xl lg:text-3xl font-extrabold" style={{ color: '#0F2D52' }}>{metrics.successRate}%</p>
                  {aYear && <TrendBadge current={Number(metrics.successRate)} previous={Number(previousMetrics.successRate)} inverse={false} />}
                </div>
                <div className="hidden lg:block absolute right-0 top-1/2 -translate-y-1/2 w-px h-10" style={{ background: '#E2E8F0' }} />
              </div>

              {/* High-Risk Barangays */}
              <div className="flex flex-col px-5 py-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <i className="ri-alarm-warning-line text-sm" style={{ color: '#C4886A' }} />
                    <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#64748B' }}>High-Risk Barangays</span>
                  </div>
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: '#FEF2F2', color: '#991B1B' }}>
                    {metrics.highRisk}/{barangayNames.length || 30}
                  </span>
                </div>
                <div className="h-px my-3" style={{ background: '#E2E8F0' }} />
                <p className="text-2xl lg:text-3xl font-extrabold" style={{ color: '#0F2D52' }}>{metrics.highRisk}</p>
              </div>
            </div>
          </div>

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
                  {compareYear && prevYearLabel && (
                    <div className="flex items-center gap-1.5">
                      <span className="w-4 h-0 border-t-2" style={{ borderColor: '#CBD5E1', borderStyle: 'dashed' }} />
                      <span className="text-[11px] font-medium" style={{ color: '#94A3B8' }}>Prev ({prevYearLabel})</span>
                    </div>
                  )}
                </div>
                {aYear && (
                  <button onClick={() => setCompareYear(!compareYear)}
                    className="text-xs font-semibold px-3 py-1.5"
                    style={{ background: '#0F2D52', color: '#ffffff', border: '1px solid #0F2D52', borderRadius: 4, transition: 'background 0.15s, color 0.15s, border-color 0.15s, opacity 0.15s' }}
                    onMouseEnter={e => { e.currentTarget.style.background = '#174A7E'; e.currentTarget.style.borderColor = '#174A7E'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = '#0F2D52'; e.currentTarget.style.borderColor = '#0F2D52'; }}>
                    {compareYear ? `Comparing ${prevYearLabel}` : `Compare Year`}
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
                      {compareYear && prevYearLabel && (
                        <Line type="monotone" dataKey={`Prev (${prevYearLabel})`} stroke="#CBD5E1" strokeWidth={1.5} strokeDasharray="6 4" dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: '#ffffff' }} name={`Prev Year (${prevYearLabel})`} connectNulls />
                      )}
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="text-sm text-center py-10" style={{ color: '#94A3B8' }}>No trend data available for the selected filters.</p>
              )}
            </div>
          </div>

          {/* ─── TB Cases by Barangay (with Incidence Toggle) ─── */}
          <div className="rounded-xl overflow-hidden" style={{ background: '#ffffff', border: '1px solid #E2E8F0' }}>
            <div className="flex items-center justify-between px-5 py-4">
              <div className="flex items-center gap-3">
                 <div className="w-1 h-8 rounded-full" style={{ background: showIncidence ? '#92400E' : '#0D9488' }} />
                <div>
                  <h3 className="text-sm font-bold" style={{ color: '#1E293B' }}>TB Cases by Barangay</h3>
                  <p className="text-[11px] mt-0.5" style={{ color: '#94A3B8' }}>{showIncidence ? 'Incidence rate per 100,000 population across Pasig City barangays.' : 'Distribution of reported TB cases across the 30 barangays of Pasig City.'}</p>
                </div>
              </div>
              <button onClick={() => setShowIncidence(!showIncidence)}
                className="text-xs font-semibold px-3 py-1.5"
                style={{ background: '#0F2D52', color: '#ffffff', border: '1px solid #0F2D52', borderRadius: 4, transition: 'background 0.15s, color 0.15s, border-color 0.15s, opacity 0.15s' }}
                onMouseEnter={e => { e.currentTarget.style.background = '#174A7E'; e.currentTarget.style.borderColor = '#174A7E'; }}
                onMouseLeave={e => { e.currentTarget.style.background = '#0F2D52'; e.currentTarget.style.borderColor = '#0F2D52'; }}>
                {showIncidence ? 'Show Cases' : 'Show Incidence'}
              </button>
            </div>
            <div className="px-5 pb-5">
              {barangayIncidenceData.length > 0 ? (
                <div className="w-full" style={{ height: Math.max(380, barangayIncidenceData.length * 26) }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={barangayIncidenceData} layout="vertical" margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E8ECF1" />
                      <XAxis type="number" tick={{ fontSize: 10, fill: '#94A3B8' }} axisLine={false} tickLine={false} tickMargin={4} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: '#64748B', fontWeight: 500 }} axisLine={false} tickLine={false} width={105} tickMargin={4} />
                      <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(0,0,0,0.02)' }} />
                      <Bar dataKey={showIncidence ? 'Incidence' : 'Cases'} radius={[0, 6, 6, 0]} barSize={16} name={showIncidence ? 'Per 100k' : 'Cases'}>
                        {barangayIncidenceData.map((entry, i) => (
                          <Cell key={i} fill={showIncidence
                             ? (entry.Incidence > 100 ? '#991B1B' : entry.Incidence > 50 ? '#92400E' : '#047857')
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

          {/* ─── Cases by Health Facility ─── */}
          {facilityData.length > 0 && (
            <div className="rounded-xl overflow-hidden" style={{ background: '#ffffff', border: '1px solid #E2E8F0' }}>
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
                <div className="w-full" style={{ height: Math.max(260, facilityData.length * 28) }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={facilityData} layout="vertical" margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E8ECF1" />
                      <XAxis type="number" tick={{ fontSize: 10, fill: '#94A3B8' }} axisLine={false} tickLine={false} tickMargin={4} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: '#64748B', fontWeight: 500 }} axisLine={false} tickLine={false} width={140} tickMargin={4} />
                      <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(0,0,0,0.02)' }} />
                      <Bar dataKey="Cases" radius={[0, 6, 6, 0]} barSize={16} name="Cases">
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

          {/* ─── Age + Sex Cross-Tabulation + Treatment Outcomes ─── */}
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

            {/* Treatment Outcomes Pie Chart */}
            <div className="rounded-xl overflow-hidden" style={{ background: '#ffffff', border: '1px solid #E2E8F0' }}>
              <div className="px-5 py-4">
                <div className="flex items-center gap-3">
                   <div className="w-1 h-8 rounded-full" style={{ background: '#047857' }} />
                  <div>
                    <h3 className="text-sm font-bold" style={{ color: '#1E293B' }}>Treatment Outcomes</h3>
                    <p className="text-[11px] mt-0.5" style={{ color: '#94A3B8' }}>Distribution of treatment outcomes.</p>
                  </div>
                </div>
              </div>
              <div className="px-5 pb-5">
                {outcomeData.length > 0 ? (
                  <div className="flex items-center justify-center gap-6">
                    <div className="w-[180px] h-[180px]">
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
                      {outcomeData.map((entry) => {
                        const total = outcomeData.reduce((s, e) => s + e.Cases, 0);
                        const pct = total > 0 ? ((entry.Cases / total) * 100).toFixed(1) : '0.0';
                        return (
                          <div key={entry.name} className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: OUTCOME_COLORS[entry.name] || '#94A3B8' }} />
                            <span className="text-[10px] font-medium" style={{ color: '#64748B' }}>
                              {entry.name?.length > 18 ? entry.name.slice(0, 16) + '...' : entry.name}
                            </span>
                            <span className="text-[10px] font-bold" style={{ color: '#0F2D52' }}>{entry.Cases.toLocaleString()}</span>
                            <span className="text-[10px]" style={{ color: '#94A3B8' }}>({pct}%)</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-center py-10" style={{ color: '#94A3B8' }}>No data.</p>
                )}
              </div>
            </div>
          </div>

          {/* ─── Key Insights ─── */}
          {insights.length > 0 && (
            <div className="rounded-xl overflow-hidden" style={{ background: '#ffffff', border: '1px solid #E2E8F0' }}>
              <div className="px-5 py-4">
                <div className="flex items-center gap-2">
                   <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#6B7280' }}>Summary</span>
                  <h3 className="text-sm font-bold" style={{ color: '#1E293B' }}>Key Insights</h3>
                </div>
              </div>
              <div className="px-5 pb-5">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {insights.map((insight, i) => (
                    <div key={i} className="flex gap-3 p-4">
                      <div className="w-[3px] rounded-full shrink-0" style={{ background: insight.color }} />
                      <div className="flex flex-col gap-1">
                        <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: insight.color }}>{insight.category}</span>
                        <div className="flex items-baseline gap-1.5">
                          <span className="text-xl font-extrabold" style={{ color: '#1E293B', letterSpacing: '-0.02em' }}>{insight.stat}</span>
                          <span className="text-sm font-medium" style={{ color: '#94A3B8' }}>{insight.unit}</span>
                        </div>
                        <p className="text-[12px] leading-relaxed" style={{ color: '#64748B' }}>{insight.text}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
