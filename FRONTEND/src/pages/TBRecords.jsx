import { useState, useEffect } from "react";
import API from "../api/axios";
import { useTheme } from "../theme";

/* ─── Status → accent color, drawn from the same palette used on the dashboard ─── */
const statusColors = {
  "ON TREATMENT": "#F59E0B",
  "TREATMENT COMPLETED": "#0066FF",
  "CURED": "#10B981",
  "DIED": "#EF4444",
  "LOST TO FOLLOW-UP": "#7c3aed",
  "EXCLUDED": "#94A3B8",
};

function StatusBadge({ status }) {
  const color = statusColors[status] || "#94A3B8";
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold whitespace-nowrap"
      style={{ background: `${color}1A`, color }}
    >
      <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: color }} />
      {status}
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

/* Reusable field row for the record detail modal */
const Field = ({ label, value, badge }) => {
  const { t } = useTheme();
  return (
    <div className="flex items-center justify-between gap-4">
      <span style={{ color: t.textSecondary }}>{label}</span>
      {badge ? (
        <StatusBadge status={value} />
      ) : (
        <span className="font-semibold" style={{ color: t.text }}>{value || "N/A"}</span>
      )}
    </div>
  );
};

export default function TBRecords() {
  const { t } = useTheme();
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [barangays, setBarangays] = useState([]);
  const [outcomeStatuses, setOutcomeStatuses] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 10, total: 0, totalPages: 0 });

  const [currentPage, setCurrentPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedYear, setSelectedYear] = useState("");
  const [selectedMonth, setSelectedMonth] = useState("");
  const [selectedBarangay, setSelectedBarangay] = useState("");
  const [selectedOutcomeStatus, setSelectedOutcomeStatus] = useState("");
  const [selectedRecord, setSelectedRecord] = useState(null);
  const recordsPerPage = 10;

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

  // Fetch cases with filters
  useEffect(() => {
    const fetchCases = async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        params.append("page", currentPage);
        params.append("limit", recordsPerPage);
        if (searchTerm) params.append("search", searchTerm);
        if (selectedBarangay) params.append("barangay", selectedBarangay);
        if (selectedYear) params.append("year", selectedYear);
        if (selectedMonth) {
          const monthNum = getMonthNumber(selectedMonth);
          if (monthNum) params.append("month", monthNum);
        }
        if (selectedOutcomeStatus) params.append("outcome", selectedOutcomeStatus);

        const res = await API.get(`/api/tb/cases?${params.toString()}`);
        setRecords(res.data.cases || []);
        setPagination(res.data.pagination || { page: 1, limit: 10, total: 0, totalPages: 0 });

        // Extract unique outcome statuses from current page
        const statuses = [...new Set((res.data.cases || []).map(r => r.outcome_status).filter(Boolean))].sort();
        setOutcomeStatuses(statuses);
      } catch (err) {
        console.error("Failed to fetch cases:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchCases();
  }, [currentPage, searchTerm, selectedYear, selectedMonth, selectedBarangay, selectedOutcomeStatus]);

  const handleClearFilters = () => {
    setSearchTerm("");
    setSelectedYear("");
    setSelectedMonth("");
    setSelectedBarangay("");
    setSelectedOutcomeStatus("");
    setCurrentPage(1);
  };

  const handlePrevious = () => {
    if (currentPage > 1) setCurrentPage(currentPage - 1);
  };

  const handleNext = () => {
    if (currentPage < pagination.totalPages) setCurrentPage(currentPage + 1);
  };

  return (
    <div className="relative space-y-5">

      {/* ── Toolbar: actions + filters ── */}
      <div className="glass-card p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-2 text-sm font-bold" style={{ color: t.text }}>
            <i className="ri-folder-chart-2-line text-lg" style={{ color: "#2E6FAF" }} />
            <span>TB Case Records</span>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <button
              className="inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-xs font-bold transition hover:opacity-80"
              style={{ background: t.inputBg, border: `1px solid ${t.inputBorder}`, color: t.textSecondary }}
            >
              <i className="ri-upload-2-line text-sm" />
              Import
            </button>
            <button
              className="inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-xs font-bold text-white transition hover:opacity-90"
              style={{ background: "linear-gradient(135deg, #0066FF 0%, #00D8F6 100%)" }}
            >
              <i className="ri-download-2-line text-sm" />
              Export
            </button>
          </div>
        </div>

        <div className="mt-5 grid w-full grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <label className="relative block w-full">
            <span className="sr-only">Search records</span>
            <i
              className="ri-search-line pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm"
              style={{ color: t.textMuted }}
            />
            <input
              type="search"
              placeholder="Search records"
              value={searchTerm}
              onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
              className="w-full rounded-lg py-2 pl-9 pr-3 text-xs font-medium outline-none transition focus:ring-2"
              style={{ background: t.inputBg, border: `1px solid ${t.inputBorder}`, color: t.text }}
            />
          </label>

          <select
            value={selectedYear}
            onChange={(e) => { setSelectedYear(e.target.value); setCurrentPage(1); }}
            className="w-full rounded-lg px-3 py-2 pr-8 text-xs font-medium outline-none transition"
            style={{ background: t.inputBg, border: `1px solid ${t.inputBorder}`, color: t.text }}
          >
            <option value="">All Years</option>
            <option value="2025">2025</option>
            <option value="2024">2024</option>
            <option value="2023">2023</option>
          </select>

          <select
            value={selectedMonth}
            onChange={(e) => { setSelectedMonth(e.target.value); setCurrentPage(1); }}
            className="w-full rounded-lg px-3 py-2 pr-8 text-xs font-medium outline-none transition"
            style={{ background: t.inputBg, border: `1px solid ${t.inputBorder}`, color: t.text }}
          >
            <option value="">All Months</option>
            <option value="January">January</option>
            <option value="February">February</option>
            <option value="March">March</option>
            <option value="April">April</option>
            <option value="May">May</option>
            <option value="June">June</option>
            <option value="July">July</option>
            <option value="August">August</option>
            <option value="September">September</option>
            <option value="October">October</option>
            <option value="November">November</option>
            <option value="December">December</option>
          </select>

          <select
            value={selectedBarangay}
            onChange={(e) => { setSelectedBarangay(e.target.value); setCurrentPage(1); }}
            className="w-full rounded-lg px-3 py-2 pr-8 text-xs font-medium outline-none transition"
            style={{ background: t.inputBg, border: `1px solid ${t.inputBorder}`, color: t.text }}
          >
            <option value="">All Barangays</option>
            {barangays.map((barangay) => (
              <option key={barangay} value={barangay}>{barangay}</option>
            ))}
          </select>

          <select
            value={selectedOutcomeStatus}
            onChange={(e) => { setSelectedOutcomeStatus(e.target.value); setCurrentPage(1); }}
            className="w-full rounded-lg px-3 py-2 pr-8 text-xs font-medium outline-none transition"
            style={{ background: t.inputBg, border: `1px solid ${t.inputBorder}`, color: t.text }}
          >
            <option value="">All Outcomes</option>
            {outcomeStatuses.map((status) => (
              <option key={status} value={status}>{status}</option>
            ))}
          </select>

          <button
            onClick={handleClearFilters}
            className="w-full rounded-lg px-3 py-2 text-xs font-bold transition hover:opacity-80"
            style={{ background: t.inputBg, border: `1px solid ${t.inputBorder}`, color: t.textSecondary }}
          >
            Clear Filters
          </button>
        </div>
      </div>

      {/* ── Records table ── */}
      <div className="glass-card overflow-hidden">
        <div className="flex items-center justify-between p-5 pb-0">
          <div className="flex items-center gap-2 text-sm font-bold" style={{ color: t.text }}>
            <i className="ri-table-line text-lg" style={{ color: "#2E6FAF" }} />
            <span>Case Records</span>
          </div>
          <span className="text-xs font-bold" style={{ color: t.textSecondary }}>
            {pagination.total} total
          </span>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="text-center">
              <i className="ri-loader-4-line animate-spin text-3xl" style={{ color: "#2E6FAF" }} />
              <p className="mt-2 text-sm" style={{ color: t.textSecondary }}>Loading records...</p>
            </div>
          </div>
        ) : (
          <>
            <div className="mt-4 min-h-[480px] overflow-x-auto">
              <table className="min-w-full border-separate border-spacing-0 text-left text-sm">
                <thead>
                  <tr>
                    {["Case ID", "Barangay", "Age", "Sex", "Diagnosis", "Facility", "Treatment Outcome", "Action"].map((h) => (
                      <th
                        key={h}
                        className="px-5 py-3 text-left text-[10px] font-bold uppercase tracking-wider whitespace-nowrap"
                        style={{ color: t.textSecondary, borderBottom: "1px solid rgba(148,163,184,.15)" }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {records.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-5 py-12 text-center text-sm" style={{ color: "#94A3B8" }}>
                        No records found matching your filters.
                      </td>
                    </tr>
                  ) : (
                    records.map((record) => (
                      <tr
                        key={record.id}
                        style={{ borderTop: "1px solid rgba(148,163,184,.1)" }}
                      >
                        <td className="px-5 py-3 font-bold" style={{ color: t.text }}>
                          {String(record.id).padStart(4, "0")}
                        </td>
                        <td className="px-5 py-3" style={{ color: t.textSecondary }}>{record.barangay_name}</td>
                        <td className="px-5 py-3" style={{ color: t.textSecondary }}>{record.age}</td>
                        <td className="px-5 py-3" style={{ color: t.textSecondary }}>{record.sex}</td>
                        <td className="px-5 py-3" style={{ color: t.textSecondary }}>{formatDate(record.date_of_diagnosis)}</td>
                        <td className="px-5 py-3" style={{ color: t.textSecondary }}>{record.screening_facility}</td>
                        <td className="px-5 py-3">
                          <StatusBadge status={record.outcome_status} />
                        </td>
                        <td className="px-5 py-3">
                          <button
                            aria-label="View record"
                            onClick={() => setSelectedRecord(record)}
                            className="inline-flex h-9 w-9 items-center justify-center rounded-lg transition hover:opacity-80"
                            style={{ background: "rgba(46,111,175,0.1)", border: "1px solid rgba(46,111,175,0.25)", color: "#2E6FAF" }}
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

            <div
              className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
              style={{ borderTop: "1px solid rgba(148,163,184,.15)" }}
            >
              <p className="text-xs font-semibold" style={{ color: t.textSecondary }}>
                Showing {pagination.total === 0 ? 0 : (pagination.page - 1) * pagination.limit + 1}–{Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total} records
              </p>
              <div className="flex gap-2">
                <button
                  aria-label="Previous page"
                  onClick={handlePrevious}
                  disabled={currentPage === 1}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg transition disabled:cursor-not-allowed disabled:opacity-40"
                  style={{ background: t.inputBg, border: `1px solid ${t.inputBorder}`, color: t.textSecondary }}
                >
                  <i className="ri-arrow-left-s-line text-base" />
                </button>
                <button
                  aria-label="Next page"
                  onClick={handleNext}
                  disabled={currentPage === pagination.totalPages || pagination.totalPages === 0}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg transition disabled:cursor-not-allowed disabled:opacity-40"
                  style={{ background: t.inputBg, border: `1px solid ${t.inputBorder}`, color: t.textSecondary }}
                >
                  <i className="ri-arrow-right-s-line text-base" />
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* ── Record detail modal ── */}
      {selectedRecord && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/30 p-4 backdrop-blur-sm">
          <div
            className="glass-card w-full max-w-3xl max-h-[90vh] overflow-hidden"
            style={{ background: t.cardSolid }}
          >
            <div
              className="flex flex-col gap-4 px-6 py-5 sm:flex-row sm:items-center sm:justify-between"
              style={{ borderBottom: "1px solid rgba(148,163,184,.15)" }}
            >
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.3em]" style={{ color: t.textSecondary }}>
                  TB Record
                </p>
                <h2 className="mt-2 text-xl font-bold tracking-tight" style={{ color: t.text }}>
                  Record details
                </h2>
                <p className="mt-1.5 max-w-xl text-sm leading-6" style={{ color: t.textSecondary }}>
                  Detailed TB case information, including patient, screening, and treatment data.
                </p>
              </div>
              <button
                onClick={() => setSelectedRecord(null)}
                aria-label="Close modal"
                className="inline-flex h-9 w-9 items-center justify-center rounded-full transition hover:opacity-80"
                style={{ background: t.panel, color: t.textSecondary }}
              >
                <i className="ri-close-line text-base" />
              </button>
            </div>

            <div className="space-y-4 overflow-y-auto px-6 py-6" style={{ maxHeight: "70vh" }}>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-2xl p-5" style={{ background: t.inputBg }}>
                  <p className="flex items-center gap-2 text-sm font-bold" style={{ color: t.text }}>
                    <i className="ri-file-list-3-line" style={{ color: "#2E6FAF" }} />
                    Case summary
                  </p>
                  <div className="mt-4 space-y-3 text-sm">
                    <Field label="Case ID" value={String(selectedRecord.id).padStart(4, "0")} />
                    <Field label="Batch ID" value={selectedRecord.batch_id?.substring(0, 8)} />
                    <Field label="Treatment Outcome" value={selectedRecord.outcome_status} badge />
                  </div>
                </div>

                <div className="rounded-2xl p-5" style={{ background: t.inputBg }}>
                  <p className="flex items-center gap-2 text-sm font-bold" style={{ color: t.text }}>
                    <i className="ri-user-line" style={{ color: "#2E6FAF" }} />
                    Patient information
                  </p>
                  <div className="mt-4 space-y-3 text-sm">
                    <Field label="Age" value={selectedRecord.age} />
                    <Field label="Sex" value={selectedRecord.sex} />
                    <Field label="Barangay" value={selectedRecord.barangay_name} />
                    <Field label="Source" value={selectedRecord.source_of_patient} />
                  </div>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-2xl p-5" style={{ background: t.inputBg }}>
                  <p className="flex items-center gap-2 text-sm font-bold" style={{ color: t.text }}>
                    <i className="ri-stethoscope-line" style={{ color: "#2E6FAF" }} />
                    Screening & diagnosis
                  </p>
                  <div className="mt-4 space-y-3 text-sm">
                    <Field label="Screening Date" value={formatDate(selectedRecord.date_of_screening)} />
                    <Field label="Diagnosis Date" value={formatDate(selectedRecord.date_of_diagnosis)} />
                    <Field label="Notification Date" value={formatDate(selectedRecord.date_of_notification)} />
                    <Field label="Facility" value={selectedRecord.screening_facility} />
                  </div>
                </div>

                <div className="rounded-2xl p-5" style={{ background: t.inputBg }}>
                  <p className="flex items-center gap-2 text-sm font-bold" style={{ color: t.text }}>
                    <i className="ri-capsule-line" style={{ color: "#2E6FAF" }} />
                    Clinical & treatment
                  </p>
                  <div className="mt-4 space-y-3 text-sm">
                    <Field label="Anatomical Site" value={selectedRecord.anatomical_site} />
                    <Field label="Registration Group" value={selectedRecord.registration_group} />
                    <Field label="Bacteriological Status" value={selectedRecord.bacteriological_status} />
                    <Field label="Treatment Facility" value={selectedRecord.treatment_facility} />
                    <Field label="Started Treatment" value={formatDate(selectedRecord.date_started_treatment)} />
                    <Field label="Outcome Date" value={formatDate(selectedRecord.date_of_outcome)} />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
