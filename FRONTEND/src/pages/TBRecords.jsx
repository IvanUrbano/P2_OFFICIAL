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

/* Reusable detail row for the record detail panel */
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

export default function TBRecords() {
  const [records, setRecords] = useState([]);
  const [barangays, setBarangays] = useState([]);
  const ALL_OUTCOME_STATUSES = [
    "ON TREATMENT",
    "CURED",
    "TREATMENT COMPLETED",
    "DIED",
    "LOST TO FOLLOW-UP",
    "EXCLUDED",
  ];

  const [outcomeStatuses, setOutcomeStatuses] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 10, total: 0, totalPages: 1 });
  const [summary, setSummary] = useState({ total: 0, onTreatment: 0, completedCured: 0 });

  const [currentPage, setCurrentPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState("");
  const debouncedSearch = useDebounce(searchTerm, 400);
  const [selectedYear, setSelectedYear] = useState("");
  const [selectedMonth, setSelectedMonth] = useState("");
  const [selectedBarangay, setSelectedBarangay] = useState("");
  const [selectedOutcomeStatus, setSelectedOutcomeStatus] = useState("");
  const [selectedFacility, setSelectedFacility] = useState("");
  const [facilities, setFacilities] = useState([]);
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [loading, setLoading] = useState(true);
  const recordsPerPage = 20;

  // Fetch barangays for filter dropdown
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

  // Fetch facilities from actual case data for the filter dropdown
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

  // Fetch cases with filters (uses debounced search)
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

        const res = await API.get(`/api/tb/cases?${params.toString()}`);
        if (cancelled) return;

        const cases = res.data.cases || [];
        setRecords(cases);
        setPagination(res.data.pagination || { page: 1, limit: 10, total: 0, totalPages: 1 });

        // Compute summary from all records (use total from pagination)
        const totalRecords = res.data.pagination?.total || 0;
        const onTreatment = cases.filter(r => r.outcome_status === "ON TREATMENT").length;
        const completedCured = cases.filter(r => r.outcome_status === "CURED" || r.outcome_status === "TREATMENT COMPLETED").length;
        setSummary({ total: totalRecords, onTreatment, completedCured });

        const statuses = [...new Set(cases.map(r => r.outcome_status).filter(Boolean))].sort();
        setOutcomeStatuses(statuses);
      } catch (err) {
        if (!cancelled) console.error("Failed to fetch cases:", err);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };
    fetchCases();
    return () => { cancelled = true; };
  }, [currentPage, debouncedSearch, selectedYear, selectedMonth, selectedBarangay, selectedOutcomeStatus, selectedFacility]);

  const handleClearFilters = () => {
    setSearchTerm("");
    setSelectedYear("");
    setSelectedMonth("");
    setSelectedBarangay("");
    setSelectedOutcomeStatus("");
    setSelectedFacility("");
    setCurrentPage(1);
  };

  return (
    <div className="flex flex-col gap-5">

      {/* ── Page Header + Metric Cards ── */}
      <div className="flex flex-col lg:flex-row lg:items-center gap-6">
        {/* Left — Title */}
        <div className="shrink-0 pl-2">
          <h1 className="text-2xl font-extrabold tracking-tight" style={{ color: '#0F2D52' }}>TB Records</h1>
          <p className="text-sm mt-1" style={{ color: '#94A3B8' }}>
            Manage, search, filter, and verify TB records for monitoring and analysis.
          </p>
        </div>

        {/* Right — Metric Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 flex-1">
          {/* Total TB Records */}
          <div className="rounded-2xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.8)', border: '1px solid #DBEAFE', boxShadow: '0 4px 20px rgba(37, 99, 235, 0.08)' }}>
            <div className="p-5 pb-3 flex items-start justify-between">
              <div>
                <p className="text-xs font-semibold" style={{ color: '#64748B' }}>TB Records</p>
                <p className="text-3xl font-extrabold mt-1" style={{ color: '#0F2D52' }}>{summary.total.toLocaleString()}</p>
              </div>
              <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ background: '#DBEAFE' }}>
                <i className="ri-folder-chart-2-line text-base" style={{ color: '#2563EB' }} />
              </div>
            </div>
            <div className="flex items-center justify-between px-5 py-2.5" style={{ borderTop: '1px solid #1E40AF', background: '#0F2D52' }}>
              <span className="text-[11px] font-semibold" style={{ color: '#93C5FD' }}>All Registered Records</span>
            </div>
          </div>

          {/* On Treatment */}
          <div className="rounded-2xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.8)', border: '1px solid #DBEAFE', boxShadow: '0 4px 20px rgba(37, 99, 235, 0.08)' }}>
            <div className="p-5 pb-3 flex items-start justify-between">
              <div>
                <p className="text-xs font-semibold" style={{ color: '#64748B' }}>On Treatment</p>
                <p className="text-3xl font-extrabold mt-1" style={{ color: '#0F2D52' }}>{summary.onTreatment.toLocaleString()}</p>
              </div>
              <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ background: '#DBEAFE' }}>
                <i className="ri-capsule-line text-base" style={{ color: '#2563EB' }} />
              </div>
            </div>
            <div className="flex items-center justify-between px-5 py-2.5" style={{ borderTop: '1px solid #1E40AF', background: '#0F2D52' }}>
              <span className="text-[11px] font-semibold" style={{ color: '#93C5FD' }}>Currently Under Treatment</span>
            </div>
          </div>

          {/* Pending Verification */}
          <div className="rounded-2xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.8)', border: '1px solid #DBEAFE', boxShadow: '0 4px 20px rgba(37, 99, 235, 0.08)' }}>
            <div className="p-5 pb-3 flex items-start justify-between">
              <div>
                <p className="text-xs font-semibold" style={{ color: '#64748B' }}>Completed / Cured</p>
                <p className="text-3xl font-extrabold mt-1" style={{ color: '#0F2D52' }}>{summary.completedCured.toLocaleString()}</p>
              </div>
              <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ background: '#DBEAFE' }}>
                <i className="ri-error-warning-line text-base" style={{ color: '#2563EB' }} />
              </div>
            </div>
            <div className="flex items-center justify-between px-5 py-2.5" style={{ borderTop: '1px solid #1E40AF', background: '#0F2D52' }}>
              <span className="text-[11px] font-semibold" style={{ color: '#93C5FD' }}>Completed/Cured Records</span>
            </div>
          </div>
        </div>
      </div>
      {/* ── Records Table ── */}
      <div
        className="rounded-2xl overflow-hidden"
        style={{
          background: 'rgba(255,255,255,0.8)',
          border: '1px solid #DBEAFE',
          boxShadow: '0 4px 20px rgba(37, 99, 235, 0.08)',
        }}
      >
                {/* Filter Toolbar */}
        <div className="flex flex-wrap items-center gap-3 px-5 py-4" style={{ borderBottom: '1px solid #E2E8F0' }}>
          <div className="relative flex-1 max-w-xs">
            <i className="ri-search-line pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm" style={{ color: '#94A3B8' }} />
            <input
              type="text"
              placeholder="Search by case ID, barangay, facility..."
              value={searchTerm}
              onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
              className="w-full rounded-lg py-2 pl-9 pr-3 text-xs font-medium outline-none transition"
              style={{ background: '#EFF6FF', border: '1px solid #DBEAFE', color: '#0F2D52' }}
            />
            {searchTerm && searchTerm !== debouncedSearch && (
              <i className="ri-loader-4-line absolute right-3 top-1/2 -translate-y-1/2 text-xs animate-spin" style={{ color: '#94A3B8' }} />
            )}
          </div>

          <select
            value={selectedYear}
            onChange={(e) => { setSelectedYear(e.target.value); setCurrentPage(1); }}
            className="rounded-lg px-3 py-2 text-xs font-medium outline-none transition"
            style={{ background: '#EFF6FF', border: '1px solid #DBEAFE', color: '#64748B' }}
          >
            <option value="">All Years</option>
            <option value="2025">2025</option>
            <option value="2024">2024</option>
            <option value="2023">2023</option>
          </select>

          <select
            value={selectedMonth}
            onChange={(e) => { setSelectedMonth(e.target.value); setCurrentPage(1); }}
            className="rounded-lg px-3 py-2 text-xs font-medium outline-none transition"
            style={{ background: '#EFF6FF', border: '1px solid #DBEAFE', color: '#64748B' }}
          >
            <option value="">All Months</option>
            {["January","February","March","April","May","June","July","August","September","October","November","December"].map(m => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>

          <select
            value={selectedBarangay}
            onChange={(e) => { setSelectedBarangay(e.target.value); setCurrentPage(1); }}
            className="rounded-lg px-3 py-2 text-xs font-medium outline-none transition"
            style={{ background: '#EFF6FF', border: '1px solid #DBEAFE', color: '#64748B' }}
          >
            <option value="">All Barangays</option>
            {barangays.map((b) => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>

          <select
            value={selectedOutcomeStatus}
            onChange={(e) => { setSelectedOutcomeStatus(e.target.value); setCurrentPage(1); }}
            className="rounded-lg px-3 py-2 text-xs font-medium outline-none transition"
            style={{ background: '#EFF6FF', border: '1px solid #DBEAFE', color: '#64748B' }}
          >
            <option value="">All Status</option>
            {ALL_OUTCOME_STATUSES.map((status) => (
              <option key={status} value={status}>{status.charAt(0) + status.slice(1).toLowerCase()}</option>
            ))}
          </select>

          <select
            value={selectedFacility}
            onChange={(e) => { setSelectedFacility(e.target.value); setCurrentPage(1); }}
            className="rounded-lg px-3 py-2 text-xs font-medium outline-none transition"
            style={{ background: '#EFF6FF', border: '1px solid #DBEAFE', color: '#64748B' }}
          >
            <option value="">All Facilities</option>
            {facilities.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>

          <button
            onClick={handleClearFilters}
            className="ml-auto text-xs font-bold transition hover:underline"
            style={{ color: '#0066FF' }}
          >
            Clear Filters
          </button>
        </div>

        {/* Table */}
            <div className="min-h-[480px] overflow-x-auto">
              <table
                className="w-full text-left text-sm"
                style={{ borderCollapse: 'collapse' }}
              >
                <thead>
                  <tr style={{ background: '#0F2D52' }}>
                    {["Case ID", "Barangay", "Age", "Sex", "Diagnosis Date", "Facility", "Bacteriologic Status", "Status", "Action"].map((h, idx) => (
                      <th
                        key={h}
                        className={`${idx === 0 ? 'pl-6' : 'px-3'} pr-3 py-3 text-left text-[10px] font-bold uppercase tracking-wider whitespace-nowrap ${idx === 5 ? 'max-w-[200px]' : ''}`}
                        style={{ color: '#ffffff', borderBottom: '1px solid #1E40AF', borderRight: idx < 8 ? '1px solid #1E40AF' : 'none' }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    // Skeleton rows while loading
                    Array.from({ length: 8 }).map((_, i) => (
                      <tr key={`skeleton-${i}`} style={{ borderBottom: '1px solid #E2E8F0', background: i % 2 === 0 ? '#ffffff' : '#F8FAFC' }}>
                        {Array.from({ length: 9 }).map((_, j) => (
                          <td key={j} className={`${j === 0 ? 'pl-6' : 'px-3'} pr-3 py-3.5`} style={{ borderRight: j < 8 ? '1px solid #E2E8F0' : 'none' }}>
                            <div
                              className="h-4 rounded animate-pulse"
                              style={{
                                background: `linear-gradient(90deg, #EFF6FF 25%, #DBEAFE 50%, #EFF6FF 75%)`,
                                backgroundSize: '200% 100%',
                                animation: `shimmer 1.5s infinite`,
                                width: j === 0 ? '60px' : j === 5 ? '140px' : j === 6 ? '120px' : j === 7 ? '90px' : j === 8 ? '32px' : '80px',
                              }}
                            />
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
                      <tr
                        key={record.id}
                        className="hover:bg-blue-50 transition-colors"
                        style={{ borderBottom: '1px solid #E2E8F0', background: idx % 2 === 0 ? '#ffffff' : '#F8FAFC' }}
                      >
                        <td className="pl-6 pr-3 py-3.5" style={{ borderRight: '1px solid #E2E8F0' }}>
                          <span className="font-bold" style={{ color: '#0F2D52' }}>
                            {String(record.id).padStart(4, "0")}
                          </span>
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
                            <button
                              aria-label="View record"
                              onClick={() => setSelectedRecord(record)}
                              className="inline-flex items-center justify-center w-8 h-8 rounded-lg transition hover:opacity-80"
                              style={{ background: '#DBEAFE', color: '#2563EB' }}
                            >
                              <i className="ri-eye-line text-sm" />
                            </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div
              className="flex flex-col gap-3 px-6 py-4 sm:flex-row sm:items-center sm:justify-between"
              style={{ borderTop: '1px solid #E2E8F0' }}
            >
              <p className="text-xs font-semibold" style={{ color: '#94A3B8' }}>
                {loading ? (
                  <span className="inline-flex items-center gap-1.5">
                    <i className="ri-loader-4-line text-xs animate-spin" />
                    Loading records...
                  </span>
                ) : (
                  <>Showing {pagination.total === 0 ? 0 : (currentPage - 1) * recordsPerPage + 1}–{Math.min(currentPage * recordsPerPage, pagination.total)} of {pagination.total} records</>
                )}
              </p>
              <div className="flex items-center gap-1.5">
                <button
                  aria-label="Previous page"
                  onClick={() => currentPage > 1 && setCurrentPage(currentPage - 1)}
                  disabled={currentPage <= 1 || loading}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg transition disabled:cursor-not-allowed disabled:opacity-40"
                  style={{ background: '#EFF6FF', border: '1px solid #DBEAFE', color: '#64748B' }}
                >
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
                      <button
                        key={page}
                        onClick={() => setCurrentPage(page)}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-xs font-bold transition"
                        style={currentPage === page ? { background: '#0F2D52', color: '#ffffff' } : { color: '#64748B' }}
                      >
                        {page}
                      </button>
                    )
                  );
                })()}
                <button
                  aria-label="Next page"
                  onClick={() => setCurrentPage(currentPage + 1)}
                  disabled={currentPage >= pagination.totalPages || pagination.total === 0 || loading}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg transition disabled:cursor-not-allowed disabled:opacity-40"
                  style={{ background: '#EFF6FF', border: '1px solid #DBEAFE', color: '#64748B' }}
                >
                  <i className="ri-arrow-right-s-line text-base" />
                </button>
              </div>
            </div>
      </div>

      {/* ── Record detail modal ── */}
      {selectedRecord && (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/20 backdrop-blur-sm">
          {/* Backdrop */}
          <div className="absolute inset-0" onClick={() => setSelectedRecord(null)} />
          {/* Panel */}
          <div
            className="relative w-full max-w-lg h-full overflow-y-auto bg-white"
            style={{
              boxShadow: '-8px 0 40px rgba(15, 45, 82, 0.12)',
              animation: 'slide-in-right 0.3s ease-out both',
            }}
          >
            {/* Header */}
            <div className="sticky top-0 z-10" style={{ background: '#0F2D52' }}>
              <div className="flex items-center justify-between px-6 py-4">
                <h2 className="text-base font-extrabold tracking-tight" style={{ color: '#ffffff' }}>RECORD DETAILS</h2>
                <button
                  onClick={() => setSelectedRecord(null)}
                  aria-label="Close modal"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full transition hover:opacity-80"
                  style={{ color: '#93C5FD' }}
                >
                  <i className="ri-close-line text-base" />
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="px-6 py-5 space-y-6">

              {/* Hero: Case ID + Status */}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#94A3B8' }}>Case ID</p>
                <p className="text-2xl font-extrabold mt-0.5" style={{ color: '#0F2D52' }}>
                  {String(selectedRecord.id).padStart(4, "0")}
                </p>
                <div className="mt-2">
                  <StatusBadge status={selectedRecord.outcome_status} />
                </div>
              </div>

              {/* Section: Case Summary */}
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: '#0F2D52' }}>Case Summary</h3>
                <div className="space-y-2.5">
                  <DetailRow label="Validation Status" value={selectedRecord.batch_id ? "Validated" : "Pending"} />
                  <DetailRow label="Encoded By" value={selectedRecord.source_of_patient} />
                  <DetailRow label="Imported From" value={selectedRecord.screening_facility} />
                  <DetailRow label="Created" value={formatDate(selectedRecord.date_of_diagnosis)} />
                </div>
              </div>

              <div style={{ borderTop: '1px solid #E2E8F0' }} />

              {/* Section: Patient Information */}
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: '#0F2D52' }}>Patient Information</h3>
                <div className="space-y-2.5">
                  <DetailRow label="Age" value={selectedRecord.age} />
                  <DetailRow label="Sex" value={selectedRecord.sex} />
                  <DetailRow label="Barangay" value={selectedRecord.barangay_name} />
                  <DetailRow label="City" value="Pasig City" />
                  <DetailRow label="Source" value={selectedRecord.source_of_patient || "Walk-in"} />
                </div>
              </div>

              <div style={{ borderTop: '1px solid #E2E8F0' }} />

              {/* Section: Screening & Diagnosis */}
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: '#0F2D52' }}>Screening & Diagnosis</h3>
                <div className="space-y-2.5">
                  <DetailRow label="Screening Date" value={formatDate(selectedRecord.date_of_screening)} />
                  <DetailRow label="Diagnosis Date" value={formatDate(selectedRecord.date_of_diagnosis)} />
                  <DetailRow label="Notification Date" value={formatDate(selectedRecord.date_of_notification)} />
                  <DetailRow label="Facility" value={selectedRecord.screening_facility} />
                </div>
              </div>

              <div style={{ borderTop: '1px solid #E2E8F0' }} />

              {/* Section: Clinical & Treatment */}
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: '#0F2D52' }}>Clinical & Treatment</h3>
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
