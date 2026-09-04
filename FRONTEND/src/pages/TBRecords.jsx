import { useState, useEffect, useCallback } from "react";
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
  "ON TREATMENT": { bg: '#FFFBEB', text: '#92400E', dot: '#B45309' },
  "TREATMENT COMPLETED": { bg: '#EFF6FF', text: '#1E40AF', dot: '#2563EB' },
  "CURED": { bg: '#ECFDF5', text: '#047857', dot: '#059669' },
  "DIED": { bg: '#FEF2F2', text: '#991B1B', dot: '#B91C1C' },
  "LOST TO FOLLOW-UP": { bg: '#F3F4F6', text: '#374151', dot: '#6B7280' },
  "EXCLUDED": { bg: '#F1F5F9', text: '#64748B', dot: '#94A3B8' },
  "NOT EVALUATED": { bg: '#F5F3FF', text: '#5B21B6', dot: '#7C3AED' },
  "PENDING": { bg: '#FFFBEB', text: '#92400E', dot: '#B45309' },
};

function StatusBadge({ status }) {
  const value = (status || "PENDING").trim();
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
    const d = new Date(dateStr.includes('T') ? dateStr : dateStr + 'T00:00:00');
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
      <span className="text-xs font-semibold text-right" style={{ color: '#0F2D52' }}>{displayValue != null ? displayValue : "—"}</span>
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
const ALL_YEARS = ["2026","2025","2024","2023"];
const ALL_OUTCOME_STATUSES = [
  "ON TREATMENT", "CURED", "TREATMENT COMPLETED",
  "DIED", "LOST TO FOLLOW-UP", "EXCLUDED", "NOT EVALUATED",
];
const ALL_SEX_OPTIONS = ["Male", "Female"];
const ALL_VALIDATION_STATUSES = ["Validated", "Not Validated"];
const ALL_SOURCE_TYPES = ["DSTB", "MN"];
const ALL_LOCATION_CLASSIFICATIONS = ["Pasig City", "Non-Pasig"];

export default function TBRecords() {
  const [records, setRecords] = useState([]);
  const [barangays, setBarangays] = useState([]);
  const [outcomeStatuses, setOutcomeStatuses] = useState([]);
  const [bacteriologicalStatuses, setBacteriologicalStatuses] = useState([]);
  const [sexStatuses, setSexStatuses] = useState([]);
  const [validationStatuses, setValidationStatuses] = useState([]);
  const [sourceTypes, setSourceTypes] = useState([]);
  const [locationClassifications, setLocationClassifications] = useState([]);
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
  const [selectedSourceType, setSelectedSourceType] = useState("");
  const [selectedLocationClassification, setSelectedLocationClassification] = useState("");
  const [facilities, setFacilities] = useState([]);
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [pendingFilters, setPendingFilters] = useState({});
  const [pagination, setPagination] = useState({ limit: 20, total: 0, totalPages: 1 });
  const [sortField, setSortField] = useState("date_of_diagnosis");
  const [sortDirection, setSortDirection] = useState("desc");
  const [exporting, setExporting] = useState(false);

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
    { key: 'source', label: 'Source Type', value: selectedSourceType },
    { key: 'location', label: 'Location', value: selectedLocationClassification },
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
    source: setSelectedSourceType,
    location: setSelectedLocationClassification,
  };

  const removeFilter = (key) => {
    if (filterSetters[key]) filterSetters[key]("");
    setCurrentPage(1);
  };

  const clearAllFilters = () => {
    setSearchTerm(""); setSelectedYear(""); setSelectedMonth("");
    setSelectedBarangay(""); setSelectedOutcomeStatus(""); setSelectedFacility("");
    setSelectedSex(""); setSelectedBacteriologicalStatus(""); setSelectedValidationStatus("");
    setSelectedSourceType(""); setSelectedLocationClassification("");
    setSortField("date_of_diagnosis");
    setSortDirection("desc");
    setCurrentPage(1);
  };

  /* ─── Sort handler (2-state toggle: desc ↔ asc) ─── */
  const handleSort = (field) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "desc" ? "asc" : "desc");
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
    setCurrentPage(1);
  };

  /* ─── CSV Export handler ─── */
  const handleExport = async () => {
    setExporting(true);
    try {
      const params = buildFilterParams();
      const qs = params.toString();
      const url = `/api/tb/cases/export${qs ? `?${qs}` : ''}`;
      const res = await API.get(url, { responseType: 'blob' });
      const blob = res.data;
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = 'tb_records_export.csv';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(objectUrl), 100);
    } catch (err) {
      console.error("Export failed:", err);
      alert("Export failed. Please try again.");
    } finally {
      setExporting(false);
    }
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
      source: selectedSourceType,
      location: selectedLocationClassification,
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
    setSelectedSourceType(pendingFilters.source || "");
    setSelectedLocationClassification(pendingFilters.location || "");
    setCurrentPage(1);
    setShowAdvancedFilters(false);
  };

  const clearPendingFilters = () => {
    setPendingFilters({ year: "", month: "", barangay: "", outcome: "", facility: "", sex: "", bacteriological: "", validation: "", source: "", location: "" });
  };

  /* ─── Format chip display ─── */
  const formatChipValue = (key, value) => {
    if (!value) return "";
    if (key === 'year') return value;
    if (key === 'month') return value;
    return value.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  };

  /* ─── Shared filter params builder ─── */
  const buildFilterParams = useCallback(() => {
    const params = new URLSearchParams();
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
    if (selectedSourceType) params.append("source_type", selectedSourceType);
    if (selectedLocationClassification) params.append("location_classification", selectedLocationClassification);
    return params;
  }, [debouncedSearch, selectedBarangay, selectedYear, selectedMonth, selectedOutcomeStatus, selectedFacility, selectedSex, selectedBacteriologicalStatus, selectedValidationStatus, selectedSourceType, selectedLocationClassification]);

  /* ─── Fetch metrics (filter-aware) ─── */
  const fetchMetrics = useCallback(async () => {
    try {
      const params = buildFilterParams();
      const qs = params.toString();
      const res = await API.get(`/api/tb/dashboard/summary${qs ? `?${qs}` : ''}`);
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
  }, [buildFilterParams]);

  useEffect(() => { fetchMetrics(); }, [fetchMetrics]);

  /* ─── Fetch barangays ─── */
  useEffect(() => {
    const controller = new AbortController();
    const fetchBarangays = async () => {
      try {
        const res = await API.get("/api/tb/barangays", { signal: controller.signal });
        setBarangays(res.data.barangays.map(b => b.barangay_name || b.name).filter(Boolean).sort());
      } catch (err) {
        if (err.name !== 'CanceledError') console.error("Failed to fetch barangays:", err);
      }
    };
    fetchBarangays();
    return () => controller.abort();
  }, []);

  /* ─── Fetch facilities ─── */
  useEffect(() => {
    const controller = new AbortController();
    const fetchFacilities = async () => {
      try {
        const res = await API.get("/api/tb/facilities", { signal: controller.signal });
        const names = (res.data.facilities || []).map(f => (f.name || f.facility_name || '').trim()).filter(Boolean).sort();
        setFacilities([...new Set(names)]);
      } catch (err) {
        if (err.name !== 'CanceledError') console.error("Failed to fetch facilities:", err);
      }
    };
    fetchFacilities();
    return () => controller.abort();
  }, []);

  /* ─── Fetch filter options (sex, bacteriological status, outcome status, validation, source, location) ─── */
  useEffect(() => {
    const controller = new AbortController();
    const fetchFilterOptions = async () => {
      try {
        const res = await API.get("/api/tb/filter-options", { signal: controller.signal });
        setSexStatuses((res.data.sex || []).filter(Boolean).sort());
        setBacteriologicalStatuses((res.data.bacteriological_status || []).filter(Boolean).sort());
        setOutcomeStatuses((res.data.outcome_status || []).filter(Boolean).sort());
        setValidationStatuses((res.data.validation_status || []).filter(Boolean).sort());
        setSourceTypes((res.data.source_type || []).filter(Boolean).sort());
        setLocationClassifications((res.data.location_classification || []).filter(Boolean).sort());
      } catch (err) {
        if (err.name !== 'CanceledError') {
          setSexStatuses(ALL_SEX_OPTIONS);
          setBacteriologicalStatuses([]);
          setOutcomeStatuses(ALL_OUTCOME_STATUSES);
          setValidationStatuses(ALL_VALIDATION_STATUSES);
          setSourceTypes(ALL_SOURCE_TYPES);
          setLocationClassifications(ALL_LOCATION_CLASSIFICATIONS);
        }
      }
    };
    fetchFilterOptions();
    return () => controller.abort();
  }, []);

  /* ─── Fetch cases ─── */
  useEffect(() => {
    let cancelled = false;
    const fetchCases = async () => {
      setLoading(true);
      try {
        const params = buildFilterParams();
        params.append("page", currentPage);
        params.append("limit", pagination.limit);
        params.append("sortField", sortField);
        params.append("sortDirection", sortDirection);
        const res = await API.get(`/api/tb/cases?${params.toString()}`);
        if (cancelled) return;
        setError(null);
        const cases = res.data.cases || [];
        setRecords(cases);
        setPagination(res.data.pagination || { limit: 20, total: 0, totalPages: 1 });
      } catch (err) {
        if (!cancelled) {
          console.error("Failed to fetch cases:", err);
          setError("Failed to load records. Please try again.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchCases();
    return () => { cancelled = true; };
  }, [currentPage, buildFilterParams, pagination.limit, sortField, sortDirection]);

  return (
    <div className="flex flex-col gap-5">

      {/* ── Metric Cards ── */}
      <div>
        <div className="rounded-xl" style={{ background: '#ffffff', boxShadow: '0 4px 24px rgba(15, 45, 82, 0.12), 0 2px 8px rgba(15, 45, 82, 0.08)' }}>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
            {/* 1. Total TB Cases */}
            <div className="flex flex-col px-5 py-5 relative">
              <div className="flex items-center gap-2">
                <i className="ri-file-list-3-line text-sm" style={{ color: '#6B7FA3' }} />
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
                  <i className="ri-first-aid-kit-line text-sm" style={{ color: '#B8956A' }} />
                  <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#64748B' }}>On Treatment</span>
                </div>
                 <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: '#FFFBEB', color: '#92400E' }}>
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
                  <i className="ri-check-double-line text-sm" style={{ color: '#6B9E8A' }} />
                  <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#64748B' }}>Cured</span>
                </div>
                 <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: '#ECFDF5', color: '#047857' }}>
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
                  <i className="ri-emotion-sad-line text-sm" style={{ color: '#B07070' }} />
                  <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#64748B' }}>Died</span>
                </div>
                 <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: '#FEF2F2', color: '#991B1B' }}>
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
                  <i className="ri-user-unfollow-line text-sm" style={{ color: '#8B7BA3' }} />
                  <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#64748B' }}>Lost to Follow-up</span>
                </div>
                 <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: '#F3F4F6', color: '#374151' }}>
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
                  <i className="ri-checkbox-circle-line text-sm" style={{ color: '#6B7FA3' }} />
                  <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#64748B' }}>Treatment Completed</span>
                </div>
                 <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: '#EFF6FF', color: '#1E40AF' }}>
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
          <div className="flex flex-col gap-3 px-6 py-2 sm:flex-row sm:items-center sm:justify-between" style={{ borderBottom: '1px solid #DBEAFE' }}>
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
                  placeholder="Search records..."
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
                className="inline-flex items-center justify-center h-8 w-8 text-xs font-semibold"
                style={{ background: activeFilterCount > 0 ? '#0F2D52' : '#F3F4F6', color: activeFilterCount > 0 ? '#ffffff' : '#374151', border: activeFilterCount > 0 ? '1px solid #0F2D52' : '1px solid #D1D5DB', borderRadius: 4, transition: 'background 0.15s, color 0.15s, border-color 0.15s, opacity 0.15s' }}
                onMouseEnter={e => { if (activeFilterCount > 0) { e.currentTarget.style.background = '#174A7E'; e.currentTarget.style.borderColor = '#174A7E'; } else { e.currentTarget.style.background = '#E5E7EB'; } }}
                onMouseLeave={e => { if (activeFilterCount > 0) { e.currentTarget.style.background = '#0F2D52'; e.currentTarget.style.borderColor = '#0F2D52'; } else { e.currentTarget.style.background = '#F3F4F6'; } }}
              >
                <i className="ri-filter-3-line" />
                {activeFilterCount > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-bold" style={{ background: '#3B82F6', color: '#ffffff' }}>
                    {activeFilterCount}
                  </span>
                )}
              </button>
              <button
                onClick={handleExport}
                disabled={exporting}
                className="inline-flex items-center justify-center h-8 w-8 text-xs font-semibold disabled:opacity-50"
                style={{ background: '#F3F4F6', color: '#374151', border: '1px solid #D1D5DB', borderRadius: 4, transition: 'background 0.15s, color 0.15s, border-color 0.15s' }}
                onMouseEnter={e => { e.currentTarget.style.background = '#E5E7EB'; }}
                onMouseLeave={e => { e.currentTarget.style.background = '#F3F4F6'; }}
                title="Export to CSV"
              >
                {exporting ? <i className="ri-loader-4-line animate-spin" /> : <i className="ri-download-2-line" />}
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
                   style={{ background: '#F1F5F9', color: '#334155' }}
                >
                  {f.label}: {formatChipValue(f.key, f.value)}
                  <button
                    onClick={() => removeFilter(f.key)}
                    className="inline-flex h-4 w-4 items-center justify-center text-[10px]"
                    style={{ color: '#94A3B8', borderRadius: 4 }}
                    aria-label={`Remove ${f.label} filter`}
                  >
                    ×
                  </button>
                </span>
              ))}
                  <button
                    onClick={clearAllFilters}
                    className="text-[11px] font-medium ml-1"
                    style={{ color: '#374151', background: '#F3F4F6', border: '1px solid #D1D5DB', borderRadius: 4, padding: '2px 8px', transition: 'background 0.15s, color 0.15s, border-color 0.15s, opacity 0.15s' }}
                    onMouseEnter={e => { e.currentTarget.style.background = '#E5E7EB'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = '#F3F4F6'; }}
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
                  {[
                    { label: "Case ID", field: "id", idx: 0 },
                    { label: "Barangay", field: "barangay_name", idx: 1 },
                    { label: "Age", field: "age", idx: 2 },
                    { label: "Sex", field: null, idx: 3 },
                    { label: "Diagnosis Date", field: "date_of_diagnosis", idx: 4 },
                    { label: "Facility", field: "screening_facility", idx: 5 },
                    { label: "Source", field: "source_type", idx: 6 },
                    { label: "Bacteriologic Status", field: null, idx: 7 },
                    { label: "Status", field: null, idx: 8 },
                    { label: "Action", field: null, idx: 9 },
                  ].map(({ label, field, idx }) => {
                    const isActive = field && sortField === field;
                    return (
                      <th key={label}
                        className={`${idx === 0 ? 'pl-6' : 'px-3'} pr-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider whitespace-nowrap ${idx === 5 ? 'max-w-[200px]' : ''} ${field ? 'cursor-pointer select-none' : ''}`}
                        style={{ color: isActive ? '#93C5FD' : '#ffffff', borderBottom: '1px solid #1E40AF', borderRight: idx < 9 ? '1px solid #1E40AF' : 'none', transition: 'color 0.15s' }}
                        onClick={field ? () => handleSort(field) : undefined}
                        onMouseEnter={e => { if (field && !isActive) e.currentTarget.style.color = '#CBD5E1'; }}
                        onMouseLeave={e => { if (field && !isActive) e.currentTarget.style.color = '#ffffff'; }}
                      >
                        <span className="inline-flex items-center gap-1">
                          {label}
                          {field && (
                            <span className="inline-flex flex-col leading-none" style={{ gap: '1px' }}>
                              <i className="ri-arrow-up-s-line" style={{ fontSize: '8px', lineHeight: '8px', color: isActive && sortDirection === 'asc' ? '#93C5FD' : 'rgba(255,255,255,0.25)' }} />
                              <i className="ri-arrow-down-s-line" style={{ fontSize: '8px', lineHeight: '8px', color: isActive && sortDirection === 'desc' ? '#93C5FD' : 'rgba(255,255,255,0.25)' }} />
                            </span>
                          )}
                        </span>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <tr key={`skeleton-${i}`} style={{ borderBottom: '1px solid #E2E8F0', background: i % 2 === 0 ? '#ffffff' : '#F8FAFC' }}>
                      {Array.from({ length: 10 }).map((_, j) => (
                        <td key={j} className={`${j === 0 ? 'pl-6' : 'px-3'} pr-3 py-2`} style={{ borderRight: j < 9 ? '1px solid #E2E8F0' : 'none' }}>
                          <div className="h-3 rounded animate-pulse" style={{
                             background: 'linear-gradient(90deg, #F1F5F9 25%, #E2E8F0 50%, #F1F5F9 75%)',
                            backgroundSize: '200% 100%', animation: 'shimmer 1.5s infinite',
                            width: j === 0 ? '60px' : j === 5 ? '140px' : j === 6 ? '60px' : j === 7 ? '120px' : j === 8 ? '90px' : j === 9 ? '32px' : '80px',
                          }} />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : error ? (
                  <tr>
                    <td colSpan={10} className="px-5 py-12 text-center text-sm" style={{ color: '#DC2626' }}>
                      <div className="flex flex-col items-center gap-3">
                        <i className="ri-error-warning-line text-2xl" />
                        <p>{error}</p>
                        <button
                          onClick={() => { setError(null); setCurrentPage(1); }}
                          className="px-3 py-1.5 text-xs font-semibold rounded"
                          style={{ background: '#0F2D52', color: '#ffffff' }}
                        >
                          Retry
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : records.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-5 py-12 text-center text-sm" style={{ color: '#94A3B8' }}>
                      No records found matching your filters.
                    </td>
                  </tr>
                ) : (
                  records.map((record, idx) => (
                    <tr key={record.id} className="hover:bg-blue-50 transition-colors"
                      style={{ borderBottom: '1px solid #E2E8F0', background: idx % 2 === 0 ? '#ffffff' : '#F8FAFC' }}>
                      <td className="pl-6 pr-3 py-2" style={{ borderRight: '1px solid #E2E8F0' }}>
                        <span className="font-bold" style={{ color: '#0F2D52' }}>{String(record.id).padStart(4, "0")}</span>
                      </td>
                      <td className="px-3 py-2 text-sm" style={{ color: '#334155', borderRight: '1px solid #E2E8F0' }}>{record.barangay_name}</td>
                      <td className="px-3 py-2 text-sm" style={{ color: '#334155', borderRight: '1px solid #E2E8F0' }}>{record.age}</td>
                      <td className="px-3 py-2 text-sm" style={{ color: '#334155', borderRight: '1px solid #E2E8F0' }}>{record.sex}</td>
                      <td className="px-3 py-2 text-sm" style={{ color: '#334155', borderRight: '1px solid #E2E8F0' }}>{formatDate(record.date_of_diagnosis)}</td>
                      <td className="px-3 py-2 text-sm max-w-[200px] whitespace-nowrap overflow-hidden text-ellipsis" style={{ color: '#334155', borderRight: '1px solid #E2E8F0' }} title={record.screening_facility}>{record.screening_facility}</td>
                      <td className="px-3 py-2 text-sm" style={{ color: '#334155', borderRight: '1px solid #E2E8F0' }}>
                        {record.source_type ? (
                          <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: record.source_type === 'DSTB' ? '#EFF6FF' : '#F0FDF4', color: record.source_type === 'DSTB' ? '#1E40AF' : '#166534' }}>
                            {record.source_type}
                          </span>
                        ) : '—'}
                      </td>
                      <td className="px-3 py-2 text-sm" style={{ color: '#334155', borderRight: '1px solid #E2E8F0' }}>{record.bacteriological_status ? record.bacteriological_status.toLowerCase().replace(/\b\w/g, c => c.toUpperCase()) : '—'}</td>
                      <td className="px-3 py-2" style={{ borderRight: '1px solid #E2E8F0' }}>
                        <StatusBadge status={record.outcome_status} />
                      </td>
                      <td className="px-3 py-2 text-center">
                        <button aria-label="View record" onClick={() => setSelectedRecord(record)}
                          className="inline-flex items-center justify-center h-6 w-6 text-sm"
                          style={{ color: '#64748B', borderRadius: 4, transition: 'color 0.15s' }}
                          onMouseEnter={e => { e.currentTarget.style.color = '#0F2D52'; }}
                          onMouseLeave={e => { e.currentTarget.style.color = '#64748B'; }}>
                          <i className="ri-eye-line" />
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
            <div className="flex items-center gap-3">
              <p className="text-xs font-semibold" style={{ color: '#94A3B8' }}>
                {loading ? (
                  <span className="inline-flex items-center gap-1.5">
                    <i className="ri-loader-4-line text-xs animate-spin" /> Loading records...
                  </span>
                ) : (
                  <>Showing {pagination.total === 0 ? 0 : (currentPage - 1) * pagination.limit + 1}–{Math.min(currentPage * pagination.limit, pagination.total)} of {pagination.total} records</>
                )}
              </p>
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-medium" style={{ color: '#94A3B8' }}>Per page:</span>
                <select
                  value={pagination.limit}
                  onChange={(e) => { setPagination(prev => ({ ...prev, limit: Number(e.target.value) })); setCurrentPage(1); }}
                  className="rounded px-1.5 py-1 text-[11px] font-semibold outline-none cursor-pointer"
                  style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', color: '#0F2D52' }}
                >
                  <option value={10}>10</option>
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <button aria-label="Previous page" onClick={() => currentPage > 1 && setCurrentPage(currentPage - 1)}
                disabled={currentPage <= 1 || loading}
                className="inline-flex h-8 w-8 items-center justify-center text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40"
                style={{ background: '#F3F4F6', color: '#374151', border: '1px solid #D1D5DB', borderRadius: 4, transition: 'background 0.15s, color 0.15s, border-color 0.15s, opacity 0.15s' }}
                onMouseEnter={e => { e.currentTarget.style.background = '#E5E7EB'; }}
                onMouseLeave={e => { e.currentTarget.style.background = '#F3F4F6'; }}>
                ‹
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
                      className="inline-flex h-8 w-8 items-center justify-center text-xs font-semibold"
                      style={(currentPage === page ? { background: '#0F2D52', color: '#ffffff', border: '1px solid #0F2D52', borderRadius: 4 } : { background: '#F3F4F6', color: '#374151', border: '1px solid #D1D5DB', borderRadius: 4 })}>
                      {page}
                    </button>
                  )
                );
              })()}
              <button aria-label="Next page" onClick={() => setCurrentPage(currentPage + 1)}
                disabled={currentPage >= pagination.totalPages || pagination.total === 0 || loading}
                className="inline-flex h-8 w-8 items-center justify-center text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40"
                style={{ background: '#F3F4F6', color: '#374151', border: '1px solid #D1D5DB', borderRadius: 4, transition: 'background 0.15s, color 0.15s, border-color 0.15s, opacity 0.15s' }}
                onMouseEnter={e => { e.currentTarget.style.background = '#E5E7EB'; }}
                onMouseLeave={e => { e.currentTarget.style.background = '#F3F4F6'; }}>
                ›
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
                  className="inline-flex h-8 w-8 items-center justify-center shrink-0"
                  style={{ background: 'rgba(255,255,255,0.15)', color: '#ffffff', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 8, transition: 'background 0.15s' }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.25)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.15)'; }}>
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
                    options={outcomeStatuses.length > 0 ? outcomeStatuses : ALL_OUTCOME_STATUSES} placeholder="All Outcomes"
                  />
                  <FilterSelect
                    label="Bacteriological Status"
                    value={pendingFilters.bacteriological || ""} onChange={(v) => updatePending('bacteriological', v)}
                    options={bacteriologicalStatuses} placeholder="All Statuses"
                  />
                  <FilterSelect
                    label="Validation Status"
                    value={pendingFilters.validation || ""} onChange={(v) => updatePending('validation', v)}
                    options={validationStatuses.length > 0 ? validationStatuses : ALL_VALIDATION_STATUSES} placeholder="All Statuses"
                  />
                </div>
              </div>
              <div style={{ borderTop: '1px solid #E2E8F0' }} />
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: '#0F2D52' }}>Classification</h3>
                <div className="space-y-3">
                  <FilterSelect
                    label="Source Type"
                    value={pendingFilters.source || ""} onChange={(v) => updatePending('source', v)}
                    options={sourceTypes.length > 0 ? sourceTypes : ALL_SOURCE_TYPES} placeholder="All Sources"
                  />
                  <FilterSelect
                    label="Location"
                    value={pendingFilters.location || ""} onChange={(v) => updatePending('location', v)}
                    options={locationClassifications.length > 0 ? locationClassifications : ALL_LOCATION_CLASSIFICATIONS} placeholder="All Locations"
                  />
                </div>
              </div>
            </div>
            <div className="sticky bottom-0 flex items-center gap-3 px-6 py-4" style={{ borderTop: '1px solid #E2E8F0', background: '#ffffff' }}>
              <button
                onClick={clearPendingFilters}
                className="flex-1 px-4 py-2.5 text-xs font-medium"
                style={{ background: '#F3F4F6', color: '#374151', border: '1px solid #D1D5DB', borderRadius: 4, transition: 'background 0.15s, color 0.15s, border-color 0.15s, opacity 0.15s' }}
                onMouseEnter={e => { e.currentTarget.style.background = '#E5E7EB'; }}
                onMouseLeave={e => { e.currentTarget.style.background = '#F3F4F6'; }}
              >
                Clear All
              </button>
              <button
                onClick={applyPendingFilters}
                className="flex-1 px-4 py-2.5 text-xs font-semibold"
                style={{ background: '#0F2D52', color: '#ffffff', border: '1px solid #0F2D52', borderRadius: 4, transition: 'background 0.15s, color 0.15s, border-color 0.15s, opacity 0.15s' }}
                onMouseEnter={e => { e.currentTarget.style.background = '#174A7E'; e.currentTarget.style.borderColor = '#174A7E'; }}
                onMouseLeave={e => { e.currentTarget.style.background = '#0F2D52'; e.currentTarget.style.borderColor = '#0F2D52'; }}
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
                  className="inline-flex h-8 w-8 items-center justify-center shrink-0"
                  style={{ background: 'rgba(255,255,255,0.15)', color: '#ffffff', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 8, transition: 'background 0.15s' }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.25)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.15)'; }}>
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
                  <DetailRow label="ITIS Case ID" value={selectedRecord.itis_case_id} />
                  <DetailRow label="Source Type" value={selectedRecord.source_type} />
                  <DetailRow label="Validation Status" value={selectedRecord.validation_status} />
                </div>
              </div>
              <div style={{ borderTop: '1px solid #E2E8F0' }} />
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: '#0F2D52' }}>Patient Information</h3>
                <div className="space-y-2.5">
                  <DetailRow label="Age" value={selectedRecord.age} />
                  <DetailRow label="Sex" value={selectedRecord.sex} />
                  <DetailRow label="Barangay" value={selectedRecord.barangay_name} />
                  <DetailRow label="Location Classification" value={selectedRecord.location_classification} />
                  <DetailRow label="Source of Patient" value={selectedRecord.source_of_patient || "Walk-in"} />
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
