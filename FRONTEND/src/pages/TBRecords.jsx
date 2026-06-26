import { useState } from "react";
import { useTBData } from "../context/TBDataContext";
import { downloadFile, toCSV } from "../utils/exportUtils";

/* ─── Status → accent color, drawn from the same palette used on the dashboard ─── */
const statusColors = {
  Active: "#2E6FAF",
  Cured: "#10B981",
  Treatment: "#F59E0B",
  Completed: "#0066FF",
  "Not Evaluated": "#94A3B8",
  Defaulted: "#7c3aed",
  Failed: "#ff0055",
  Died: "#EF4444",
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

export default function TBRecords() {
  const { records } = useTBData();
  const [currentPage, setCurrentPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedYear, setSelectedYear] = useState("");
  const [selectedMonth, setSelectedMonth] = useState("");
  const [selectedBarangay, setSelectedBarangay] = useState("");
  const [selectedOutcomeStatus, setSelectedOutcomeStatus] = useState("");
  const [selectedRecord, setSelectedRecord] = useState(null);
  const recordsPerPage = 10;

  const barangays = ["Bagong Ilog", "Bagong Katipunan", "Bambang", "Buting", "Caniogan", "Kapasigan", "Kapitolyo", "Malinao", "Oranbo", "Palatiw", "Pineda", "Sagad", "San Antonio", "San Joaquin", "San Jose", "Dela Paz", "Kalawaan", "Manggahan", "Maybunga", "Pinagbuhatan", "Rosario", "San Miguel", "San Nicolas", "Santa Cruz", "Santa Lucia", "Santa Rosa", "Santo Tomas", "Santolan", "Sumilang", "Ugong"];

  const outcomeStatuses = [...new Set(records.map((record) => record.status).filter(Boolean))].sort();

  const getMonthNumber = (month) => {
    const months = { January: "01", February: "02", March: "03", April: "04", May: "05", June: "06", July: "07", August: "08", September: "09", October: "10", November: "11", December: "12" };
    return months[month] || "";
  };

  const filteredRecords = records.filter((record) => {
    const matchesSearch = searchTerm === "" ||
      record.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      record.barangay.toLowerCase().includes(searchTerm.toLowerCase()) ||
      record.facility.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesYear = selectedYear === "" || record.diagnosisDate.startsWith(selectedYear);
    const matchesMonth = selectedMonth === "" || record.diagnosisDate.includes("-" + getMonthNumber(selectedMonth).padStart(2, "0") + "-");
    const matchesBarangay = selectedBarangay === "" || record.barangay === selectedBarangay;
    const matchesOutcomeStatus = selectedOutcomeStatus === "" || record.status === selectedOutcomeStatus;

    return matchesSearch && matchesYear && matchesMonth && matchesBarangay && matchesOutcomeStatus;
  });

  const handleClearFilters = () => {
    setSearchTerm("");
    setSelectedYear("");
    setSelectedMonth("");
    setSelectedBarangay("");
    setSelectedOutcomeStatus("");
    setCurrentPage(1);
  };

  /* ── Export filtered records as CSV ── */
  const handleExport = () => {
    const rows = filteredRecords.map(r => ({
      'Case ID': r.id,
      'Barangay': r.barangay,
      'City': r.city || 'Pasig City',
      'Age': r.age,
      'Sex': r.sex,
      'Source': r.sourcePatient,
      'Screening Date': r.screeningDate,
      'Diagnosis Date': r.diagnosisDate,
      'Notification Date': r.notificationDate,
      'Facility': r.facility,
      'Anatomical Site': r.anatomicalSite,
      'Registration Group': r.registrationGroup,
      'Bacteriological Status': r.bacteriologicalStatus,
      'Treatment Facility': r.treatmentFacility || r.facility,
      'Treatment Start Date': r.treatmentStartDate,
      'Outcome Status': r.status,
      'Outcome Date': r.outcomeDate,
      'Validation Status': r.validationStatus,
      'Encoded By': r.encodedBy || '',
      'Imported From': r.importedFrom || '',
      'Created': r.createdAt,
    }));
    const csv = toCSV(rows);
    const ts = new Date().toISOString().slice(0, 10);
    downloadFile(csv, `TBInsight_TBRecords_${ts}.csv`);
  };

  const totalPages = Math.ceil(filteredRecords.length / recordsPerPage);
  const startIndex = (currentPage - 1) * recordsPerPage;
  const endIndex = startIndex + recordsPerPage;
  const paginatedRecords = filteredRecords.slice(startIndex, endIndex);

  const handlePrevious = () => {
    if (currentPage > 1) setCurrentPage(currentPage - 1);
  };

  const handleNext = () => {
    if (currentPage < totalPages) setCurrentPage(currentPage + 1);
  };

  /* Reusable field row for the record detail modal */
  const Field = ({ label, value, badge }) => (
    <div className="flex items-center justify-between gap-4">
      <span style={{ color: "#64748b" }}>{label}</span>
      {badge ? (
        <StatusBadge status={value} />
      ) : (
        <span className="font-semibold" style={{ color: "#0f172a" }}>{value || "N/A"}</span>
      )}
    </div>
  );

  return (
    <div className="relative space-y-5">

      {/* ── Toolbar: actions + filters ── */}
      <div className="glass-card p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-2 text-sm font-bold" style={{ color: "#0f172a" }}>
            <i className="ri-folder-chart-2-line text-lg" style={{ color: "#2E6FAF" }} />
            <span>TB Case Records</span>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <button
              className="inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-xs font-bold transition hover:opacity-80"
              style={{ background: "#f8fafc", border: "1px solid #e2e8f0", color: "#475569" }}
            >
              <i className="ri-upload-2-line text-sm" />
              Import
            </button>
            <button
              onClick={handleExport}
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
              style={{ color: "#94a3b8" }}
            />
            <input
              type="search"
              placeholder="Search records"
              value={searchTerm}
              onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
              className="w-full rounded-lg py-2 pl-9 pr-3 text-xs font-medium outline-none transition focus:ring-2"
              style={{ background: "#f8fafc", border: "1px solid #e2e8f0", color: "#0f172a" }}
            />
          </label>

          <select
            value={selectedYear}
            onChange={(e) => { setSelectedYear(e.target.value); setCurrentPage(1); }}
            className="w-full rounded-lg px-3 py-2 pr-8 text-xs font-medium outline-none transition"
            style={{ background: "#f8fafc", border: "1px solid #e2e8f0", color: "#0f172a" }}
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
            style={{ background: "#f8fafc", border: "1px solid #e2e8f0", color: "#0f172a" }}
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
            style={{ background: "#f8fafc", border: "1px solid #e2e8f0", color: "#0f172a" }}
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
            style={{ background: "#f8fafc", border: "1px solid #e2e8f0", color: "#0f172a" }}
          >
            <option value="">All Treatment Data</option>
            {outcomeStatuses.map((status) => (
              <option key={status} value={status}>{status}</option>
            ))}
          </select>

          <button
            onClick={handleClearFilters}
            className="w-full rounded-lg px-3 py-2 text-xs font-bold transition hover:opacity-80"
            style={{ background: "#f8fafc", border: "1px solid #e2e8f0", color: "#475569" }}
          >
            Clear Filters
          </button>
        </div>
      </div>

      {/* ── Records table ── */}
      <div className="glass-card overflow-hidden">
        <div className="flex items-center justify-between p-5 pb-0">
          <div className="flex items-center gap-2 text-sm font-bold" style={{ color: "#0f172a" }}>
            <i className="ri-table-line text-lg" style={{ color: "#2E6FAF" }} />
            <span>Case Records</span>
          </div>
          <span className="text-xs font-bold" style={{ color: "#64748b" }}>
            {filteredRecords.length} total
          </span>
        </div>

        <div className="mt-4 min-h-[480px] overflow-x-auto">
          <table className="min-w-full border-separate border-spacing-0 text-left text-sm">
            <thead>
              <tr>
                {["Case ID", "Barangay", "Age", "Sex", "Diagnosis", "Facility", "Encoded By", "Treatment Data Overview", "Action"].map((h) => (
                  <th
                    key={h}
                    className="px-5 py-3 text-left text-[10px] font-bold uppercase tracking-wider whitespace-nowrap"
                    style={{ color: "#64748b", borderBottom: "1px solid rgba(148,163,184,.15)" }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {paginatedRecords.map((record) => (
                <tr
                  key={record.id}
                  style={{ borderTop: "1px solid rgba(148,163,184,.1)" }}
                >
                  <td className="px-5 py-3 font-bold" style={{ color: "#0f172a" }}>{record.id}</td>
                  <td className="px-5 py-3" style={{ color: "#475569" }}>{record.barangay}</td>
                  <td className="px-5 py-3" style={{ color: "#475569" }}>{record.age}</td>
                  <td className="px-5 py-3" style={{ color: "#475569" }}>{record.sex}</td>
                  <td className="px-5 py-3" style={{ color: "#475569" }}>{record.diagnosisDate}</td>
                  <td className="px-5 py-3" style={{ color: "#475569" }}>{record.facility}</td>
                  <td className="px-5 py-3" style={{ color: "#475569" }}>
                    {record.encodedBy ? (
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                          style={{ background: '#e0f2fe', color: '#0369a1', border: '1.5px solid #bae6fd' }}>
                          {record.encodedBy.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                        </div>
                        <span className="text-xs font-semibold" style={{ color: '#1a5276' }}>{record.encodedBy}</span>
                      </div>
                    ) : (
                      <span className="text-xs" style={{ color: '#94A3B8' }}>—</span>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    <StatusBadge status={record.status} />
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
              ))}
            </tbody>
          </table>
        </div>

        <div
          className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
          style={{ borderTop: "1px solid rgba(148,163,184,.15)" }}
        >
          <p className="text-xs font-semibold" style={{ color: "#64748b" }}>
            Showing {filteredRecords.length === 0 ? 0 : startIndex + 1}–{Math.min(endIndex, filteredRecords.length)} of {filteredRecords.length} records
          </p>
          <div className="flex gap-2">
            <button
              aria-label="Previous page"
              onClick={handlePrevious}
              disabled={currentPage === 1}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg transition disabled:cursor-not-allowed disabled:opacity-40"
              style={{ background: "#f8fafc", border: "1px solid #e2e8f0", color: "#475569" }}
            >
              <i className="ri-arrow-left-s-line text-base" />
            </button>
            <button
              aria-label="Next page"
              onClick={handleNext}
              disabled={currentPage === totalPages || totalPages === 0}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg transition disabled:cursor-not-allowed disabled:opacity-40"
              style={{ background: "#f8fafc", border: "1px solid #e2e8f0", color: "#475569" }}
            >
              <i className="ri-arrow-right-s-line text-base" />
            </button>
          </div>
        </div>
      </div>

      {/* ── Record detail modal ── */}
      {selectedRecord && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/30 p-4 backdrop-blur-sm">
          <div
            className="glass-card w-full max-w-3xl max-h-[90vh] overflow-hidden"
            style={{ background: "rgba(255,255,255,0.97)" }}
          >
            <div
              className="flex flex-col gap-4 px-6 py-5 sm:flex-row sm:items-center sm:justify-between"
              style={{ borderBottom: "1px solid rgba(148,163,184,.15)" }}
            >
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.3em]" style={{ color: "#64748b" }}>
                  TB Record
                </p>
                <h2 className="mt-2 text-xl font-bold tracking-tight" style={{ color: "#0f172a" }}>
                  Record details
                </h2>
                <p className="mt-1.5 max-w-xl text-sm leading-6" style={{ color: "#64748b" }}>
                  Detailed TB case information, including patient, screening, and treatment data.
                </p>
              </div>
              <button
                onClick={() => setSelectedRecord(null)}
                aria-label="Close modal"
                className="inline-flex h-9 w-9 items-center justify-center rounded-full transition hover:opacity-80"
                style={{ background: "#f1f5f9", color: "#475569" }}
              >
                <i className="ri-close-line text-base" />
              </button>
            </div>

            <div className="space-y-4 overflow-y-auto px-6 py-6" style={{ maxHeight: "70vh" }}>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-2xl p-5" style={{ background: "#f8fafc" }}>
                  <p className="flex items-center gap-2 text-sm font-bold" style={{ color: "#0f172a" }}>
                    <i className="ri-file-list-3-line" style={{ color: "#2E6FAF" }} />
                    Case summary
                  </p>
                  <div className="mt-4 space-y-3 text-sm">
                    <Field label="Case ID" value={selectedRecord.id} />
                    <Field label="Validation Status" value={selectedRecord.validationStatus} />
                    <Field label="Encoded By" value={selectedRecord.encodedBy} />
                    <Field label="Imported From" value={selectedRecord.importedFrom} />
                    <Field label="Created" value={selectedRecord.createdAt} />
                    <Field label="Treatment Data Overview" value={selectedRecord.status} badge />
                  </div>
                </div>

                <div className="rounded-2xl p-5" style={{ background: "#f8fafc" }}>
                  <p className="flex items-center gap-2 text-sm font-bold" style={{ color: "#0f172a" }}>
                    <i className="ri-user-line" style={{ color: "#2E6FAF" }} />
                    Patient information
                  </p>
                  <div className="mt-4 space-y-3 text-sm">
                    <Field label="Age" value={selectedRecord.age} />
                    <Field label="Sex" value={selectedRecord.sex} />
                    <Field label="Barangay" value={selectedRecord.barangay} />
                    <Field label="City" value={selectedRecord.city || "Pasig City"} />
                    <Field label="Source" value={selectedRecord.sourcePatient} />
                  </div>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-2xl p-5" style={{ background: "#f8fafc" }}>
                  <p className="flex items-center gap-2 text-sm font-bold" style={{ color: "#0f172a" }}>
                    <i className="ri-stethoscope-line" style={{ color: "#2E6FAF" }} />
                    Screening & diagnosis
                  </p>
                  <div className="mt-4 space-y-3 text-sm">
                    <Field label="Screening Date" value={selectedRecord.screeningDate} />
                    <Field label="Diagnosis Date" value={selectedRecord.diagnosisDate} />
                    <Field label="Notification Date" value={selectedRecord.notificationDate} />
                    <Field label="Facility" value={selectedRecord.facility} />
                  </div>
                </div>

                <div className="rounded-2xl p-5" style={{ background: "#f8fafc" }}>
                  <p className="flex items-center gap-2 text-sm font-bold" style={{ color: "#0f172a" }}>
                    <i className="ri-capsule-line" style={{ color: "#2E6FAF" }} />
                    Clinical & treatment
                  </p>
                  <div className="mt-4 space-y-3 text-sm">
                    <Field label="Anatomical Site" value={selectedRecord.anatomicalSite} />
                    <Field label="Registration Group" value={selectedRecord.registrationGroup} />
                    <Field label="Bacteriological Status" value={selectedRecord.bacteriologicalStatus} />
                    <Field label="Treatment Facility" value={selectedRecord.treatmentFacility || selectedRecord.facility} />
                    <Field label="Started Treatment" value={selectedRecord.treatmentStartDate} />
                    <Field label="Outcome Date" value={selectedRecord.outcomeDate} />
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