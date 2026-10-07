import { useState, useRef, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import API from '../api/axios';
import { useTheme } from '../theme';
import EmptyState from '../components/EmptyState';
import ModalCloseButton from '../components/ModalCloseButton';
import StatusBadge from '../components/StatusBadge';
import ProgressOverlay from '../components/ProgressOverlay';

const cardStyle = (t) => ({
  background: t.cardSolid,
  border: `1px solid ${t.border}`,
  borderRadius: '12px',
  boxShadow: '0 4px 16px rgba(15,23,42,0.04)',
});

const MAIN_TABS = [
  { key: 'import', label: 'Import New Dataset', desc: 'Upload and process tuberculosis reporting data for PASIG TB-IS.' },
  { key: 'history', label: 'Import History', desc: 'View and manage previous tuberculosis dataset imports.' },
];

const HISTORY_TABS = [
  { key: 'active', label: 'Active', desc: 'Active imports' },
  { key: 'archived', label: 'Archived', desc: 'Archived imports' },
  { key: 'all', label: 'All', desc: 'All imports' },
];
const MAX_FILE_SIZE = 20 * 1024 * 1024;

export default function DataImportPage() {
  const { t } = useTheme();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const fileRef = useRef(null);
  const [file, setFile] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  // Real upload progress (0–100) while the file is sent; null once the server is processing it.
  const [uploadPercent, setUploadPercent] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [duplicateInfo, setDuplicateInfo] = useState(null);
  // Historical dataset imports default to historical classification.
  const [historical, setHistorical] = useState(true);
  const [namesEnabled, setNamesEnabled] = useState(false);
  useEffect(() => {
    API.get('/api/data/import-options').then(r => setNamesEnabled(Boolean(r.data.namesEnabled))).catch(() => setNamesEnabled(false));
  }, []);

  const [mainTab, setMainTab] = useState(searchParams.get('tab') === 'history' ? 'history' : 'import');
  const [historyTab, setHistoryTab] = useState('active');
  const [historySearch, setHistorySearch] = useState('');
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [showArchive, setShowArchive] = useState(null);
  const [archiveReason, setArchiveReason] = useState('');
  const [archiving, setArchiving] = useState(false);

  const [user, setUser] = useState(null);
  const [showDelete, setShowDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const [showDetails, setShowDetails] = useState(null);
  const [detailsData, setDetailsData] = useState(null);
  const [detailsLoading, setDetailsLoading] = useState(false);

  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab === 'history') setMainTab('history');
  }, [searchParams]);

  useEffect(() => {
    try { setUser(JSON.parse(localStorage.getItem('user') || 'null')); } catch { setUser(null); }
  }, []);

  const isAdmin = user?.role === 'admin';

  const fetchHistory = async (status) => {
    setHistoryLoading(true);
    try {
      const res = await API.get(`/api/data/import-history?status=${status}`);
      setHistory(res.data.batches || []);
    } catch (err) {
      console.error(err);
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    if (mainTab === 'history') {
      fetchHistory(historyTab);
    }
  }, [mainTab, historyTab]);

  const acceptFile = (f) => {
    if (!f) return;
    const ext = f.name.split('.').pop().toLowerCase();
    if (!['xlsx', 'xls', 'csv'].includes(ext)) {
      setFile(null);
      setError('Unsupported file type. Choose an .xlsx, .xls or .csv file.');
      return;
    }
    if (f.size > MAX_FILE_SIZE) {
      setFile(null);
      setError('File exceeds the 20 MB limit. Choose a smaller file.');
      return;
    }
    setFile(f); setError(''); setResult(null); setDuplicateInfo(null);
  };

  const handleFile = (e) => {
    acceptFile(e.target.files?.[0]);
    e.target.value = '';
  };

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    setUploadPercent(0);
    setError('');
    setDuplicateInfo(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('historical', String(historical || !namesEnabled));
      const res = await API.post('/api/data/import', formData, {
        onUploadProgress: (e) => {
          if (!e.total) return;
          // Fully sent → the server is now reading and checking the file.
          setUploadPercent(e.loaded >= e.total ? null : (e.loaded / e.total) * 100);
        },
      });
      setResult(res.data);
      window.dispatchEvent(new Event('IMPORT_COMPLETED'));
    } catch (err) {
      if (err.response?.status === 409 && err.response?.data?.isDuplicate) {
        setDuplicateInfo(err.response.data);
      } else {
        setError(err.response?.data?.error || 'Upload failed.');
      }
    } finally {
      setUploading(false);
    }
  };

  const handleArchive = async () => {
    if (!showArchive) return;
    setArchiving(true);
    try {
      await API.patch(`/api/data/batches/${showArchive.id}/archive`, { reason: archiveReason });
      setShowArchive(null);
      setArchiveReason('');
      fetchHistory(historyTab);
      window.dispatchEvent(new Event('IMPORT_COMPLETED'));
    } catch (err) {
      console.error(err);
    } finally {
      setArchiving(false);
    }
  };

  const handleDelete = async () => {
    if (!showDelete) return;
    setDeleting(true);
    setDeleteError('');
    try {
      await API.delete(`/api/data/batches/${showDelete.id}`);
      setShowDelete(null);
      fetchHistory(historyTab);
      window.dispatchEvent(new Event('IMPORT_COMPLETED'));
    } catch (err) {
      setDeleteError(err.response?.data?.error || 'Failed to delete batch.');
    } finally {
      setDeleting(false);
    }
  };

  const openDetails = async (batchId) => {
    setShowDetails(true);
    setDetailsLoading(true);
    setDetailsData(null);
    try {
      const res = await API.get(`/api/data/batches/${batchId}/details`);
      setDetailsData(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setDetailsLoading(false);
    }
  };

  const filteredHistory = history.filter((b) => {
    if (!historySearch) return true;
    const q = historySearch.toLowerCase();
    return b.filename?.toLowerCase().includes(q) || b.id?.toLowerCase().includes(q) || b.importedBy?.toLowerCase().includes(q)
      || b.importedByUsername?.toLowerCase().includes(q);
  });

  return (
    <div className="space-y-6">
      <ProgressOverlay
        open={uploading}
        title={`Importing ${file?.name || 'file'}`}
        detail={uploadPercent === null ? 'File received. Checking and saving records.' : 'Sending file to PASIG TB-IS.'}
        percent={uploadPercent}
        note="Keep this page open until the import finishes."
      />
      <ProgressOverlay
        open={deleting}
        title={`Deleting ${showDelete?.filename || 'batch'}`}
        detail="Removing its records from PASIG TB-IS and TBInsight. TBInsight's analysis is then re-run on the remaining data."
        tone="#DC2626"
        note="Keep this page open until deletion finishes."
      />
      <ProgressOverlay
        open={archiving}
        title={`Archiving ${showArchive?.filename || 'batch'}`}
        detail="Moving the batch out of the active import list."
        tone="#D97706"
      />
      <div className="rounded-xl overflow-hidden" style={{ background: '#ffffff', boxShadow: '0 2px 16px rgba(15,45,82,0.07), 0 1px 3px rgba(15,45,82,0.04)', border: '1px solid #E2E8F0' }}>
        <div className="px-6 py-4" style={{ borderBottom: '1px solid #DBEAFE' }}>
          <h1 className="text-lg font-extrabold tracking-tight" style={{ color: '#0F2D52' }}>Data Import</h1>
          <p className="text-xs mt-0.5" style={{ color: '#94A3B8' }}>
            {mainTab === 'import' ? 'Upload and process tuberculosis reporting data for PASIG TB-IS.' : 'View and manage previous tuberculosis dataset imports.'}
          </p>
        </div>
        <div style={{ borderBottom: '1px solid #E2E8F0' }}>
          <div className="flex gap-0 overflow-x-auto">
            {MAIN_TABS.map(tab => (
              <button
                key={tab.key}
                onClick={() => setMainTab(tab.key)}
                className="relative px-6 py-3 text-left transition-colors whitespace-nowrap"
                style={{ background: 'transparent' }}
              >
                <p className="text-[13px] font-bold" style={{ color: mainTab === tab.key ? '#0F2D52' : '#94A3B8' }}>
                  {tab.label}
                </p>
                <p className="text-[11px] mt-0.5" style={{ color: mainTab === tab.key ? '#64748B' : '#CBD5E1' }}>
                  {tab.desc}
                </p>
                {mainTab === tab.key && (
                  <div className="absolute bottom-0 left-0 right-0 h-[2px]" style={{ background: '#0F2D52' }} />
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      {mainTab === 'import' && (
        <>
          <div className="rounded-xl p-6" style={{ background: '#ffffff', border: '1px solid #E2E8F0', boxShadow: '0 4px 16px rgba(15,23,42,0.04)' }}>
            <div className="mb-5">
              <h2 className="text-sm font-bold" style={{ color: '#0F172A' }}>Upload tuberculosis records file</h2>
              <p className="mt-1 text-xs leading-relaxed" style={{ color: '#475569' }}>
                Upload an Excel registry file (.xlsx with DSTB and MN sheets) or a CSV export of one sheet. Rows are cleaned and validated before sync.
              </p>
              <ul className="mt-2 text-[11px] leading-relaxed list-disc ml-4" style={{ color: '#64748B' }}>
                <li><span className="font-semibold" style={{ color: '#475569' }}>Required for every row:</span> Case ID, Patient Name, Date of Diagnosis, Sex, and Age.</li>
                <li><span className="font-semibold" style={{ color: '#475569' }}>Patient Name:</span> stored and displayed only to authorized users.</li>
                <li><span className="font-semibold" style={{ color: '#475569' }}>Barangay:</span> missing or unrecognized Pasig barangays are sent to <strong>Validation → Needs Assignment</strong> and are not validated until resolved.</li>
                <li><span className="font-semibold" style={{ color: '#475569' }}>DSTB:</span> uses the Case ID from the uploaded file. The system never generates a Case ID. A missing Case ID becomes a <strong>Data Issue</strong>.</li>
                <li><span className="font-semibold" style={{ color: '#475569' }}>MN:</span> uses the same Case ID rule. Do not use ITIS Lite Case No. as the system Case ID.</li>
              </ul>
            </div>

            <label
              onDragOver={e => { e.preventDefault(); setDragging(true); }}
              onDragLeave={e => { e.preventDefault(); if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false); }}
              onDrop={e => { e.preventDefault(); setDragging(false); acceptFile(e.dataTransfer.files?.[0]); }}
              className="flex min-h-[110px] items-center gap-4 border border-dashed px-6 py-5 text-left cursor-pointer transition-colors"
              style={{ borderColor: dragging ? '#64748B' : '#CBD5E1', background: dragging ? '#F8FAFC' : '#ffffff' }}
            >
              <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="sr-only" onChange={handleFile} />
              <i className={file ? (file.name.toLowerCase().endsWith('.csv') ? 'ri-file-text-line text-3xl' : 'ri-file-excel-2-line text-3xl') : 'ri-upload-cloud-2-line text-3xl'} style={{ color: '#64748B' }} />
              {file ? (
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold" style={{ color: '#0F172A' }}>{file.name}</span>
                  <span className="mt-0.5 block text-xs" style={{ color: '#64748B' }}>{(file.size / 1024).toFixed(1)} KB · click to change file</span>
                </span>
              ) : (
                <span>
                  <span className="block text-sm font-semibold" style={{ color: '#0F172A' }}>Click or drag file to choose</span>
                  <span className="mt-0.5 block text-xs" style={{ color: '#64748B' }}>Excel (.xlsx, .xls) or CSV (.csv) · max 20 MB</span>
                </span>
              )}
            </label>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t pt-4 text-xs" style={{ borderColor: '#E2E8F0', color: '#64748B' }}>
              <span>Expected sheets: <strong style={{ color: '#334155' }}>DSTB, MN</strong> · Required fields: <strong style={{ color: '#334155' }}>Case ID, Patient Name, Date of Diagnosis, Sex, and Age</strong>.</span>
            </div>

            {error && (
              <div className="mt-4 px-3.5 py-2.5 rounded-lg text-xs flex items-center gap-2" style={{ background: '#FEF2F2', color: '#991B1B', border: '1px solid #FCA5A5' }}>
                <i className="ri-error-warning-line text-sm shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {duplicateInfo && (
              <div className="mt-4 px-4 py-3 text-xs" style={{ background: '#FBF8F2', color: '#475569', border: '1px solid #E7DED0', borderLeft: '3px solid #B77932' }}>
                <div className="flex items-center gap-2 mb-1">
                  <i className="ri-file-shield-line text-sm shrink-0" style={{ color: '#9A672D' }} />
                  <span className="font-semibold text-sm" style={{ color: '#334155' }}>File already imported</span>
                </div>
                <p className="mb-3" style={{ color: '#64748B' }}>This file appears to have already been processed.</p>
                {duplicateInfo.previousImport && (
                  <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8" style={{ borderTop: '1px solid #E7DED0' }}>
                    {[
                      ['Batch', duplicateInfo.previousImport.batchId?.slice(0, 8) || '—'],
                      ['File', duplicateInfo.previousImport.filename || '—'],
                      ['Imported by', duplicateInfo.previousImport.importedBy || 'Unknown'],
                      ['Date', duplicateInfo.previousImport.importedAt ? new Date(duplicateInfo.previousImport.importedAt).toLocaleDateString() : '—'],
                      ['Status', duplicateInfo.previousImport.syncStatus || '—'],
                    ].map(([label, value]) => (
                      <div key={label} className="flex justify-between gap-4 py-1.5" style={{ borderBottom: '1px solid #EEE7DC' }}>
                        <dt style={{ color: '#64748B' }}>{label}</dt>
                        <dd className="text-right break-all" style={{ color: '#334155' }}>{value}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                <div className="mt-3">
                  <button onClick={() => setDuplicateInfo(null)} className="px-3 py-1.5 text-[11px] font-semibold cursor-pointer" style={{ background: '#FFFFFF', color: '#475569', border: '1px solid #CBD5E1', borderRadius: 4 }}>
                    Upload Different File
                  </button>
                </div>
              </div>
            )}

            {file && (
              <label className="mt-4 flex items-start gap-2.5 px-4 py-3 rounded-lg cursor-pointer" style={{ background: '#F8FAFC', border: '1px solid #E2E8F0' }}>
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={historical || !namesEnabled}
                  disabled={!namesEnabled || uploading}
                  onChange={e => setHistorical(e.target.checked)}
                />
                <span className="text-xs" style={{ color: '#0F2D52' }}>
                  <span className="font-bold">Historical Dataset</span>
                  <span className="block text-[11px] mt-0.5" style={{ color: '#64748B' }}>
                    Client-approved patient information, including <strong>patient names</strong>, may be retained and displayed in authorized system views. Access remains restricted based on user roles and barangay assignments.
                  </span>
                </span>
              </label>
            )}

            {file && (
              <div className="mt-4 flex justify-end">
                <button
                  onClick={handleUpload}
                  disabled={uploading}
                  className="inline-flex items-center justify-center gap-2 px-5 py-2.5 text-xs font-bold rounded-lg transition-colors cursor-pointer disabled:cursor-wait"
                  style={{ background: uploading ? '#64748B' : '#0F2D52', color: '#ffffff', border: `1px solid ${uploading ? '#64748B' : '#0F2D52'}` }}
                  onMouseEnter={e => { if (!uploading) e.currentTarget.style.background = '#174A7E'; }}
                  onMouseLeave={e => e.currentTarget.style.background = uploading ? '#64748B' : '#0F2D52'}
                >
                  {uploading ? 'Uploading and importing...' : 'Upload & Import'}
                </button>
              </div>
            )}
          </div>

          {result && (
            <div className="p-5" style={{ background: '#ffffff', border: '1px solid #DCE3EA', borderLeft: '3px solid #526A56' }}>
              <div className="flex items-center gap-2 mb-3 pb-3" style={{ borderBottom: '1px solid #E8EDF2' }}>
                <i className="ri-checkbox-circle-line text-base" style={{ color: '#526A56' }} aria-hidden="true" />
                <h3 className="text-sm font-semibold" style={{ color: '#263746' }}>Import complete</h3>
              </div>
              <dl className="grid grid-cols-2 sm:grid-cols-5 gap-x-6 gap-y-3">
                {[
                  { label: 'Batch ID', value: result.batch?.id?.slice(0, 8) || '—' },
                  { label: 'Total Records', value: result.batch?.totalRows || 0 },
                  { label: 'DSTB', value: result.batch?.dstbCount || 0 },
                  { label: 'MN', value: result.batch?.mnCount || 0 },
                  { label: 'Patient names', value: result.batch?.identityClass === 'operational' ? 'Shown to authorized users' : 'De-identified' },
                ].map((item) => (
                  <div key={item.label} className="min-w-0">
                    <dt className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: '#64748B' }}>{item.label}</dt>
                    <dd className="mt-1 text-sm font-semibold break-words" style={{ color: '#334155' }}>{item.value}</dd>
                  </div>
                ))}
              </dl>
              {Array.isArray(result.warnings) && result.warnings.length > 0 && (
                <div className="mt-4 px-3.5 py-2.5 rounded-lg text-xs" style={{ background: '#FFFBEB', color: '#92400E', border: '1px solid #FCD34D' }}>
                  {result.warnings.map((w, i) => (
                    <div key={i} className="flex items-start gap-2 py-0.5">
                      <i className="ri-information-line text-sm shrink-0" />
                      <span>{w}</span>
                    </div>
                  ))}
                </div>
              )}
              <button onClick={() => navigate(`/validation?batchId=${result.batch?.id}`)} className="mt-4 px-3.5 py-2 text-xs font-semibold transition-colors cursor-pointer" style={{ background: '#0F2D52', color: '#ffffff', borderRadius: 4 }}>
                Continue to Validation &rarr;
              </button>
            </div>
          )}
        </>
      )}

      {mainTab === 'history' && (
        <div className="rounded-xl overflow-hidden" style={{ background: '#ffffff', border: '1px solid #E2E8F0', boxShadow: '0 4px 16px rgba(15,23,42,0.04)' }}>
          <div style={{ borderBottom: '1px solid #E2E8F0' }}>
            <div className="flex gap-0 overflow-x-auto">
              {HISTORY_TABS.map(tab => (
                <button
                  key={tab.key}
                  onClick={() => setHistoryTab(tab.key)}
                  className="relative px-6 py-3 text-left transition-colors whitespace-nowrap"
                  style={{ background: 'transparent' }}
                >
                  <p className="text-[13px] font-bold" style={{ color: historyTab === tab.key ? '#0F2D52' : '#94A3B8' }}>
                    {tab.label}
                  </p>
                  <p className="text-[11px] mt-0.5" style={{ color: historyTab === tab.key ? '#64748B' : '#CBD5E1' }}>
                    {tab.desc}
                  </p>
                  {historyTab === tab.key && (
                    <div className="absolute bottom-0 left-0 right-0 h-[2px]" style={{ background: '#0F2D52' }} />
                  )}
                </button>
              ))}
            </div>
          </div>

          <div className="px-6 py-3" style={{ background: '#F8FAFC', borderTop: '1px solid #E2E8F0' }}>
            <div className="relative max-w-sm">
              <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-sm" style={{ color: '#94A3B8' }} />
              <input
                type="text" value={historySearch} onChange={(e) => setHistorySearch(e.target.value)}
                placeholder="Search by file name, batch ID..."
                className="w-full pl-9 pr-3 py-2 text-xs rounded-lg outline-none"
                style={{ background: '#ffffff', border: '1px solid #E2E8F0', color: '#0F2D52' }}
              />
            </div>
          </div>

          {historyLoading ? (
            <div className="flex items-center justify-center py-12">
              <i className="ri-loader-4-line animate-spin text-lg" style={{ color: '#94A3B8' }} />
            </div>
          ) : filteredHistory.length === 0 ? (
            <EmptyState icon="ri-history-line" title="No Import History" description="Imported batches will appear here." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1000px] text-left" style={{ borderCollapse: 'collapse' }}>
                <colgroup>
                  {[10, 18, 13, 7, 7, 7, 12, 10, 16].map((width, index) => (
                    <col key={index} style={{ width: `${width}%` }} />
                  ))}
                </colgroup>
                <thead>
                  <tr style={{ background: '#0F2D52' }}>
                    {['Batch ID', 'File Name', 'Imported By', 'Records', 'Accepted', 'Rejected', 'Sync Status', 'Date', 'Actions'].map((h) => (
                      <th key={h} className="px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider whitespace-nowrap" style={{ color: '#ffffff', borderBottom: '1px solid #1E40AF', borderRight: h === 'Actions' ? 'none' : '1px solid #1E40AF' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredHistory.map((b, index) => (
                    <tr key={b.id} className={`hover:bg-blue-50 transition-colors ${index % 2 === 0 ? 'bg-white' : 'bg-[#F8FAFC]'}`} style={{ borderBottom: '1px solid #E2E8F0' }}>
                      <td className="px-3 py-2.5 text-[11px] font-bold font-mono whitespace-nowrap" style={{ color: '#0F2D52', borderRight: '1px solid #E2E8F0' }} title={b.id || undefined}>{b.id?.slice(0, 8) || '—'}</td>
                      <td className="px-3 py-2.5 text-[11px] font-semibold whitespace-nowrap overflow-hidden text-ellipsis" style={{ color: '#0F2D52', borderRight: '1px solid #E2E8F0' }} title={b.filename || undefined}>{b.filename || '—'}</td>
                      <td className="px-3 py-2.5 text-[11px]" style={{ color: '#475569', borderRight: '1px solid #E2E8F0' }}>
                        {b.importedBy || '—'}
                        {b.importedByUsername && b.importedByUsername !== b.importedBy && (
                          <span className="block text-[10px]" style={{ color: '#94A3B8' }}>@{b.importedByUsername}</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-[11px] font-semibold" style={{ color: '#475569', borderRight: '1px solid #E2E8F0' }}>{b.records ?? '—'}</td>
                      <td className="px-3 py-2.5 text-[11px] font-semibold" style={{ color: '#526A56', borderRight: '1px solid #E2E8F0' }}>{b.validated ?? '—'}</td>
                      <td className="px-3 py-2.5 text-[11px] font-semibold" style={{ color: b.rejected > 0 ? '#B91C1C' : '#475569', borderRight: '1px solid #E2E8F0' }}>{b.rejected ?? '—'}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap" style={{ borderRight: '1px solid #E2E8F0' }}><StatusBadge status={b.syncStatus || b.status} /></td>
                      <td className="px-3 py-2.5 text-[11px] whitespace-nowrap" style={{ color: '#64748B', borderRight: '1px solid #E2E8F0' }}>{b.importedAt ? new Date(b.importedAt).toLocaleDateString() : '—'}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex flex-wrap gap-1">
                          <button onClick={() => openDetails(b.id)} className="px-2 py-1 text-[10px] font-semibold rounded cursor-pointer" style={{ color: '#2E6FAF' }}>View</button>
                          {!b.isArchived && b.status === 'validated' && b.syncStatus !== 'synced' && isAdmin && (
                            <button onClick={() => navigate(`/sync?batchId=${b.id}`)} className="px-2 py-1 text-[10px] font-semibold rounded cursor-pointer" style={{ color: '#10B981' }}>Sync</button>
                          )}
                          {!b.isArchived && (b.status === 'validated' || b.syncStatus === 'synced') && isAdmin && (
                            <button onClick={() => setShowArchive(b)} className="px-2 py-1 text-[10px] font-semibold rounded cursor-pointer" style={{ color: '#D97706' }}>Archive</button>
                          )}
                          {isAdmin && (
                            <button onClick={() => { setShowDelete(b); setDeleteError(''); }} className="px-2 py-1 text-[10px] font-semibold rounded cursor-pointer" style={{ color: '#EF4444' }}>Delete</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {showArchive && (
        <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/40 backdrop-blur-[2px]" onClick={() => { setShowArchive(null); setArchiveReason(''); }}>
          <div className="bg-white border border-gray-200 shadow-xl w-full max-w-[460px] mx-4 overflow-hidden" style={{ borderRadius: '5px' }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b shrink-0" style={{ background: '#0F2D52', borderColor: '#1E40AF' }}>
              <div className="min-w-0">
                <h3 className="text-sm font-bold" style={{ color: '#ffffff' }}>Archive Import Batch</h3>
              </div>
              <ModalCloseButton onClick={() => { setShowArchive(null); setArchiveReason(''); }} light />
            </div>
            <div className="px-5 py-4">
              <dl className="divide-y" style={{ borderColor: '#E2E8F0' }}>
                <div className="flex justify-between gap-4 py-2 first:pt-0">
                  <dt className="text-[11px]" style={{ color: '#64748B' }}>Batch ID</dt>
                  <dd className="text-[11px] font-mono font-semibold text-right" style={{ color: '#0F2D52' }}>{showArchive.id?.slice(0, 8) || '—'}</dd>
                </div>
                <div className="flex justify-between gap-4 py-2">
                  <dt className="text-[11px] shrink-0" style={{ color: '#64748B' }}>File</dt>
                  <dd className="text-[11px] font-semibold text-right break-all" style={{ color: '#0F2D52' }}>{showArchive.filename || '—'}</dd>
                </div>
              </dl>
              <p className="text-xs leading-relaxed" style={{ color: '#475569' }}>
                This batch will be removed from the active import list. Its associated records, synchronization history, and audit trail will be preserved.
              </p>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider block mb-1" style={{ color: '#64748B' }}>Reason for Archiving</label>
                <textarea
                  value={archiveReason}
                  onChange={(e) => setArchiveReason(e.target.value)}
                  placeholder="Enter reason..."
                  rows={3}
                  className="w-full px-3 py-2 text-xs outline-none resize-none"
                  style={{ background: '#ffffff', border: '1px solid #CBD5E1', borderRadius: 4, color: '#0F2D52' }}
                />
              </div>
            </div>
            <div className="px-5 py-3 border-t border-gray-100 flex justify-end gap-2">
              <button onClick={() => { setShowArchive(null); setArchiveReason(''); }} className="px-4 py-2 text-xs font-medium cursor-pointer" style={{ background: '#F3F4F6', color: '#374151', border: '1px solid #D1D5DB', borderRadius: 4 }}>Cancel</button>
              <button onClick={handleArchive} disabled={archiving} className="px-4 py-2 text-xs font-semibold text-white cursor-pointer disabled:opacity-50" style={{ background: '#0F2D52', border: '1px solid #0F2D52', borderRadius: 4 }}>{archiving ? 'Archiving...' : 'Archive Batch'}</button>
            </div>
          </div>
        </div>
      )}

      {showDelete && (
        <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/40 backdrop-blur-[2px]" onClick={() => { if (!deleting) { setShowDelete(null); setDeleteError(''); } }}>
          <div className="bg-white border border-gray-200 shadow-xl w-full max-w-[460px] mx-4 overflow-hidden" style={{ borderRadius: '5px' }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b shrink-0" style={{ background: '#0F2D52', borderColor: '#1E40AF' }}>
              <div className="min-w-0">
                <h3 className="text-sm font-bold" style={{ color: '#ffffff' }}>Delete Import Batch</h3>
              </div>
              <ModalCloseButton onClick={() => { if (!deleting) { setShowDelete(null); setDeleteError(''); } }} light />
            </div>
            <div className="px-5 py-4 space-y-3">
              <dl className="divide-y" style={{ borderColor: '#E2E8F0' }}>
                <div className="flex justify-between gap-4 py-2 first:pt-0">
                  <dt className="text-[11px]" style={{ color: '#64748B' }}>Batch ID</dt>
                  <dd className="text-[11px] font-mono font-semibold text-right" style={{ color: '#0F2D52' }}>{showDelete.id?.slice(0, 8) || '—'}</dd>
                </div>
                <div className="flex justify-between gap-4 py-2">
                  <dt className="text-[11px] shrink-0" style={{ color: '#64748B' }}>File</dt>
                  <dd className="text-[11px] font-semibold text-right break-all" style={{ color: '#0F2D52' }}>{showDelete.filename || '—'}</dd>
                </div>
              </dl>
              <p className="text-xs leading-relaxed" style={{ color: '#475569' }}>
                This permanently deletes the batch and its records from PASIG TB-IS and, if already synced, from TBInsight. Related forecasts, risk levels, and alerts are also removed; analysis is rerun using the remaining data. This cannot be undone.
              </p>
              {deleteError && (
                <div role="alert" className="px-3 py-2 text-xs" style={{ background: '#FEF2F2', border: '1px solid #FECACA', color: '#B91C1C' }}>{deleteError}</div>
              )}
            </div>
            <div className="px-5 py-3 border-t border-gray-100 flex justify-end gap-2">
              <button onClick={() => { setShowDelete(null); setDeleteError(''); }} disabled={deleting} className="px-4 py-2 text-xs font-medium cursor-pointer disabled:opacity-50" style={{ background: '#F3F4F6', color: '#374151', border: '1px solid #D1D5DB', borderRadius: 4 }}>Cancel</button>
              <button onClick={handleDelete} disabled={deleting} className="px-4 py-2 text-xs font-semibold text-white cursor-pointer disabled:opacity-50" style={{ background: '#B91C1C', border: '1px solid #B91C1C', borderRadius: 4 }}>{deleting ? 'Deleting...' : 'Delete Permanently'}</button>
            </div>
          </div>
        </div>
      )}

      {showDetails && (
        <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/40 backdrop-blur-[2px]" onClick={() => setShowDetails(false)}>
          <div className="bg-white border border-gray-200 shadow-xl w-full max-w-[640px] mx-4 overflow-hidden max-h-[85vh] flex flex-col" style={{ borderRadius: '5px' }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b shrink-0" style={{ background: '#0F2D52', borderColor: '#1E40AF' }}>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold" style={{ color: '#ffffff' }}>Import Details</h3>
              </div>
              <ModalCloseButton onClick={() => setShowDetails(false)} light />
            </div>
            <div className="px-5 py-4 overflow-y-auto divide-y" style={{ borderColor: '#E2E8F0' }}>
              {detailsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <i className="ri-loader-4-line animate-spin text-lg" style={{ color: '#94A3B8' }} />
                </div>
              ) : detailsData ? (
                <>
                  <div className="py-3 first:pt-0">
                    <h4 className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: '#64748B' }}>Import Information</h4>
                    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8">
                      <div className="flex justify-between gap-3 py-1.5 border-b" style={{ borderColor: '#F1F5F9' }}><dt className="text-[11px]" style={{ color: '#64748B' }}>Batch ID</dt><dd className="text-[11px] font-mono font-semibold text-right" style={{ color: '#0F2D52' }}>{detailsData.batch?.id?.slice(0, 8) || '—'}</dd></div>
                      <div className="flex justify-between gap-3 py-1.5 border-b" style={{ borderColor: '#F1F5F9' }}><dt className="text-[11px]" style={{ color: '#64748B' }}>File Name</dt><dd className="text-[11px] font-semibold text-right break-all" style={{ color: '#0F2D52' }}>{detailsData.batch?.filename || '—'}</dd></div>
                      <div className="flex justify-between gap-3 py-1.5 border-b" style={{ borderColor: '#F1F5F9' }}><dt className="text-[11px]" style={{ color: '#64748B' }}>Imported By</dt><dd className="text-[11px] text-right" style={{ color: '#475569' }}>{detailsData.batch?.imported_by_username || '—'}</dd></div>
                      <div className="flex justify-between gap-3 py-1.5 border-b" style={{ borderColor: '#F1F5F9' }}><dt className="text-[11px]" style={{ color: '#64748B' }}>Import Date</dt><dd className="text-[11px] text-right" style={{ color: '#475569' }}>{detailsData.batch?.created_at ? new Date(detailsData.batch.created_at).toLocaleString() : '—'}</dd></div>
                      <div className="flex justify-between gap-3 py-1.5 border-b" style={{ borderColor: '#F1F5F9' }}><dt className="text-[11px]" style={{ color: '#64748B' }}>Total Records</dt><dd className="text-[11px] font-semibold text-right" style={{ color: '#0F2D52' }}>{detailsData.batch?.total_rows ?? '—'}</dd></div>
                      <div className="flex justify-between items-center gap-3 py-1.5 border-b" style={{ borderColor: '#F1F5F9' }}><dt className="text-[11px]" style={{ color: '#64748B' }}>Status</dt><dd className="text-right"><StatusBadge status={detailsData.batch?.status} /></dd></div>
                    </dl>
                  </div>

                  <div className="py-3">
                    <h4 className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: '#64748B' }}>Validation Summary</h4>
                    <dl className="grid grid-cols-1 sm:grid-cols-3 gap-x-6">
                      <div className="flex justify-between sm:block gap-3 py-1"><dt className="text-[11px]" style={{ color: '#64748B' }}>Accepted</dt><dd className="text-xs font-semibold sm:mt-1" style={{ color: '#526A56' }}>{detailsData.batch?.valid_count ?? '—'}</dd></div>
                      <div className="flex justify-between sm:block gap-3 py-1"><dt className="text-[11px]" style={{ color: '#64748B' }}>Rejected</dt><dd className="text-xs font-semibold sm:mt-1" style={{ color: '#B91C1C' }}>{detailsData.batch?.error_count ?? '—'}</dd></div>
                      <div className="flex justify-between sm:block items-center gap-3 py-1"><dt className="text-[11px]" style={{ color: '#64748B' }}>Sync Status</dt><dd className="sm:mt-1"><StatusBadge status={detailsData.batch?.sync_status} /></dd></div>
                    </dl>
                  </div>

                  {detailsData.syncLogs?.length > 0 && (
                    <div className="py-3">
                      <h4 className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: '#64748B' }}>Synchronization History</h4>
                      <div>
                        {detailsData.syncLogs.map((log, i) => (
                          <div key={i} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2 border-b last:border-b-0 text-[11px]" style={{ borderColor: '#F1F5F9' }}>
                            <div className="flex items-center gap-2">
                              <span className="w-1.5 h-1.5 rounded-full" style={{ background: log.status === 'sent' ? '#526A56' : '#B91C1C' }} />
                              <span className="font-semibold" style={{ color: '#0F2D52' }}>{log.username || 'System'}</span>
                            </div>
                            <span style={{ color: '#64748B' }}>{log.sent_at ? new Date(log.sent_at).toLocaleString() : '—'}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {detailsData.batch?.is_archived && (
                    <div className="py-3">
                      <h4 className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: '#64748B' }}>Archive Information</h4>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8">
                        <div className="flex justify-between gap-3 py-1.5 border-b" style={{ borderColor: '#F1F5F9' }}><span className="text-[11px]" style={{ color: '#64748B' }}>Archived By</span><p className="text-[11px] text-right" style={{ color: '#475569' }}>{detailsData.batch?.archived_by_username || '—'}</p></div>
                        <div className="flex justify-between gap-3 py-1.5 border-b" style={{ borderColor: '#F1F5F9' }}><span className="text-[11px]" style={{ color: '#64748B' }}>Archived At</span><p className="text-[11px] text-right" style={{ color: '#475569' }}>{detailsData.batch?.archived_at ? new Date(detailsData.batch.archived_at).toLocaleString() : '—'}</p></div>
                        {detailsData.batch?.archive_reason && (
                          <div className="sm:col-span-2 flex justify-between gap-3 py-1.5"><span className="text-[11px] shrink-0" style={{ color: '#64748B' }}>Reason</span><p className="text-[11px] text-right" style={{ color: '#475569' }}>{detailsData.batch.archive_reason}</p></div>
                        )}
                      </div>
                    </div>
                  )}
                </>
              ) : null}
            </div>
            <div className="px-5 py-3 bg-white border-t border-gray-100 flex justify-end shrink-0">
              <button onClick={() => setShowDetails(false)} className="px-4 py-2 text-xs font-bold rounded-md cursor-pointer border border-gray-300 text-gray-600 bg-white">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
