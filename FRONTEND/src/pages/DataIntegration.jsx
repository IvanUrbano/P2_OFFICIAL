import { useState, useEffect } from 'react';
import API from '../api/axios';
import { useTheme } from '../theme';

const EXPECTED_COLUMNS = [
  'Validation Status',
  'Date of Screening',
  'Date of Diagnosis',
  'Date of Notification',
  'Age',
  'Sex',
  'Barangay',
  'City',
  'Screening/Diagnosis Health Facility',
  'Treatment Health Facility',
  'Source of Patient',
  'Anatomical Site',
  'Registration Group',
  'Bacteriological Status',
  'Date Started Treatment',
  'Outcome/Status',
  'Date of Outcome/Status',
  'Date/Time Record Created',
];

const getStoredUser = () => {
  try {
    return JSON.parse(localStorage.getItem('user') || 'null');
  } catch {
    return null;
  }
};

const formatDate = (dateStr) => {
  if (!dateStr) return 'N/A';
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return dateStr;
  }
};

export default function DataIntegration() {
  const { t } = useTheme();
  const isAdmin = getStoredUser()?.role === 'admin';
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const [uploadError, setUploadError] = useState('');
  const [showColumns, setShowColumns] = useState(false);
  const [imports, setImports] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState('');
  const [selectedBatch, setSelectedBatch] = useState(null);
  const [batchSummary, setBatchSummary] = useState(null);
  const [batchErrors, setBatchErrors] = useState([]);
  const [batchLoading, setBatchLoading] = useState(false);

  useEffect(() => {
    if (getStoredUser()?.role !== 'admin') return;
    const fetchHistory = async () => {
      try {
        const res = await API.get('/api/tb/import-history');
        setImports(res.data.imports || []);
      } catch (err) {
        console.error('Failed to fetch import history:', err);
        setHistoryError('Could not load import history. Make sure the backend is running.');
      } finally {
        setHistoryLoading(false);
      }
    };
    fetchHistory();
  }, []);

  const handleFileChange = (e) => {
    setSelectedFile(e.target.files[0] || null);
    setUploadResult(null);
    setUploadError('');
  };

  const handleUpload = async () => {
    if (!selectedFile || uploading) return;
    setUploading(true);
    setUploadResult(null);
    setUploadError('');
    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      const res = await API.post('/api/tb/import', formData);
      setUploadResult(res.data);
      setSelectedFile(null);
      const historyRes = await API.get('/api/tb/import-history');
      setImports(historyRes.data.imports || []);
    } catch (err) {
      setUploadError(err.response?.data?.error || 'Import failed. Check the file format and try again.');
    } finally {
      setUploading(false);
    }
  };

  const handleViewErrors = async (batchId) => {
    if (selectedBatch === batchId) {
      setSelectedBatch(null);
      setBatchSummary(null);
      setBatchErrors([]);
      return;
    }
    setBatchLoading(true);
    try {
      const res = await API.get(`/api/tb/import/${batchId}/errors`);
      setSelectedBatch(batchId);
      setBatchSummary(res.data.summary || null);
      setBatchErrors(res.data.errors || []);
    } catch (err) {
      console.error('Failed to fetch batch errors:', err);
    } finally {
      setBatchLoading(false);
    }
  };

  if (!isAdmin) {
    return (
      <div className="flex flex-col gap-6">
        <div className="glass-card p-8 text-center">
          <i className="ri-lock-2-line text-4xl" style={{ color: '#D97706' }} />
          <p className="mt-3 text-sm font-bold" style={{ color: t.text }}>Admin access required</p>
          <p className="text-xs mt-1" style={{ color: t.textSecondary }}>
            Data import and import history are only available to admin users.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative space-y-5">

      <div className="glass-card p-5">
        <div className="flex items-center gap-2 text-sm font-bold" style={{ color: t.text }}>
          <i className="ri-upload-2-line text-lg" style={{ color: '#2E6FAF' }} />
          <span>Import TB Case Records</span>
        </div>
        <p className="mt-1 text-xs leading-relaxed" style={{ color: t.textSecondary }}>
          Upload a CSV or Excel file exported from the DOH TB-DOTS registry. Rows are validated against
          Pasig City barangays before import, and dashboard aggregations are rebuilt automatically.
        </p>

        <label
          className="mt-4 flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-10 text-center cursor-pointer transition hover:opacity-80"
          style={{ borderColor: 'rgba(46,111,175,0.35)', background: 'rgba(46,111,175,0.04)' }}
        >
          <input type="file" accept=".csv,.xls,.xlsx" className="sr-only" onChange={handleFileChange} />
          <i className="ri-file-upload-line text-3xl" style={{ color: '#2E6FAF' }} />
          {selectedFile ? (
            <>
              <span className="text-sm font-bold" style={{ color: t.text }}>{selectedFile.name}</span>
              <span className="text-[11px]" style={{ color: t.textSecondary }}>
                {(selectedFile.size / 1024).toFixed(1)} KB — click to choose a different file
              </span>
            </>
          ) : (
            <>
              <span className="text-sm font-bold" style={{ color: t.text }}>Click to choose a file</span>
              <span className="text-[11px]" style={{ color: t.textSecondary }}>CSV or Excel (.csv, .xls, .xlsx) · up to 50 MB</span>
            </>
          )}
        </label>

        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <button
            onClick={() => setShowColumns(v => !v)}
            className="inline-flex items-center gap-1.5 text-xs font-bold transition hover:opacity-80"
            style={{ color: '#2E6FAF' }}
          >
            <i className={showColumns ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} />
            Expected file format — 18 columns
          </button>
          <button
            onClick={handleUpload}
            disabled={!selectedFile || uploading}
            className="inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-xs font-bold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            style={{ background: 'linear-gradient(135deg, #0066FF 0%, #00D8F6 100%)' }}
          >
            <i className={uploading ? 'ri-loader-4-line animate-spin' : 'ri-upload-cloud-2-line'} />
            {uploading ? 'Importing...' : 'Import File'}
          </button>
        </div>

        {showColumns && (
          <div className="mt-4 rounded-xl p-4" style={{ background: t.inputBg, border: `1px solid ${t.inputBorder}` }}>
            <p className="text-[11px] font-bold uppercase tracking-widest mb-3" style={{ color: t.textSecondary }}>
              Expected columns (column order is flexible — headers are matched by keyword)
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {EXPECTED_COLUMNS.map((col, i) => (
                <div
                  key={col}
                  className="flex items-center gap-2 rounded-lg px-3 py-2 text-[11px] font-semibold"
                  style={{ background: t.inputBg, border: `1px solid ${t.inputBorder}`, color: t.textSecondary }}
                >
                  <span className="text-[10px] font-bold" style={{ color: '#94A3B8' }}>{String(i + 1).padStart(2, '0')}</span>
                  <span className="truncate">{col}</span>
                </div>
              ))}
            </div>
            <p className="mt-3 text-[11px] leading-relaxed" style={{ color: '#94A3B8' }}>
              Required per row: Barangay, Date of Diagnosis, Sex. Age must be 0–120 and City should be
              Pasig. Accepted date formats: MM/DD/YYYY, YYYY-MM-DD, DD-Mon-YY.
            </p>
          </div>
        )}
      </div>

      {uploadResult && (
        <div className="rounded-xl p-5" style={{ background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.25)' }}>
          <div className="flex items-center gap-2 text-sm font-bold" style={{ color: t.text }}>
            <i className="ri-checkbox-circle-line text-lg" style={{ color: '#10B981' }} />
            Import complete
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-xl p-3" style={{ background: t.card }}>
              <div className="text-[10px] font-bold uppercase tracking-widest" style={{ color: t.textSecondary }}>Total Rows</div>
              <div className="mt-1 text-xl font-bold" style={{ color: t.text }}>{uploadResult.batch?.totalRows ?? '—'}</div>
            </div>
            <div className="rounded-xl p-3" style={{ background: t.card }}>
              <div className="text-[10px] font-bold uppercase tracking-widest" style={{ color: t.textSecondary }}>Imported</div>
              <div className="mt-1 text-xl font-bold" style={{ color: '#10B981' }}>{uploadResult.batch?.imported ?? '—'}</div>
            </div>
            <div className="rounded-xl p-3" style={{ background: t.card }}>
              <div className="text-[10px] font-bold uppercase tracking-widest" style={{ color: t.textSecondary }}>Rejected</div>
              <div className="mt-1 text-xl font-bold" style={{ color: '#EF4444' }}>{uploadResult.batch?.errors ?? '—'}</div>
            </div>
            <div className="rounded-xl p-3" style={{ background: t.card }}>
              <div className="text-[10px] font-bold uppercase tracking-widest" style={{ color: t.textSecondary }}>Batch ID</div>
              <div className="mt-1 text-lg font-bold font-mono" style={{ color: t.text }}>
                {uploadResult.batch?.id ? uploadResult.batch.id.substring(0, 8) : '—'}
              </div>
            </div>
          </div>
          {(uploadResult.validation?.errors?.length > 0 || uploadResult.validation?.warnings?.length > 0) && (
            <div className="mt-3 space-y-2">
              {uploadResult.validation.errors.map((e, i) => (
                <div
                  key={i}
                  className="rounded-lg px-3 py-2 text-[11px] font-semibold"
                  style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.15)', color: '#B91C1C' }}
                >
                  Row {e.row}: {e.errors.join('; ')}
                </div>
              ))}
              {uploadResult.validation.warnings.map((w, i) => (
                <div
                  key={`w${i}`}
                  className="rounded-lg px-3 py-2 text-[11px] font-semibold"
                  style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.15)', color: '#92400E' }}
                >
                  Row {w.row}: {w.warnings.join('; ')}
                </div>
              ))}
          </div>
          )}
        </div>
      )}

      {uploadError && (
        <div
          className="rounded-xl p-4 text-sm font-semibold"
          style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.25)', color: '#B91C1C' }}
        >
          <i className="ri-error-warning-line mr-2" />
          {uploadError}
        </div>
      )}

      {selectedBatch && (
        <div className="glass-card p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2 text-sm font-bold" style={{ color: t.text }}>
              <i className="ri-error-warning-line text-lg" style={{ color: '#EF4444' }} />
              Batch Errors — {selectedBatch.substring(0, 8)}
            </div>
            <button
              onClick={() => {
                setSelectedBatch(null);
                setBatchSummary(null);
                setBatchErrors([]);
              }}
              aria-label="Close batch errors"
              className="inline-flex h-8 w-8 items-center justify-center rounded-full transition hover:opacity-80"
              style={{ background: t.panel, color: t.textSecondary }}
            >
              <i className="ri-close-line" />
            </button>
          </div>
          {batchLoading ? (
            <div className="flex items-center justify-center h-24">
              <i className="ri-loader-4-line animate-spin text-2xl" style={{ color: '#2E6FAF' }} />
            </div>
          ) : (
            <>
              {batchSummary && (
                <div className="mb-3 flex gap-6 text-xs font-bold" style={{ color: t.textSecondary }}>
                  <span>Total: <span style={{ color: t.text }}>{batchSummary.total_rows}</span></span>
                  <span>Imported: <span style={{ color: '#10B981' }}>{batchSummary.valid_rows}</span></span>
                  <span>Rejected: <span style={{ color: '#EF4444' }}>{batchSummary.error_rows}</span></span>
                </div>
              )}
              {batchErrors.length === 0 ? (
                <div className="text-center py-6 text-sm" style={{ color: '#94A3B8' }}>
                  No validation errors in this batch.
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                  {batchErrors.map((e) => (
                    <div
                      key={e.row_number}
                      className="rounded-lg px-3 py-2 text-[11px] font-semibold"
                      style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.15)', color: '#B91C1C' }}
                    >
                      Row {e.row_number} — Rejected
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      <div className="glass-card overflow-hidden">
        <div className="flex items-center justify-between p-5 pb-0">
          <div className="flex items-center gap-2 text-sm font-bold" style={{ color: t.text }}>
            <i className="ri-history-line text-lg" style={{ color: '#2E6FAF' }} />
            <span>Import History</span>
          </div>
          <span className="text-xs font-bold" style={{ color: t.textSecondary }}>{imports.length} imports</span>
        </div>

        {historyError && (
          <div
            className="mx-5 mt-4 rounded-xl px-3 py-2 text-xs font-semibold"
            style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.25)', color: '#B91C1C' }}
          >
            {historyError}
          </div>
        )}

        <div className="mt-4 overflow-x-auto">
            <table className="min-w-full border-separate border-spacing-0 text-left text-sm">
              <thead>
                <tr>
                  {['Batch', 'File', 'Imported At', 'Rows', 'Imported', 'Rejected', 'Action'].map((h) => (
                    <th
                      key={h}
                      className="px-5 py-3 text-left text-[10px] font-bold uppercase tracking-wider whitespace-nowrap"
                      style={{ color: t.textSecondary, borderBottom: '1px solid rgba(148,163,184,.15)' }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {imports.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-5 py-12 text-center text-sm" style={{ color: '#94A3B8' }}>
                      No imports yet. Upload your first file above.
                    </td>
                  </tr>
                ) : (
                  imports.map((row) => (
                    <tr key={row.batch_id}>
                      <td className="px-5 py-3 font-mono text-xs font-bold" style={{ color: t.text }}>
                        {row.batch_id.substring(0, 8)}
                      </td>
                      <td className="px-5 py-3 text-xs" style={{ color: t.textSecondary }}>{row.source_file}</td>
                      <td className="px-5 py-3 text-xs" style={{ color: t.textSecondary }}>{formatDate(row.imported_at)}</td>
                      <td className="px-5 py-3 text-xs font-semibold" style={{ color: t.text }}>{row.total_rows}</td>
                      <td className="px-5 py-3 text-xs font-semibold" style={{ color: '#10B981' }}>{row.valid_rows}</td>
                      <td className="px-5 py-3 text-xs font-semibold" style={{ color: '#EF4444' }}>{row.error_rows}</td>
                      <td className="px-5 py-3">
                        <button
                          onClick={() => handleViewErrors(row.batch_id)}
                          disabled={Number(row.error_rows) === 0}
                          className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-[11px] font-bold transition hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-40"
                          style={{ background: 'rgba(46,111,175,0.1)', border: '1px solid rgba(46,111,175,0.25)', color: '#2E6FAF' }}
                        >
                          <i className={selectedBatch === row.batch_id ? 'ri-eye-off-line' : 'ri-eye-line'} />
                          {selectedBatch === row.batch_id ? 'Hide Errors' : 'Errors'}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
      </div>

    </div>
  );
}
