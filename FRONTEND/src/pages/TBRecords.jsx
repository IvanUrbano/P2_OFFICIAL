import { useState, useEffect, useCallback } from "react";
import {
  normalizeRecordOutcome, isApprovedOutcome,
} from '../utils/outcomeStatus';
import { describeHistoryEntry, formatHistoryTimestamp, historyActorLabel } from '../utils/caseHistory';
import API from "../api/axios";
import SharedFilterSelect from '../components/FilterSelect';
import ModalCloseButton from '../components/ModalCloseButton';
import { buildRecordKpis } from '../utils/recordKpis';

/* --- Debounce hook --- */
function useDebounce(value, delay = 400) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/* --- Status ? accent color --- */
const statusColors = {
  "ON TREATMENT": { bg: '#FFFBEB', text: '#92400E', dot: '#B45309' },
  "TREATMENT COMPLETED": { bg: '#EFF6FF', text: '#1E40AF', dot: '#2563EB' },
  "CURED": { bg: '#ECFDF5', text: '#047857', dot: '#059669' },
  "DIED": { bg: '#FEF2F2', text: '#991B1B', dot: '#B91C1C' },
  "LOST TO FF-UP": { bg: '#F3F4F6', text: '#374151', dot: '#6B7280' },
  "LOST TO FOLLOW-UP": { bg: '#F3F4F6', text: '#374151', dot: '#6B7280' },
  "FAILED": { bg: '#FEF2F2', text: '#991B1B', dot: '#B91C1C' },
  "TREATMENT FAILED": { bg: '#FEF2F2', text: '#991B1B', dot: '#B91C1C' },
  "DIAGNOSED": { bg: '#F0F9FF', text: '#0369A1', dot: '#0284C7' },
  "EXCLUDED": { bg: '#F1F5F9', text: '#64748B', dot: '#94A3B8' },
  "NOT EVALUATED": { bg: '#F5F3FF', text: '#5B21B6', dot: '#7C3AED' },
  "PENDING": { bg: '#FFFBEB', text: '#92400E', dot: '#B45309' },
};

function StatusBadge({ status, kind = 'outcome' }) {
  if (!status) return <span className="text-[11px] text-slate-400">—</span>;
  // Keep legacy aliases readable when an older API response reaches this view.
  const raw = (status || "PENDING").trim();
  const value = raw === 'PENDING' ? raw : (normalizeRecordOutcome(raw) || raw);
  const unverified = kind === 'outcome' && raw !== 'PENDING' && !isApprovedOutcome(raw);
  const colors = statusColors[value] || { bg: '#F1F5F9', text: '#64748B', dot: '#94A3B8' };
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold whitespace-nowrap"
      style={{ background: colors.bg, color: colors.text }}
    >
      <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: colors.dot }} />
      {value.toLowerCase().replace(/\b\w/g, c => c.toUpperCase())}
      {/* Mark values outside the seven treatment outcome categories. */}
      {unverified && (
        <span
          className="ml-0.5 text-[9px] font-extrabold"
          style={{ color: '#B45309' }}
          title="Not a recognized treatment outcome; shown as stored for review"
        >
          ⚠
        </span>
      )}
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

/* --- One KPI card: label + optional badge, big figure, short note. With `onClick` it is a
 *     one-click filter for the table (highlighted while that filter is on). --- */
function KpiCard({ icon, iconColor, label, value, badge, sub, subTitle, subColor = '#94A3B8', active = false, onClick, title, last = false }) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <i className={`${icon} text-sm`} style={{ color: iconColor }} />
          <span className="text-[10px] font-bold uppercase tracking-wider truncate" style={{ color: '#64748B' }}>{label}</span>
        </div>
        {badge && (
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap" style={badge.style} title={badge.title}>{badge.text}</span>
        )}
      </div>
      <div className="h-px my-3" style={{ background: '#E2E8F0' }} />
      <p className="text-2xl lg:text-3xl font-extrabold" style={{ color: '#0F2D52' }}>{value}</p>
      {sub && <span className="text-[11px] font-medium mt-1" style={{ color: subColor }} title={subTitle}>{sub}</span>}
      {!last && <div className="hidden lg:block absolute right-0 top-1/2 -translate-y-1/2 w-px h-10" style={{ background: '#E2E8F0' }} />}
    </>
  );
  const base = 'flex flex-col px-5 py-5 relative text-left';
  if (!onClick) return <div className={base}>{body}</div>;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={title}
      className={`${base} transition-colors hover:bg-slate-50`}
      style={active ? { background: '#EEF3F9', boxShadow: 'inset 0 -2px 0 #0F2D52' } : undefined}
    >
      {body}
    </button>
  );
}

/* --- Filter select for advanced sidebar; shares the app-wide dropdown UI --- */
function FilterSelect({ label, value, onChange, options, placeholder }) {
  const formatOption = (opt) => {
    if (!opt) return '';
    return opt.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  };
  return (
    <SharedFilterSelect
      label={label}
      value={value}
      onChange={onChange}
      style={{ width: '100%' }}
      selectStyle={{ flex: 1, width: '100%' }}
    >
      <option value="">{placeholder}</option>
      {options.map((opt) => (
        <option key={opt} value={opt}>
          {formatOption(opt)}
        </option>
      ))}
    </SharedFilterSelect>
  );
}

const monthName = (month) => new Date(2000, Number(month) - 1, 1)
  .toLocaleDateString('en-US', { month: 'long' });

// A Non-Pasig resident has no Pasig barangay — their residence arrives as free
// text and is what the Barangay column/panel shows for those rows.
const residenceLabel = (record) =>
  record.residence_barangay_name
    ? `${record.residence_barangay_name}${record.residence_city ? `, ${record.residence_city}` : ''}`
    : null;

export default function TBRecords() {
  const [records, setRecords] = useState([]);
  const [barangays, setBarangays] = useState([]);
  const [outcomeStatuses, setOutcomeStatuses] = useState([]);
  const [bacteriologicalStatuses, setBacteriologicalStatuses] = useState([]);
  const [sexStatuses, setSexStatuses] = useState([]);
  const [validationStatuses, setValidationStatuses] = useState([]);
  const [sourceTypes, setSourceTypes] = useState([]);
  const [locationClassifications, setLocationClassifications] = useState([]);
  const [caseStatuses, setCaseStatuses] = useState([]);
  const [availableYears, setAvailableYears] = useState([]);
  const [availableMonths, setAvailableMonths] = useState([]);
  const [monthsByYear, setMonthsByYear] = useState({});
  const [metrics, setMetrics] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState("");
  const debouncedSearch = useDebounce(searchTerm, 400);
  const [selectedYear, setSelectedYear] = useState("");
  const [selectedMonth, setSelectedMonth] = useState("");
  const [selectedBarangay, setSelectedBarangay] = useState("");
  const [selectedOutcomeStatus, setSelectedOutcomeStatus] = useState("");
  const [selectedCaseStatus, setSelectedCaseStatus] = useState("");
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
  const [exportError, setExportError] = useState(null);
  const [detailTab, setDetailTab] = useState("details");
  const [caseHistory, setCaseHistory] = useState(null); // null = not fetched yet
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState(null);

  /* --- Advanced Filters Modal helpers --- */
  const openAdvancedFilters = () => {
    setPendingFilters({
      year: selectedYear,
      month: selectedMonth,
      barangay: selectedBarangay,
      outcome: selectedOutcomeStatus,
      status: selectedCaseStatus,
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
    setSelectedCaseStatus(pendingFilters.status || "");
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
    setPendingFilters({ year: "", month: "", barangay: "", outcome: "", status: "", facility: "", sex: "", bacteriological: "", validation: "", source: "", location: "" });
  };

  /* --- Format chip display --- */
  const formatChipValue = (key, value) => {
    if (!value) return "";
    if (key === 'year') return value;
    if (key === 'month') return value;
    return value.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  };

  /* --- Shared filter params builder --- */
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
    if (selectedCaseStatus) params.append("status", selectedCaseStatus);
    if (selectedFacility) params.append("facility", selectedFacility);
    if (selectedSex) params.append("sex", selectedSex);
    if (selectedBacteriologicalStatus) params.append("bacteriological_status", selectedBacteriologicalStatus);
    if (selectedValidationStatus) params.append("validation_status", selectedValidationStatus);
    if (selectedSourceType) params.append("source_type", selectedSourceType);
    if (selectedLocationClassification) params.append("location_classification", selectedLocationClassification);
    return params;
  }, [debouncedSearch, selectedBarangay, selectedYear, selectedMonth, selectedOutcomeStatus, selectedCaseStatus, selectedFacility, selectedSex, selectedBacteriologicalStatus, selectedValidationStatus, selectedSourceType, selectedLocationClassification]);

  /* --- Fetch metrics (filter-aware) ---
   * The cards cover every filter EXCEPT Case Status and Treatment Outcome: those two are what
   * the status / outcome cards set when clicked, and the rates (fatality, lost to follow-up) need
   * all evaluated outcomes as their base — filtering to "Died" would make every rate 100%. */
  const fetchMetrics = useCallback(async () => {
    try {
      const params = buildFilterParams();
      params.delete('outcome');
      params.delete('status');
      const qs = params.toString();
      const [summaryRes, tsrRes] = await Promise.all([
        API.get(`/api/tb/dashboard/summary${qs ? `?${qs}` : ''}`),
        // Treatment Success Rate: from GET /api/tb/treatment-success-rate (the cohort-based
        // methodology — Cured + Completed / patients whose treatment started in year Y-1).
        API.get(`/api/tb/treatment-success-rate${qs ? `?${qs}` : ''}`).catch(() => ({ data: null })),
      ]);
      if (!summaryRes.data.summary) return;
      setMetrics(buildRecordKpis(summaryRes.data.summary, tsrRes.data));
    } catch (err) {
      if (import.meta.env.DEV) console.error("Failed to fetch metrics:", err);
    }
  }, [buildFilterParams]);

  useEffect(() => { fetchMetrics(); }, [fetchMetrics]);
  /* --- KPI cards as one-click filters. Status and outcome never combine (a record with a final
   *     outcome is no longer On Treatment), so choosing one clears the other. --- */
  const toggleStatusCard = (status) => {
    setSelectedCaseStatus((prev) => (String(prev).toUpperCase() === status ? "" : status));
    setSelectedOutcomeStatus("");
    setCurrentPage(1);
  };
  const toggleOutcomeCard = (outcome) => {
    setSelectedOutcomeStatus((prev) => (String(prev).toUpperCase() === outcome ? "" : outcome));
    setSelectedCaseStatus("");
    setCurrentPage(1);
  };

  /* --- Derived active filter list --- */
  const activeFilters = [
    { key: 'year', label: 'Year', value: selectedYear },
    { key: 'month', label: 'Month', value: selectedMonth },
    { key: 'barangay', label: 'Barangay', value: selectedBarangay },
    { key: 'outcome', label: 'Outcome', value: selectedOutcomeStatus },
    { key: 'status', label: 'Case Status', value: selectedCaseStatus },
    { key: 'facility', label: 'Facility', value: selectedFacility },
    { key: 'sex', label: 'Sex', value: selectedSex },
    { key: 'bacteriological', label: 'Bacteriological', value: selectedBacteriologicalStatus },
    { key: 'validation', label: 'Validation', value: selectedValidationStatus },
    { key: 'source', label: 'Source Type', value: selectedSourceType },
    { key: 'location', label: 'Location', value: selectedLocationClassification },
  ].filter(f => f.value);

  const activeFilterCount = activeFilters.length;

  /* --- Filter setter map for chips --- */
  const filterSetters = {
    year: setSelectedYear,
    month: setSelectedMonth,
    barangay: setSelectedBarangay,
    outcome: setSelectedOutcomeStatus,
    status: setSelectedCaseStatus,
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

  /* --- Sort handler (2-state toggle: desc ? asc) --- */
  const handleSort = (field) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "desc" ? "asc" : "desc");
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
    setCurrentPage(1);
  };

  /* --- CSV Export handler --- */
  const handleExport = async () => {
    setExporting(true);
    setExportError(null);
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
      if (import.meta.env.DEV) console.error("Export failed:", err);
      setExportError("Export failed. Please try again.");
    } finally {
      setExporting(false);
    }
  };

  /* --- Fetch barangays --- */
  useEffect(() => {
    const controller = new AbortController();
    const fetchBarangays = async () => {
      try {
        const res = await API.get("/api/tb/barangays", { signal: controller.signal });
        setBarangays(res.data.barangays.map(b => b.barangay_name || b.name).filter(Boolean).sort());
      } catch (err) {
        if (err.name !== 'CanceledError' && import.meta.env.DEV) console.error("Failed to fetch barangays:", err);
      }
    };
    fetchBarangays();
    window.addEventListener('focus', fetchBarangays);
    return () => { controller.abort(); window.removeEventListener('focus', fetchBarangays); };
  }, []);

  /* --- Fetch facilities --- */
  useEffect(() => {
    const controller = new AbortController();
    const fetchFacilities = async () => {
      try {
        const res = await API.get("/api/tb/facilities", { signal: controller.signal });
        const names = (res.data.facilities || []).map(f => (f.name || f.facility_name || '').trim()).filter(Boolean).sort();
        setFacilities([...new Set(names)]);
      } catch (err) {
        if (err.name !== 'CanceledError' && import.meta.env.DEV) console.error("Failed to fetch facilities:", err);
      }
    };
    fetchFacilities();
    window.addEventListener('focus', fetchFacilities);
    return () => { controller.abort(); window.removeEventListener('focus', fetchFacilities); };
  }, []);

  /* --- Fetch filter options (sex, bacteriological status, outcome status, validation, source, location) --- */
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
        setCaseStatuses(res.data.case_status || []);
        setAvailableYears((res.data.years || []).map(String));
        setAvailableMonths(res.data.months || []);
        setMonthsByYear(res.data.months_by_year || {});
      } catch (err) {
        if (err.name !== 'CanceledError' && import.meta.env.DEV) console.error('Failed to fetch filter options:', err);
      }
    };
    fetchFilterOptions();
    window.addEventListener('focus', fetchFilterOptions);
    return () => { controller.abort(); window.removeEventListener('focus', fetchFilterOptions); };
  }, []);

  /* --- Fetch cases --- */
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
          if (import.meta.env.DEV) console.error("Failed to fetch cases:", err);
          setError("Failed to load records. Please try again.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchCases();
    return () => { cancelled = true; };
  }, [currentPage, buildFilterParams, pagination.limit, sortField, sortDirection]);

  /* --- Case History for the open record ---
     Fetched by the stable System Reference (case_no), the same key a re-sent update is
     matched on, so everything shown here belongs to THIS case — never to the
     patient. A later episode of the same person is a different Case ID and a
     different record with its own history. Falls back to the internal id for a
     row that was imported without a System Reference. */
  useEffect(() => {
    setDetailTab("details");
    setCaseHistory(null);
    setHistoryError(null);
    if (!selectedRecord) return undefined;
    const key = selectedRecord.case_no || String(selectedRecord.id ?? "");
    if (!key) return undefined;

    let cancelled = false;
    setHistoryLoading(true);
    API.get(`/api/tb/cases/${encodeURIComponent(key)}/history`)
      .then((res) => {
        if (cancelled) return;
        setCaseHistory(Array.isArray(res.data?.history) ? res.data.history : []);
      })
      .catch((err) => {
        if (cancelled) return;
        if (import.meta.env.DEV) console.error("Failed to fetch case history:", err);
        setCaseHistory([]);
        setHistoryError("Case history could not be loaded.");
      })
      .finally(() => { if (!cancelled) setHistoryLoading(false); });
    return () => { cancelled = true; };
  }, [selectedRecord]);

  return (
    <div className="flex flex-col gap-5">
      {exportError && (
        <div role="alert" className="flex items-start justify-between gap-3 px-4 py-3 rounded-lg text-xs" style={{ background: '#FEF2F2', border: '1px solid #FECACA', color: '#991B1B' }}>
          <span>{exportError}</span>
          <ModalCloseButton onClick={() => setExportError(null)} label="Dismiss export error" />
        </div>
      )}

      {/* -- KPI Cards -- */}
      <div>
        <div className="rounded-xl" style={{ background: '#ffffff', boxShadow: '0 4px 24px rgba(15, 45, 82, 0.12), 0 2px 8px rgba(15, 45, 82, 0.08)' }}>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
            <KpiCard
              icon="ri-file-list-3-line" iconColor="#6B7FA3" label="Total TB Cases"
              value={metrics ? metrics.total.toLocaleString() : '---'}
              sub={activeFilters.some((f) => f.key !== 'status' && f.key !== 'outcome') || debouncedSearch ? 'Matching your filters' : 'All records'}
            />
            <KpiCard
              icon="ri-first-aid-kit-line" iconColor="#B8956A" label="On Treatment"
              value={metrics ? metrics.onTreatment.toLocaleString() : '---'}
              badge={metrics && metrics.onTreatmentShare != null ? { text: `${metrics.onTreatmentShare}%`, title: 'Share of all records', style: { background: '#FFFBEB', color: '#92400E' } } : null}
              sub="Currently in treatment"
              active={String(selectedCaseStatus).toUpperCase() === 'ON TREATMENT'}
              onClick={() => toggleStatusCard('ON TREATMENT')}
              title="Show only records that are On Treatment"
            />
            <KpiCard
              icon="ri-time-line" iconColor="#B07070" label="Not Yet Started"
              value={metrics ? metrics.diagnosed.toLocaleString() : '---'}
              sub={metrics && metrics.diagnosedOverdue > 0 ? `${metrics.diagnosedOverdue.toLocaleString()} diagnosed 30+ days ago` : 'Diagnosed, no treatment start'}
              subColor={metrics && metrics.diagnosedOverdue > 0 ? '#B91C1C' : '#94A3B8'}
              subTitle="Diagnosed with no treatment start recorded. The count in red is those diagnosed 30 or more days ago, which need follow-up."
              active={String(selectedCaseStatus).toUpperCase() === 'DIAGNOSED'}
              onClick={() => toggleStatusCard('DIAGNOSED')}
              title="Show only records that are Diagnosed and have not started treatment"
            />
            <KpiCard
              icon="ri-checkbox-circle-line" iconColor="#6B9E8A" label="Treatment Success Rate"
              value={metrics ? (metrics.successRate == null ? 'N/A' : `${metrics.successRate}%`) : '---'}
              sub={metrics
                ? (metrics.successRate == null
                  ? 'No previous-year treatment cohort'
                  : `${metrics.cohortTotal.toLocaleString()} patients${metrics.cohortYear ? ` (${metrics.cohortYear} cohort)` : ''}`)
                : ''}
              subTitle="Cured or Treatment Completed, among patients whose treatment started in the previous year."
            />
            <KpiCard
              icon="ri-user-unfollow-line" iconColor="#8B7BA3" label="Lost to Follow-up"
              value={metrics ? metrics.ltfu.toLocaleString() : '---'}
              badge={metrics && metrics.ltfuRate != null ? { text: `${metrics.ltfuRate}%`, title: 'Share of evaluated outcomes', style: { background: '#F3F4F6', color: '#374151' } } : null}
              sub="Of evaluated outcomes"
              subTitle="Lost to follow-up divided by records with a final outcome (Cured, Completed, Failed, Lost to Follow-up, Died). Records still on treatment are not counted."
              active={String(selectedOutcomeStatus).toUpperCase() === 'LOST TO FOLLOW-UP'}
              onClick={() => toggleOutcomeCard('LOST TO FOLLOW-UP')}
              title="Show only records that were Lost to Follow-up"
            />
            <KpiCard
              icon="ri-heart-pulse-line" iconColor="#B07070" label="Case Fatality Rate"
              value={metrics ? (metrics.fatalityRate == null ? 'N/A' : `${metrics.fatalityRate}%`) : '---'}
              sub={metrics ? (metrics.fatalityRate == null ? 'No evaluated outcomes' : `${metrics.died.toLocaleString()} deaths / ${metrics.evaluated.toLocaleString()} evaluated`) : ''}
              subTitle="Deaths divided by records with a final outcome (Cured, Completed, Failed, Lost to Follow-up, Died). Records still on treatment are not counted."
              active={String(selectedOutcomeStatus).toUpperCase() === 'DIED'}
              onClick={() => toggleOutcomeCard('DIED')}
              title="Show only records with the outcome Died"
              last
            />
          </div>
        </div>
        {(selectedCaseStatus || selectedOutcomeStatus) && (
          <p className="mt-2 px-1 text-[11px]" style={{ color: '#94A3B8' }}>
            The cards cover all records matching your other filters. The table below is narrowed to {formatChipValue(selectedCaseStatus ? 'status' : 'outcome', selectedCaseStatus || selectedOutcomeStatus)}.
          </p>
        )}
      </div>

      {/* -- Table Card -- */}
      <div>
        <div className="rounded-xl overflow-hidden" style={{ background: '#ffffff' }}>

          {/* -- Header -- */}
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

          {/* -- Active Filter Chips -- */}
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

          {/* -- Table (scrollable) -- */}
          <div className="flex-1 min-h-0 overflow-y-auto overflow-x-auto">
            <table className="w-full text-left text-[11px]" style={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#0F2D52' }}>
                  {[
                    { label: "Case ID", field: "source_case_id", idx: 0 },
                    { label: "Barangay", field: "barangay_name", idx: 1 },
                    { label: "Age", field: "age", idx: 2 },
                    { label: "Sex", field: null, idx: 3 },
                    { label: "Diagnosis Date", field: "date_of_diagnosis", idx: 4 },
                    { label: "Facility", field: "screening_facility", idx: 5 },
                    { label: "Source", field: "source_type", idx: 6 },
                    { label: "Bacteriologic Status", field: null, idx: 7 },
                    { label: "Case Status", field: null, idx: 8 },
                    { label: "Treatment Outcome", field: null, idx: 9 },
                    { label: "Action", field: null, idx: 10 },
                  ].map(({ label, field, idx }) => {
                    const isActive = field && sortField === field;
                    return (
                      <th key={label}
                        className={`${idx === 0 ? 'pl-6' : 'px-3'} pr-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider whitespace-nowrap ${idx === 5 ? 'max-w-[200px]' : ''} ${field ? 'cursor-pointer select-none' : ''}`}
                        style={{ color: isActive ? '#93C5FD' : '#ffffff', borderBottom: '1px solid #1E40AF', borderRight: idx < 10 ? '1px solid #1E40AF' : 'none', transition: 'color 0.15s' }}
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
                      {Array.from({ length: 11 }).map((_, j) => (
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
                    <td colSpan={11} className="px-5 py-12 text-center text-sm" style={{ color: '#DC2626' }}>
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
                    <td colSpan={11} className="px-5 py-12 text-center text-sm" style={{ color: '#94A3B8' }}>
                      No records found matching your filters.
                    </td>
                  </tr>
                ) : (
                  records.map((record, idx) => (
                    <tr key={record.id} className="hover:bg-blue-50 transition-colors"
                      style={{ borderBottom: '1px solid #E2E8F0', background: idx % 2 === 0 ? '#ffffff' : '#F8FAFC' }}>
                      <td className="pl-6 pr-3 py-2" style={{ borderRight: '1px solid #E2E8F0' }}>
                        {record.source_case_id
                          ? <span className="font-bold" style={{ color: '#0F2D52' }}>{record.source_case_id}</span>
                          : <span className="italic" style={{ color: '#94A3B8' }}>No Case ID</span>}
                      </td>
                      <td className="px-3 py-2" style={{ color: '#334155', borderRight: '1px solid #E2E8F0' }}>{record.barangay_name || residenceLabel(record) || '—'}</td>
                      <td className="px-3 py-2" style={{ color: '#334155', borderRight: '1px solid #E2E8F0' }}>{record.age}</td>
                      <td className="px-3 py-2" style={{ color: '#334155', borderRight: '1px solid #E2E8F0' }}>{record.sex}</td>
                      <td className="px-3 py-2" style={{ color: '#334155', borderRight: '1px solid #E2E8F0' }}>{formatDate(record.date_of_diagnosis)}</td>
                      <td className="px-3 py-2 max-w-[200px] whitespace-nowrap overflow-hidden text-ellipsis" style={{ color: '#334155', borderRight: '1px solid #E2E8F0' }} title={record.screening_facility}>{record.screening_facility}</td>
                      <td className="px-3 py-2" style={{ color: '#334155', borderRight: '1px solid #E2E8F0' }}>
                        {record.source_type ? (
                          <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: record.source_type === 'DSTB' ? '#EFF6FF' : '#F0FDF4', color: record.source_type === 'DSTB' ? '#1E40AF' : '#166534' }}>
                            {record.source_type}
                          </span>
                        ) : '—'}
                      </td>
                      <td className="px-3 py-2" style={{ color: '#334155', borderRight: '1px solid #E2E8F0' }}>{record.bacteriological_status ? record.bacteriological_status.toLowerCase().replace(/\b\w/g, c => c.toUpperCase()) : '—'}</td>
                      <td className="px-3 py-2" style={{ borderRight: '1px solid #E2E8F0' }}>
                        <StatusBadge status={record.case_status} kind="status" />
                      </td>
                      <td className="px-3 py-2" style={{ borderRight: '1px solid #E2E8F0' }}>
                        {record.treatment_outcome
                          ? <StatusBadge status={record.treatment_outcome} />
                          : record.case_status
                            ? <span className="text-[11px] text-slate-400 cursor-help" title={record.case_status === 'DIAGNOSED' ? 'Diagnosed, not yet on treatment — no final outcome yet' : 'Still on treatment — no final outcome yet'}>—</span>
                            : <span className="text-[11px] text-slate-400">—</span>}
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

          {/* -- Pagination -- */}
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

      {/* -- Advanced Filters Sidebar -- */}
      {showAdvancedFilters && (
        <div className="fixed inset-0 z-[1200] flex justify-end bg-slate-950/20 backdrop-blur-sm">
          <div className="absolute inset-0" onClick={() => setShowAdvancedFilters(false)} />
          <div className="relative w-full max-w-sm h-full overflow-y-auto bg-white" style={{ boxShadow: '-8px 0 40px rgba(15, 45, 82, 0.12)', animation: 'slide-in-right 0.3s ease-out both' }}>
            <div className="sticky top-0 z-10" style={{ background: '#0F2D52' }}>
              <div className="flex items-center justify-between px-6 py-4">
                <h2 className="text-sm font-extrabold tracking-tight" style={{ color: '#ffffff' }}>FILTERS</h2>
                <ModalCloseButton onClick={() => setShowAdvancedFilters(false)} label="Close filters" light />
              </div>
            </div>
            <div className="px-6 py-5 space-y-5">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: '#0F2D52' }}>Date</h3>
                <div className="space-y-3">
                  <FilterSelect
                    label="Year"
                    value={pendingFilters.year || ""} onChange={(v) => setPendingFilters(prev => ({ ...prev, year: v, month: '' }))}
                    options={availableYears} placeholder="All Years"
                  />
                  <FilterSelect
                    label="Month"
                    value={pendingFilters.month || ""} onChange={(v) => updatePending('month', v)}
                    options={(pendingFilters.year ? monthsByYear[pendingFilters.year] || [] : availableMonths).map(monthName)} placeholder="All Months"
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
                <h3 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: '#0F2D52' }}>Treatment</h3>
                <div className="space-y-3">
                  <FilterSelect
                    label="Case Status"
                    value={pendingFilters.status || ""} onChange={(v) => updatePending('status', v)}
                    options={caseStatuses} placeholder="All"
                  />
                  <FilterSelect
                    label="Treatment Outcome"
                    value={pendingFilters.outcome || ""} onChange={(v) => updatePending('outcome', v)}
                    options={outcomeStatuses} placeholder="All"
                  />
                  <FilterSelect
                    label="Bacteriological Status"
                    value={pendingFilters.bacteriological || ""} onChange={(v) => updatePending('bacteriological', v)}
                    options={bacteriologicalStatuses} placeholder="All Statuses"
                  />
                  <FilterSelect
                    label="Validation Status"
                    value={pendingFilters.validation || ""} onChange={(v) => updatePending('validation', v)}
                    options={validationStatuses} placeholder="All Statuses"
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
                    options={sourceTypes} placeholder="All Sources"
                  />
                  <FilterSelect
                    label="Location"
                    value={pendingFilters.location || ""} onChange={(v) => updatePending('location', v)}
                    options={locationClassifications} placeholder="All Locations"
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

      {/* -- Record detail modal -- */}
      {selectedRecord && (
        <div className="fixed inset-0 z-[1200] flex justify-end bg-slate-950/20 backdrop-blur-sm">
          <div className="absolute inset-0" onClick={() => setSelectedRecord(null)} />
          <div className="relative w-full max-w-lg h-full overflow-y-auto bg-white" style={{ boxShadow: '-8px 0 40px rgba(15, 45, 82, 0.12)', animation: 'slide-in-right 0.3s ease-out both' }}>
            <div className="sticky top-0 z-10" style={{ background: '#0F2D52' }}>
              <div className="flex items-center justify-between px-6 py-4">
                <h2 className="text-base font-extrabold tracking-tight" style={{ color: '#ffffff' }}>RECORD DETAILS</h2>
                <ModalCloseButton onClick={() => setSelectedRecord(null)} label="Close modal" light />
              </div>
            </div>
            <div className="px-6 py-5 space-y-6">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#94A3B8' }}>Case ID</p>
                <p className="text-2xl font-extrabold mt-0.5" style={selectedRecord.source_case_id ? { color: '#0F2D52' } : { color: '#94A3B8', fontStyle: 'italic' }}>{selectedRecord.source_case_id || 'No Case ID'}</p>
                {selectedRecord.case_no && <p className="text-xs text-slate-400 mt-1">System Reference: {selectedRecord.case_no}</p>}
                <div className="mt-2 flex gap-2"><StatusBadge status={selectedRecord.case_status} kind="status" />{selectedRecord.treatment_outcome ? <StatusBadge status={selectedRecord.treatment_outcome} /> : <span className="text-xs text-slate-400 self-center cursor-help" title={selectedRecord.case_status === 'DIAGNOSED' ? 'Diagnosed, not yet on treatment — no final outcome yet' : 'Still on treatment — no final outcome yet'}>—</span>}</div>
                <p className="text-xs text-slate-400 mt-1">Original source value: {selectedRecord.outcome_status_raw || '—'}</p>
              </div>

              {/* Tabs: the record as it stands now, vs. the append-only history of
                  how it got here (previous outcomes are never overwritten silently). */}
              <div className="flex gap-1 border-b" style={{ borderColor: '#E2E8F0' }}>
                {[['details', 'Details'], ['history', 'Case History']].map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setDetailTab(key)}
                    className="px-3 py-2 text-[11px] font-bold -mb-px"
                    style={detailTab === key
                      ? { color: '#0F2D52', borderBottom: '2px solid #0F2D52' }
                      : { color: '#94A3B8', borderBottom: '2px solid transparent' }}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {detailTab === 'details' && (
                <>
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: '#0F2D52' }}>Case Summary</h3>
                <div className="space-y-2.5">
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
                  {residenceLabel(selectedRecord) && (
                    <DetailRow label="Residence" value={residenceLabel(selectedRecord)} />
                  )}
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
                </>
              )}

              {detailTab === 'history' && (
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: '#0F2D52' }}>
                    Case History
                  </h3>
                  <p className="text-[11px] mb-3" style={{ color: '#94A3B8' }}>
                    Changes recorded against this Case ID. A later episode for the same
                    patient is a separate Case with its own history.
                  </p>

                  {historyLoading && (
                    <p className="text-xs" style={{ color: '#64748B' }}>Loading history…</p>
                  )}

                  {!historyLoading && historyError && (
                    <p className="text-xs" style={{ color: '#991B1B' }}>{historyError}</p>
                  )}

                  {!historyLoading && !historyError && caseHistory && caseHistory.length === 0 && (
                    <p className="text-xs" style={{ color: '#64748B' }}>
                      {selectedRecord.case_no
                        ? 'No recorded changes yet. An update appears here when the source system corrects this case.'
                        : 'This record has no System Reference, so later updates cannot be matched to it.'}
                    </p>
                  )}

                  {!historyLoading && !historyError && caseHistory && caseHistory.length > 0 && (
                    <ol className="space-y-3">
                      {caseHistory.map((entry) => {
                        const { title, lines } = describeHistoryEntry(entry);
                        return (
                          <li key={entry.id} className="p-3 rounded-lg text-xs" style={{ background: '#F8FAFC', border: '1px solid #E2E8F0' }}>
                            <p className="font-bold" style={{ color: '#0F2D52' }}>{title}</p>
                            <div className="mt-1 space-y-0.5" style={{ color: '#475569' }}>
                              {lines.map((line) => <p key={line}>{line}</p>)}
                            </div>
                            <p className="mt-2 text-[10px]" style={{ color: '#94A3B8' }}>
                              {formatHistoryTimestamp(entry.changed_at)} · {entry.source || 'system'} · {historyActorLabel(entry)}
                            </p>
                          </li>
                        );
                      })}
                    </ol>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
