import { useState, useEffect } from "react";
import API from "../api/axios";

/* ─── Debounce hook ─── */
function useDebounce(value, delay = 400) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/* ─── Status → accent color ─── */
const statusColors = {
  "ON TREATMENT": { bg: '#FEF3C7', text: '#D97706', dot: '#F59E0B' },
  "TREATMENT COMPLETED": { bg: '#DBEAFE', text: '#2563EB', dot: '#3B82F6' },
  "CURED": { bg: '#D1FAE5', text: '#059669', dot: '#10B981' },
  "DIED": { bg: '#FEE2E2', text: '#DC2626', dot: '#EF4444' },
  "LOST TO FOLLOW-UP": { bg: '#EDE9FE', text: '#7C3AED', dot: '#8B5CF6' },
  "EXCLUDED": { bg: '#F1F5F9', text: '#64748B', dot: '#94A3B8' },
  "PENDING": { bg: '#FEF3C7', text: '#D97706', dot: '#F59E0B' },
};

function StatusBadge({ status }) {
  const value = status || "PENDING";
  const colors = statusColors[value] || { bg: '#F1F5F9', text: '#64748B', dot: '#94A3B8' };
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold whitespace-nowrap"
      style={{ background: colors.bg, color: colors.text }}
    >
      <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: colors.dot }} />
      {value.toLowerCase().replace(/\b\w/g, c => c.toUpperCase())}
    </span>
  );
}

const getMonthNumber = (month) => {
  const months = { January: "1", February: "2", March: "3", April: "4", May: "5", June: "6", July: "7", August: "8", September: "9", October: "10", November: "11", December: "12" };
  return months[month] || "";
};

const formatDate = (dateStr) => {
  if (!dateStr) return "N/A";
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return dateStr;
  }
};

const DetailRow = ({ label, value }) => {
  const displayValue = value && typeof value === 'string'
    ? value.toLowerCase().replace(/\b\w/g, c => c.toUpperCase())
    : value;
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-xs" style={{ color: '#94A3B8' }}>{label}</span>
      <span className="text-xs font-semibold text-right" style={{ color: '#0F2D52' }}>{displayValue || "—"}</span>
    </div>
  );
};

/* ─── Filter select for sidebar ─── */
function FilterSelect({ label, value, onChange, options, placeholder }) {
  const formatOption = (opt) => {
    if (!opt) return '';
    return opt.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  };
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[11px] font-semibold" style={{ color: '#64748B' }}>{label}</label>
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-lg pl-3 pr-7 py-2 text-xs font-semibold outline-none transition cursor-pointer appearance-none"
          style={{ background: '#ffffff', border: '1px solid #E2E8F0', color: value ? '#0F2D52' : '#94A3B8' }}
        >
          <option value="">{placeholder}</option>
          {options.map((opt) => (
            <option key={opt} value={opt}>
              {formatOption(opt)}
            </option>
          ))}
        </select>
        <i className="ri-arrow-down-s-line absolute right-2 top-1/2 -translate-y-1/2 text-[10px] pointer-events-none" style={{ color: '#64748B' }} />
      </div>
    </div>
  );
}

const ALL_MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const ALL_YEARS = ["2025","2024","2023"];
const ALL_OUTCOME_STATUSES = [
  "ON TREATMENT", "CURED", "TREATMENT COMPLETED",
  "DIED", "LOST TO FOLLOW-UP", "EXCLUDED",
];

export default function TBRecords() {
  const [records, setRecords] = useState([]);
  const [barangays, setBarangays] = useState([]);
  const [outcomeStatuses, setOutcomeStatuses] = useState([]);
  const [bacteriologicalStatuses, setBacteriologicalStatuses] = useState([]);
  const [sexStatuses, setSexStatuses] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 10, total: 0, totalPages: 1 });
  const [metrics, setMetrics] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState("");
  const debouncedSearch = useDebounce(searchTerm, 400);
  const [selectedYear, setSelectedYear] = useState("");
  const [selectedMonth, setSelectedMonth] = useState("");
  const [selectedBarangay, setSelectedBarangay] = useState("");
  const [selectedOutcomeStatus, setSelectedOutcomeStatus] = useState("");
  const [selectedFacility, setSelectedFacility] = useState("");
  const [selectedSex, setSelectedSex] = useState("");
  const [selectedBacteriologicalStatus, setSelectedBacteriologicalStatus] = useState("");
  const [selectedValidationStatus, setSelectedValidationStatus] = useState("");
  const [facilities, setFacilities] = useState([]);
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [pendingFilters, setPendingFilters] = useState({});
  const recordsPerPage = 20;

  /* ─── Derived active filter list ─── */
  const activeFilters = [
    { key: 'year', label: 'Year', value: selectedYear },
    { key: 'month', label: 'Month', value: selectedMonth },
    { key: 'barangay', label: 'Barangay', value: selectedBarangay },
    { key: 'outcome', label: 'Outcome', value: selectedOutcomeStatus },
    { key: 'facility', label: 'Facility', value: selectedFacility },
    { key: 'sex', label: 'Sex', value: selectedSex },
    { key: 'bacteriological', label: 'Bacteriological', value: selectedBacteriologicalStatus },
    { key: 'validation', label: 'Validation', value: selectedValidationStatus },
  ].filter(f => f.value);

  const activeFilterCount = activeFilters.length;

  /* ─── Filter setter map for chips ─── */
  const filterSetters = {
    year: setSelectedYear,
    month: setSelectedMonth,
    barangay: setSelectedBarangay,
    outcome: setSelectedOutcomeStatus,
    facility: setSelectedFacility,
    sex: setSelectedSex,
    bacteriological: setSelectedBacteriologicalStatus,
    validation: setSelectedValidationStatus,
  };

  const removeFilter = (key) => {
    if (filterSetters[key]) filterSetters[key]("");
    setCurrentPage(1);
  };

  const clearAllFilters = () => {
    setSearchTerm(""); setSelectedYear(""); setSelectedMonth("");
    setSelectedBarangay(""); setSelectedOutcomeStatus(""); setSelectedFacility("");
    setSelectedSex(""); setSelectedBacteriologicalStatus(""); setSelectedValidationStatus("");
    setCurrentPage(1);
  };

  /* ─── Advanced Filters Modal helpers ─── */
  const openAdvancedFilters = () => {
    setPendingFilters({
      year: selectedYear,
      month: selectedMonth,
      barangay: selectedBarangay,
      outcome: selectedOutcomeStatus,
      facility: selectedFacility,
      sex: selectedSex,
      bacteriological: selectedBacteriologicalStatus,
      validation: selectedValidationStatus,
    });
    setShowAdvancedFilters(true);
  };

  const updatePending = (key, value) => {
    setPendingFilters(prev => ({ ...prev, [key]: value }));
  };

  const applyPendingFilters = () => {
    setSelectedYear(pendingFilters.year || "");
    setSelectedMonth(pendingFilters.month || "");
    setSelectedBarangay(pendingFilters.barangay || "");
    setSelectedOutcomeStatus(pendingFilters.outcome || "");
    setSelectedFacility(pendingFilters.facility || "");
    setSelectedSex(pendingFilters.sex || "");
    setSelectedBacteriologicalStatus(pendingFilters.bacteriological || "");
    setSelectedValidationStatus(pendingFilters.validation || "");
    setCurrentPage(1);
    setShowAdvancedFilters(false);
  };

  const clearPendingFilters = () => {
    setPendingFilters({ year: "", month: "", barangay: "", outcome: "", facility: "", sex: "", bacteriological: "", validation: "" });
  };

  /* ─── Format chip display ─── */
  const formatChipValue = (key, value) => {
    if (!value) return "";
    if (key === 'year') return value;
    if (key === 'month') return value;
    return value.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  };

  /* ─── Fetch metrics ─── */
  useEffect(() => {
    const fetchMetrics = async () => {
      try {
        const res = await API.get("/api/tb/dashboard/summary");
        const s = res.data.summary;
        if (!s) return;
        const prevMonth = s.prev_month_cases || 0;
        const currentMonth = s.current_month_cases || 0;
        const caseTrendPct = prevMonth > 0
          ? Math.round(((currentMonth - prevMonth) / prevMonth) * 100) : 0;
        const totalOutcomes = s.total_outcomes || 0;
        const successful = s.successful_count || 0;
        const successRate = totalOutcomes > 0
          ? Math.round((successful / totalOutcomes) * 100) : 0;
        setMetrics({
          totalCases: s.total_cases || 0,
          onTreatmentCount: s.on_treatment_count || 0,
          curedCount: s.cured_count || 0,
          treatmentCompletedCount: s.treatment_completed_count || 0,
          diedCount: s.died_count || 0,
          ltfuCount: s.ltfu_count || 0,
          successRate,
          caseTrend: { value: caseTrendPct, direction: caseTrendPct >= 0 ? 'up' : 'down' },
          activeStatus: (s.on_treatment_count || 0) > 0 ? 'Ongoing' : 'None',
        });
      } catch (err) {
        console.error("Failed to fetch metrics:", err);
      }
    };
    fetchMetrics();
  }, []);

  /* ─── Fetch barangays ─── */
  useEffect(() => {
    const fetchBarangays = async () => {
      try {
        const res = await API.get("/api/tb/barangays");
        setBarangays(res.data.barangays.map(b => b.name).sort());
      } catch (err) {
        console.error("Failed to fetch barangays:", err);
      }
    };
    fetchBarangays();
  }, []);

  /* ─── Fetch facilities ─── */
  useEffect(() => {
    const fetchFacilities = async () => {
      try {
        const res = await API.get("/api/tb/facilities");
        const names = (res.data.facilities || []).map(f => (f.name || f.facility_name || '').trim()).filter(Boolean).sort();
        setFacilities([...new Set(names)]);
      } catch (err) {
        console.error("Failed to fetch facilities:", err);
      }
    };
    fetchFacilities();
  }, []);

  /* ─── Fetch filter options (sex, bacteriological status, outcome status) ─── */
  useEffect(() => {
    const fetchFilterOptions = async () => {
      try {
        const res = await API.get("/api/tb/filter-options");
        setSexStatuses((res.data.sex || []).filter(Boolean).sort());
        setBacteriologicalStatuses((res.data.bacteriological_status || []).filter(Boolean).sort());
        setOutcomeStatuses((res.data.outcome_status || []).filter(Boolean).sort());
      } catch {
        try {
          const res = await API.get("/api/tb/cases?limit=9999");
          const allCases = res.data.cases || [];
          setSexStatuses([...new Set(allCases.map(r => r.sex).filter(Boolean))].sort());
          setBacteriologicalStatuses([...new Set(allCases.map(r => r.bacteriological_status).filter(Boolean))].sort());
          setOutcomeStatuses([...new Set(allCases.map(r => r.outcome_status).filter(Boolean))].sort());
        } catch (err2) {
          console.error("Failed to fetch filter options:", err2);
        }
      }
    };
    fetchFilterOptions();
  }, []);

  /* ─── Fetch cases ─── */
  useEffect(() => {
    let cancelled = false;
    const fetchCases = async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        params.append("page", currentPage);
        params.append("limit", recordsPerPage);
        if (debouncedSearch) params.append("search", debouncedSearch);
        if (selectedBarangay) params.append("barangay", selectedBarangay);
        if (selectedYear) params.append("year", selectedYear);
        if (selectedMonth) {
          const monthNum = getMonthNumber(selectedMonth);
          if (monthNum) params.append("month", monthNum);
        }
        if (selectedOutcomeStatus) params.append("outcome", selectedOutcomeStatus);
        if (selectedFacility) params.append("facility", selectedFacility);
        if (selectedSex) params.append("sex", selectedSex);
        if (selectedBacteriologicalStatus) params.append("bacteriological_status", selectedBacteriologicalStatus);
        if (selectedValidationStatus) params.append("validation_status", selectedValidationStatus);
        const res = await API.get(`/api/tb/cases?${params.toString()}`);
        if (cancelled) return;
        const cases = res.data.cases || [];
        setRecords(cases);
        setPagination(res.data.pagination || { page: 1, limit: 10, total: 0, totalPages: 1 });
      } catch (err) {
        if (!cancelled) console.error("Failed to fetch cases:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchCases();
    return () => { cancelled = true; };
  }, [currentPage, debouncedSearch, selectedYear, selectedMonth, selectedBarangay, selectedOutcomeStatus, selectedFacility, selectedSex, selectedBacteriologicalStatus, selectedValidationStatus]);

  return (
    <div className="flex flex-col gap-5">

      {/* ── Metric Cards ── */}
      <div>
        <div className="rounded-xl" style={{ background: '#ffffff', boxShadow: '0 4px 24px rgba(15, 45, 82, 0.12), 0 2px 8px rgba(15, 45, 82, 0.08)' }}>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
            {/* 1. Total TB Cases */}
            <div className="flex flex-col px-5 py-5 relative">
              <div className="flex items-center gap-2">
                <i className="ri-file-list-3-line text-base" style={{ color: '#3B82F6' }} />
                <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#64748B' }}>Total TB Cases</span>
              </div>
              <div className="h-px my-3" style={{ background: '#E2E8F0' }} />
              <p className="text-2xl lg:text-3xl font-extrabold" style={{ color: '#0F2D52' }}>
                {metrics ? metrics.totalCases.toLocaleString() : '---'}
              </p>
              <div className="hidden lg:block absolute right-0 top-1/2 -translate-y-1/2 w-px h-10" style={{ background: '#E2E8F0' }} />
            </div>

            {/* 2. On Treatment */}
            <div className="flex flex-col px-5 py-5 relative">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <i className="ri-first-aid-kit-line text-base" style={{ color: '#F59E0B' }} />
                  <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#64748B' }}>On Treatment</span>
                </div>
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: '#FEF3C7', color: '#D97706' }}>
                  {metrics ? metrics.activeStatus : '---'}
                </span>
              </div>
              <div className="h-px my-3" style={{ background: '#E2E8F0' }} />
              <p className="text-2xl lg:text-3xl font-extrabold" style={{ color: '#0F2D52' }}>
                {metrics ? metrics.onTreatmentCount.toLocaleString() : '---'}
              </p>
              <div className="hidden lg:block absolute right-0 top-1/2 -translate-y-1/2 w-px h-10" style={{ background: '#E2E8F0' }} />
            </div>

            {/* 3. Cured */}
            <div className="flex flex-col px-5 py-5 relative">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <i className="ri-check-double-line text-base" style={{ color: '#10B981' }} />
                  <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#64748B' }}>Cured</span>
                </div>
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: '#D1FAE5', color: '#059669' }}>
                  {metrics ? `${metrics.successRate}%` : '---'}
                </span>
              </div>
              <div className="h-px my-3" style={{ background: '#E2E8F0' }} />
              <p className="text-2xl lg:text-3xl font-extrabold" style={{ color: '#0F2D52' }}>
                {metrics ? metrics.curedCount.toLocaleString() : '---'}
              </p>
              <div className="hidden lg:block absolute right-0 top-1/2 -translate-y-1/2 w-px h-10" style={{ background: '#E2E8F0' }} />
            </div>

            {/* 4. Died */}
            <div className="flex flex-col px-5 py-5 relative">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <i className="ri-emotion-sad-line text-base" style={{ color: '#DC2626' }} />
                  <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#64748B' }}>Died</span>
                </div>
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: '#FEE2E2', color: '#DC2626' }}>
                  {metrics && metrics.totalCases > 0 ? `${Math.round((metrics.diedCount / metrics.totalCases) * 100)}%` : '---'}
                </span>
              </div>
              <div className="h-px my-3" style={{ background: '#E2E8F0' }} />
              <p className="text-2xl lg:text-3xl font-extrabold" style={{ color: '#0F2D52' }}>
                {metrics ? metrics.diedCount.toLocaleString() : '---'}
              </p>
              <div className="hidden lg:block absolute right-0 top-1/2 -translate-y-1/2 w-px h-10" style={{ background: '#E2E8F0' }} />
            </div>

            {/* 5. Lost to Follow-up */}
            <div className="flex flex-col px-5 py-5 relative">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <i className="ri-user-unfollow-line text-base" style={{ color: '#7C3AED' }} />
                  <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#64748B' }}>Lost to Follow-up</span>
                </div>
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: '#EDE9FE', color: '#7C3AED' }}>
                  {metrics && metrics.totalCases > 0 ? `${Math.round((metrics.ltfuCount / metrics.totalCases) * 100)}%` : '---'}
                </span>
              </div>
              <div className="h-px my-3" style={{ background: '#E2E8F0' }} />
              <p className="text-2xl lg:text-3xl font-extrabold" style={{ color: '#0F2D52' }}>
                {metrics ? metrics.ltfuCount.toLocaleString() : '---'}
              </p>
              <div className="hidden lg:block absolute right-0 top-1/2 -translate-y-1/2 w-px h-10" style={{ background: '#E2E8F0' }} />
            </div>

            {/* 6. Treatment Completed */}
            <div className="flex flex-col px-5 py-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <i className="ri-checkbox-circle-line text-base" style={{ color: '#2563EB' }} />
                  <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#64748B' }}>Treatment Completed</span>
                </div>
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: '#DBEAFE', color: '#2563EB' }}>
                  {metrics && metrics.totalCases > 0 ? `${Math.round((metrics.treatmentCompletedCount / metrics.totalCases) * 100)}%` : '---'}
                </span>
              </div>
              <div className="h-px my-3" style={{ background: '#E2E8F0' }} />
              <p className="text-2xl lg:text-3xl font-extrabold" style={{ color: '#0F2D52' }}>
                {metrics ? metrics.treatmentCompletedCount.toLocaleString() : '---'}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Table Card ── */}
      <div>
        <div className="rounded-xl overflow-hidden" style={{ background: '#ffffff' }}>

          {/* ── Header ── */}
          <div className="flex flex-col gap-3 px-6 py-3.5 sm:flex-row sm:items-center sm:justify-between" style={{ borderBottom: '1px solid #DBEAFE' }}>
            {/* Left: Title */}
            <div>
              <h1 className="text-lg font-extrabold tracking-tight" style={{ color: '#0F2D52' }}>TB Records</h1>
              <p className="text-xs mt-0.5" style={{ color: '#94A3B8' }}>Manage and monitor tuberculosis records efficiently.</p>
            </div>
            {/* Right: Search + Advanced Filters */}
            <div className="flex items-center gap-2">
              <div className="relative">
                <i className="ri-search-line pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm" style={{ color: '#94A3B8' }} />
                <input
                  type="text"
                  placeholder="Search by case ID, barangay, facility..."
                  value={searchTerm}
                  onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
                  className="w-64 rounded-lg py-1.5 pl-9 pr-3 text-xs font-medium outline-none transition"
                  style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', color: '#0F2D52' }}
                />
                {searchTerm && searchTerm !== debouncedSearch && (
                  <i className="ri-loader-4-line absolute right-3 top-1/2 -translate-y-1/2 text-xs animate-spin" style={{ color: '#94A3B8' }} />
                )}
              </div>
              <button
                onClick={openAdvancedFilters}
                className="inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold transition whitespace-nowrap"
                style={{ background: activeFilterCount > 0 ? '#0F2D52' : '#EFF6FF', color: activeFilterCount > 0 ? '#ffffff' : '#0F2D52', border: activeFilterCount > 0 ? '1px solid #0F2D52' : '1px solid #DBEAFE' }}
              >
                <i className="ri-filter-3-line text-sm" />
                Filters
                {activeFilterCount > 0 && (
                  <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-bold" style={{ background: '#3B82F6', color: '#ffffff' }}>
                    {activeFilterCount}
                  </span>
                )}
              </button>
            </div>
          </div>

          {/* ── Active Filter Chips ── */}
          {activeFilterCount > 0 && (
            <div className="flex flex-wrap items-center gap-2 px-6 py-3" style={{ borderBottom: '1px solid #E2E8F0' }}>
              {activeFilters.map((f) => (
                <span
                  key={f.key}
                  className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium"
                  style={{ background: '#EFF6FF', color: '#334155' }}
                >
                  {f.label}: {formatChipValue(f.key, f.value)}
                  <button
                    onClick={() => removeFilter(f.key)}
                    className="inline-flex h-4 w-4 items-center justify-center rounded-full transition"
                    style={{ color: '#94A3B8' }}
                    aria-label={`Remove ${f.label} filter`}
                  >
                    <i className="ri-close-line text-[10px]" />
                  </button>
                </span>
              ))}
              <button
                onClick={clearAllFilters}
                className="text-[11px] font-medium transition hover:underline ml-1"
                style={{ color: '#94A3B8' }}
              >
                Clear all
              </button>
            </div>
          )}

          {/* ── Table (scrollable) ── */}
          <div className="flex-1 min-h-0 overflow-y-auto overflow-x-auto">
            <table className="w-full text-left text-sm" style={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#0F2D52' }}>
                  {["Case ID", "Barangay", "Age", "Sex", "Diagnosis Date", "Facility", "Bacteriologic Status", "Status", "Action"].map((h, idx) => (
                    <th key={h}
                      className={`${idx === 0 ? 'pl-6' : 'px-3'} pr-3 py-3 text-left text-[10px] font-bold uppercase tracking-wider whitespace-nowrap ${idx === 5 ? 'max-w-[200px]' : ''}`}
                      style={{ color: '#ffffff', borderBottom: '1px solid #1E40AF', borderRight: idx < 8 ? '1px solid #1E40AF' : 'none' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <tr key={`skeleton-${i}`} style={{ borderBottom: '1px solid #E2E8F0', background: i % 2 === 0 ? '#ffffff' : '#F8FAFC' }}>
                      {Array.from({ length: 9 }).map((_, j) => (
                        <td key={j} className={`${j === 0 ? 'pl-6' : 'px-3'} pr-3 py-3.5`} style={{ borderRight: j < 8 ? '1px solid #E2E8F0' : 'none' }}>
                          <div className="h-4 rounded animate-pulse" style={{
                            background: 'linear-gradient(90deg, #EFF6FF 25%, #DBEAFE 50%, #EFF6FF 75%)',
                            backgroundSize: '200% 100%', animation: 'shimmer 1.5s infinite',
                            width: j === 0 ? '60px' : j === 5 ? '140px' : j === 6 ? '120px' : j === 7 ? '90px' : j === 8 ? '32px' : '80px',
                          }} />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : records.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-5 py-12 text-center text-sm" style={{ color: '#94A3B8' }}>
                      No records found matching your filters.
                    </td>
                  </tr>
                ) : (
                  records.map((record, idx) => (
                    <tr key={record.id} className="hover:bg-blue-50 transition-colors"
                      style={{ borderBottom: '1px solid #E2E8F0', background: idx % 2 === 0 ? '#ffffff' : '#F8FAFC' }}>
                      <td className="pl-6 pr-3 py-3.5" style={{ borderRight: '1px solid #E2E8F0' }}>
                        <span className="font-bold" style={{ color: '#0F2D52' }}>{String(record.id).padStart(4, "0")}</span>
                      </td>
                      <td className="px-3 py-3.5 text-sm" style={{ color: '#334155', borderRight: '1px solid #E2E8F0' }}>{record.barangay_name}</td>
                      <td className="px-3 py-3.5 text-sm" style={{ color: '#334155', borderRight: '1px solid #E2E8F0' }}>{record.age}</td>
                      <td className="px-3 py-3.5 text-sm" style={{ color: '#334155', borderRight: '1px solid #E2E8F0' }}>{record.sex}</td>
                      <td className="px-3 py-3.5 text-sm" style={{ color: '#334155', borderRight: '1px solid #E2E8F0' }}>{formatDate(record.date_of_diagnosis)}</td>
                      <td className="px-3 py-3.5 text-sm max-w-[200px] whitespace-nowrap overflow-hidden text-ellipsis" style={{ color: '#334155', borderRight: '1px solid #E2E8F0' }} title={record.screening_facility}>{record.screening_facility}</td>
                      <td className="px-3 py-3.5 text-sm" style={{ color: '#334155', borderRight: '1px solid #E2E8F0' }}>{record.bacteriological_status ? record.bacteriological_status.toLowerCase().replace(/\b\w/g, c => c.toUpperCase()) : '—'}</td>
                      <td className="px-3 py-3.5" style={{ borderRight: '1px solid #E2E8F0' }}>
                        <StatusBadge status={record.outcome_status} />
                      </td>
                      <td className="px-3 py-3.5 text-center">
                        <button aria-label="View record" onClick={() => setSelectedRecord(record)}
                          className="inline-flex items-center justify-center w-8 h-8 rounded-lg transition hover:opacity-80"
                          style={{ background: '#DBEAFE', color: '#2563EB' }}>
                          <i className="ri-eye-line text-sm" />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* ── Pagination ── */}
          <div className="flex flex-col gap-3 px-6 py-4 sm:flex-row sm:items-center sm:justify-between" style={{ borderTop: '1px solid #E2E8F0' }}>
            <p className="text-xs font-semibold" style={{ color: '#94A3B8' }}>
              {loading ? (
                <span className="inline-flex items-center gap-1.5">
                  <i className="ri-loader-4-line text-xs animate-spin" /> Loading records...
                </span>
              ) : (
                <>Showing {pagination.total === 0 ? 0 : (currentPage - 1) * recordsPerPage + 1}–{Math.min(currentPage * recordsPerPage, pagination.total)} of {pagination.total} records</>
              )}
            </p>
            <div className="flex items-center gap-1.5">
              <button aria-label="Previous page" onClick={() => currentPage > 1 && setCurrentPage(currentPage - 1)}
                disabled={currentPage <= 1 || loading}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg transition disabled:cursor-not-allowed disabled:opacity-40"
                style={{ background: '#EFF6FF', border: '1px solid #DBEAFE', color: '#64748B' }}>
                <i className="ri-arrow-left-s-line text-base" />
              </button>
              {(() => {
                const totalPages = pagination.totalPages || 1;
                const pages = [];
                if (totalPages <= 7) {
                  for (let i = 1; i <= totalPages; i++) pages.push(i);
                } else {
                  pages.push(1);
                  if (currentPage > 3) pages.push('...');
                  const start = Math.max(2, currentPage - 1);
                  const end = Math.min(totalPages - 1, currentPage + 1);
                  for (let i = start; i <= end; i++) pages.push(i);
                  if (currentPage < totalPages - 2) pages.push('...');
                  pages.push(totalPages);
                }
                return pages.map((page, idx) =>
                  page === '...' ? (
                    <span key={`e-${idx}`} className="inline-flex h-8 w-8 items-center justify-center text-xs" style={{ color: '#94A3B8' }}>...</span>
                  ) : (
                    <button key={page} onClick={() => setCurrentPage(page)}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-xs font-bold transition"
                      style={currentPage === page ? { background: '#0F2D52', color: '#ffffff' } : { color: '#64748B' }}>
                      {page}
                    </button>
                  )
                );
              })()}
              <button aria-label="Next page" onClick={() => setCurrentPage(currentPage + 1)}
                disabled={currentPage >= pagination.totalPages || pagination.total === 0 || loading}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg transition disabled:cursor-not-allowed disabled:opacity-40"
                style={{ background: '#EFF6FF', border: '1px solid #DBEAFE', color: '#64748B' }}>
                <i className="ri-arrow-right-s-line text-base" />
              </button>
            </div>
          </div>

        </div>
      </div>

      {/* ── Advanced Filters Sidebar ── */}
      {showAdvancedFilters && (
        <div className="fixed inset-0 z-[1200] flex justify-end bg-slate-950/20 backdrop-blur-sm">
          <div className="absolute inset-0" onClick={() => setShowAdvancedFilters(false)} />
          <div className="relative w-full max-w-sm h-full overflow-y-auto bg-white" style={{ boxShadow: '-8px 0 40px rgba(15, 45, 82, 0.12)', animation: 'slide-in-right 0.3s ease-out both' }}>
            <div className="sticky top-0 z-10" style={{ background: '#0F2D52' }}>
              <div className="flex items-center justify-between px-6 py-4">
                <h2 className="text-sm font-extrabold tracking-tight" style={{ color: '#ffffff' }}>FILTERS</h2>
                <button onClick={() => setShowAdvancedFilters(false)} aria-label="Close filters"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full transition hover:opacity-80" style={{ color: '#93C5FD' }}>
                  <i className="ri-close-line text-base" />
                </button>
              </div>
            </div>
            <div className="px-6 py-5 space-y-5">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: '#0F2D52' }}>Date</h3>
                <div className="space-y-3">
                  <FilterSelect
                    label="Year"
                    value={pendingFilters.year || ""} onChange={(v) => updatePending('year', v)}
                    options={ALL_YEARS} placeholder="All Years"
                  />
                  <FilterSelect
                    label="Month"
                    value={pendingFilters.month || ""} onChange={(v) => updatePending('month', v)}
                    options={ALL_MONTHS} placeholder="All Months"
                  />
                </div>
              </div>
              <div style={{ borderTop: '1px solid #E2E8F0' }} />
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: '#0F2D52' }}>Location</h3>
                <div className="space-y-3">
                  <FilterSelect
                    label="Barangay"
                    value={pendingFilters.barangay || ""} onChange={(v) => updatePending('barangay', v)}
                    options={barangays} placeholder="All Barangays"
                  />
                  <FilterSelect
                    label="Facility"
                    value={pendingFilters.facility || ""} onChange={(v) => updatePending('facility', v)}
                    options={facilities} placeholder="All Facilities"
                  />
                </div>
              </div>
              <div style={{ borderTop: '1px solid #E2E8F0' }} />
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: '#0F2D52' }}>Patient</h3>
                <div className="space-y-3">
                  <FilterSelect
                    label="Sex"
                    value={pendingFilters.sex || ""} onChange={(v) => updatePending('sex', v)}
                    options={sexStatuses} placeholder="All Sexes"
                  />
                </div>
              </div>
              <div style={{ borderTop: '1px solid #E2E8F0' }} />
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: '#0F2D52' }}>Case Status</h3>
                <div className="space-y-3">
                  <FilterSelect
                    label="Outcome Status"
                    value={pendingFilters.outcome || ""} onChange={(v) => updatePending('outcome', v)}
                    options={ALL_OUTCOME_STATUSES} placeholder="All Outcomes"
                  />
                  <FilterSelect
                    label="Bacteriological Status"
                    value={pendingFilters.bacteriological || ""} onChange={(v) => updatePending('bacteriological', v)}
                    options={bacteriologicalStatuses} placeholder="All Statuses"
                  />
                  <FilterSelect
                    label="Validation Status"
                    value={pendingFilters.validation || ""} onChange={(v) => updatePending('validation', v)}
                    options={["Validated", "Pending"]} placeholder="All Statuses"
                  />
                </div>
              </div>
            </div>
            <div className="sticky bottom-0 flex items-center gap-3 px-6 py-4" style={{ borderTop: '1px solid #E2E8F0', background: '#ffffff' }}>
              <button
                onClick={clearPendingFilters}
                className="flex-1 rounded-lg px-4 py-2.5 text-xs font-semibold transition"
                style={{ color: '#64748B', border: '1px solid #E2E8F0', background: '#ffffff' }}
              >
                Clear All
              </button>
              <button
                onClick={applyPendingFilters}
                className="flex-1 rounded-lg px-4 py-2.5 text-xs font-semibold transition"
                style={{ background: '#0F2D52', color: '#ffffff' }}
              >
                Apply Filters
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Record detail modal ── */}
      {selectedRecord && (
        <div className="fixed inset-0 z-[1200] flex justify-end bg-slate-950/20 backdrop-blur-sm">
          <div className="absolute inset-0" onClick={() => setSelectedRecord(null)} />
          <div className="relative w-full max-w-lg h-full overflow-y-auto bg-white" style={{ boxShadow: '-8px 0 40px rgba(15, 45, 82, 0.12)', animation: 'slide-in-right 0.3s ease-out both' }}>
            <div className="sticky top-0 z-10" style={{ background: '#0F2D52' }}>
              <div className="flex items-center justify-between px-6 py-4">
                <h2 className="text-base font-extrabold tracking-tight" style={{ color: '#ffffff' }}>RECORD DETAILS</h2>
                <button onClick={() => setSelectedRecord(null)} aria-label="Close modal"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full transition hover:opacity-80" style={{ color: '#93C5FD' }}>
                  <i className="ri-close-line text-base" />
                </button>
              </div>
            </div>
            <div className="px-6 py-5 space-y-6">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#94A3B8' }}>Case ID</p>
                <p className="text-2xl font-extrabold mt-0.5" style={{ color: '#0F2D52' }}>{String(selectedRecord.id).padStart(4, "0")}</p>
                <div className="mt-2"><StatusBadge status={selectedRecord.outcome_status} /></div>
              </div>
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: '#0F2D52' }}>Case Summary</h3>
                <div className="space-y-2.5">
                  <DetailRow label="ITIS Case ID" value={selectedRecord.itis_case_id ?? null} />
                  <DetailRow label="Source Type" value={selectedRecord.source_type ?? null} />
                  <DetailRow label="Validation Status" value={selectedRecord.batch_id ? "Validated" : "Pending"} />
                  <DetailRow label="Encoded By" value={selectedRecord.source_of_patient} />
                  <DetailRow label="Imported From" value={selectedRecord.screening_facility} />
                  <DetailRow label="Created" value={formatDate(selectedRecord.date_of_diagnosis)} />
                </div>
              </div>
              <div style={{ borderTop: '1px solid #E2E8F0' }} />
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: '#0F2D52' }}>Patient Information</h3>
                <div className="space-y-2.5">
                  <DetailRow label="Age" value={selectedRecord.age} />
                  <DetailRow label="Sex" value={selectedRecord.sex} />
                  <DetailRow label="Barangay" value={selectedRecord.barangay_name} />
                  <DetailRow label="City" value="Pasig City" />
                  <DetailRow label="Location Classification" value={selectedRecord.location_classification ?? null} />
                  <DetailRow label="Source" value={selectedRecord.source_of_patient || "Walk-in"} />
                </div>
              </div>
              <div style={{ borderTop: '1px solid #E2E8F0' }} />
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: '#0F2D52' }}>Screening &amp; Diagnosis</h3>
                <div className="space-y-2.5">
                  <DetailRow label="Screening Date" value={formatDate(selectedRecord.date_of_screening)} />
                  <DetailRow label="Diagnosis Date" value={formatDate(selectedRecord.date_of_diagnosis)} />
                  <DetailRow label="Notification Date" value={formatDate(selectedRecord.date_of_notification)} />
                  <DetailRow label="Facility" value={selectedRecord.screening_facility} />
                </div>
              </div>
              <div style={{ borderTop: '1px solid #E2E8F0' }} />
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: '#0F2D52' }}>Clinical &amp; Treatment</h3>
                <div className="space-y-2.5">
                  <DetailRow label="Anatomical Site" value={selectedRecord.anatomical_site} />
                  <DetailRow label="Registration Group" value={selectedRecord.registration_group} />
                  <DetailRow label="Bacteriological Status" value={selectedRecord.bacteriological_status ? selectedRecord.bacteriological_status.toLowerCase().replace(/\b\w/g, c => c.toUpperCase()) : null} />
                  <DetailRow label="Treatment Facility" value={selectedRecord.treatment_facility} />
                  <DetailRow label="Started Treatment" value={formatDate(selectedRecord.date_started_treatment)} />
                  <DetailRow label="Outcome Date" value={formatDate(selectedRecord.date_of_outcome)} />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
