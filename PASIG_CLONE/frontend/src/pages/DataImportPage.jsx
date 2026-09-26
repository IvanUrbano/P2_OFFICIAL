import { useState, useRef, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import API from '../api/axios';
import { useTheme } from '../theme';
import EmptyState from '../components/EmptyState';
import StatusBadge from '../components/StatusBadge';

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

export default function DataImportPage() {
  const { t } = useTheme();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const fileRef = useRef(null);
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [duplicateInfo, setDuplicateInfo] = useState(null);

  const [mainTab, setMainTab] = useState(searchParams.get('tab') === 'history' ? 'history' : 'import');
  const [historyTab, setHistoryTab] = useState('active');
  const [historySearch, setHistorySearch] = useState('');
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [showArchive, setShowArchive] = useState(null);
  const [archiveReason, setArchiveReason] = useState('');
  const [archiving, setArchiving] = useState(false);

  const [showDetails, setShowDetails] = useState(null);
  const [detailsData, setDetailsData] = useState(null);
  const [detailsLoading, setDetailsLoading] = useState(false);

  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab === 'history') setMainTab('history');
  }, [searchParams]);

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

  const handleFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const ext = f.name.split('.').pop().toLowerCase();
    if (!['xlsx', 'xls', 'csv'].includes(ext)) {
      setFile(null);
      setError('Unsupported file type. Choose an .xlsx, .xls or .csv file.');
      return;
    }
    setFile(f); setError(''); setResult(null); setDuplicateInfo(null);
  };

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    setError('');
    setDuplicateInfo(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await API.post('/api/data/import', formData);
      setResult(res.data);
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
    } catch (err) {
      console.error(err);
    } finally {
      setArchiving(false);
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
    return b.filename?.toLowerCase().includes(q) || b.id?.toLowerCase().includes(q) || b.importedBy?.toLowerCase().includes(q);
  });

  return (
    <div className="space-y-6">
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
            <div className="flex items-center gap-2 text-sm font-bold mb-1" style={{ color: '#0F2D52' }}>
              <i className="ri-upload-cloud-2-line text-lg" style={{ color: '#2E6FAF' }} />
              <span>Upload Tuberculosis Records File</span>
            </div>
            <p className="text-xs text-gray-500 leading-relaxed mb-4">
              Upload an Excel registry file (.xlsx with DSTB and MN sheets) or a CSV export of one sheet. Rows are cleaned and validated before sync.
            </p>

            <label
              className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-10 text-center cursor-pointer transition hover:opacity-80"
              style={{ borderColor: file ? '#10B981' : 'rgba(46,111,175,0.35)', background: file ? 'rgba(16,185,129,0.04)' : 'rgba(46,111,175,0.04)' }}
            >
              <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="sr-only" onChange={handleFile} />
              <i className={file ? (file.name.toLowerCase().endsWith('.csv') ? 'ri-file-text-line text-3xl' : 'ri-file-excel-2-line text-3xl') : 'ri-file-upload-line text-3xl'} style={{ color: file ? '#10B981' : '#2E6FAF' }} />
              {file ? (
                <>
                  <span className="text-sm font-bold" style={{ color: '#0F2D52' }}>{file.name}</span>
                  <span className="text-[11px]" style={{ color: '#64748B' }}>
                    {(file.size / 1024).toFixed(1)} KB — click to change file
                  </span>
                </>
              ) : (
                <>
                  <span className="text-sm font-bold" style={{ color: '#0F2D52' }}>Click or drag file to choose</span>
                  <span className="text-[11px]" style={{ color: '#64748B' }}>Excel (.xlsx, .xls) or CSV (.csv)</span>
                </>
              )}
            </label>

            {error && (
              <div className="mt-4 px-3.5 py-2.5 rounded-lg text-xs flex items-center gap-2" style={{ background: '#FEF2F2', color: '#991B1B', border: '1px solid #FCA5A5' }}>
                <i className="ri-error-warning-line text-sm shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {duplicateInfo && (
              <div className="mt-4 px-4 py-3 rounded-lg text-xs" style={{ background: '#FFF7ED', color: '#9A3412', border: '1px solid #FDBA74' }}>
                <div className="flex items-center gap-2 mb-2">
                  <i className="ri-file-shield-line text-sm shrink-0" />
                  <span className="font-bold text-sm">File Already Imported</span>
                </div>
                <p className="mb-2">This file appears to have already been processed.</p>
                {duplicateInfo.previousImport && (
                  <div className="grid grid-cols-2 gap-2 mt-2 p-2 rounded" style={{ background: 'rgba(255,255,255,0.6)' }}>
                    <div><span className="font-semibold">Batch:</span> {duplicateInfo.previousImport.batchId?.slice(0, 8)}</div>
                    <div><span className="font-semibold">File:</span> {duplicateInfo.previousImport.filename}</div>
                    <div><span className="font-semibold">Imported By:</span> {duplicateInfo.previousImport.importedBy || 'Unknown'}</div>
                    <div><span className="font-semibold">Date:</span> {duplicateInfo.previousImport.importedAt ? new Date(duplicateInfo.previousImport.importedAt).toLocaleDateString() : '—'}</div>
                    <div><span className="font-semibold">Status:</span> {duplicateInfo.previousImport.syncStatus || '—'}</div>
                  </div>
                )}
                <button onClick={() => setDuplicateInfo(null)} className="mt-2 px-3 py-1 text-[11px] font-bold rounded cursor-pointer" style={{ background: '#9A3412', color: '#fff' }}>
                  Upload Different File
                </button>
              </div>
            )}

            {file && (
              <div className="mt-4 flex justify-end">
                <button
                  onClick={handleUpload}
                  disabled={uploading}
                  className="inline-flex items-center justify-center gap-2 px-5 py-2.5 text-xs font-bold rounded-lg disabled:opacity-40 transition-colors cursor-pointer"
                  style={{ background: '#0F2D52', color: '#ffffff', border: '1px solid #0F2D52' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#174A7E'}
                  onMouseLeave={e => e.currentTarget.style.background = '#0F2D52'}
                >
                  {uploading ? (<><i className="ri-loader-4-line animate-spin" /> Uploading...</>) : 'Upload & Import'}
                </button>
              </div>
            )}
          </div>

          {result && (
            <div className="rounded-xl p-6" style={{ background: '#ffffff', border: '1px solid #E2E8F0', boxShadow: '0 4px 16px rgba(15,23,42,0.04)' }}>
              <div className="flex items-center gap-2 mb-4 pb-3" style={{ borderBottom: '1px solid #F1F5F9' }}>
                <i className="ri-checkbox-circle-line text-lg" style={{ color: '#10B981' }} />
                <h3 className="text-sm font-bold" style={{ color: '#0F2D52' }}>Import Complete</h3>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: 'Batch ID', value: result.batch?.id?.slice(0, 8) || '—' },
                  { label: 'Total Records', value: result.batch?.totalRows || 0 },
                  { label: 'DSTB', value: result.batch?.dstbCount || 0 },
                  { label: 'MN', value: result.batch?.mnCount || 0 },
                ].map((item) => (
                  <div key={item.label} className="p-3.5 rounded-lg" style={{ background: '#F8FAFC', border: '1px solid #F1F5F9' }}>
                    <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#64748B' }}>{item.label}</p>
                    <p className="text-base font-extrabold mt-1" style={{ color: '#0F2D52' }}>{item.value}</p>
                  </div>
                ))}
              </div>
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
              <button onClick={() => navigate(`/validation?batchId=${result.batch?.id}`)} className="mt-4 px-4 py-2 text-xs font-bold rounded-lg transition-colors cursor-pointer" style={{ background: '#10B981', color: '#ffffff' }}>
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
              <table className="w-full">
                <thead>
                  <tr style={{ background: '#FAFCFF', borderBottom: '1px solid #E2E8F0' }}>
                    {['Batch ID', 'File Name', 'Imported By', 'Records', 'Accepted', 'Rejected', 'Sync Status', 'Date', 'Actions'].map((h) => (
                      <th key={h} className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-wider" style={{ color: '#0F2D52' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredHistory.map((b) => (
                    <tr key={b.id} className="hover:bg-blue-50/40 transition-colors" style={{ borderBottom: '1px solid #F1F5F9' }}>
                      <td className="px-4 py-3 text-xs font-bold font-mono" style={{ color: '#0F2D52' }}>{b.id?.slice(0, 8) || '—'}</td>
                      <td className="px-4 py-3 text-xs font-bold" style={{ color: '#0F2D52' }}>{b.filename || '—'}</td>
                      <td className="px-4 py-3 text-xs" style={{ color: '#475569' }}>{b.importedBy || '—'}</td>
                      <td className="px-4 py-3 text-xs font-semibold" style={{ color: '#475569' }}>{b.records ?? '—'}</td>
                      <td className="px-4 py-3 text-xs font-semibold" style={{ color: '#10B981' }}>{b.validated ?? '—'}</td>
                      <td className="px-4 py-3 text-xs font-semibold" style={{ color: b.rejected > 0 ? '#EF4444' : '#475569' }}>{b.rejected ?? '—'}</td>
                      <td className="px-4 py-3"><StatusBadge status={b.syncStatus || b.status} /></td>
                      <td className="px-4 py-3 text-xs" style={{ color: '#64748B' }}>{b.importedAt ? new Date(b.importedAt).toLocaleDateString() : '—'}</td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1">
                          <button onClick={() => openDetails(b.id)} className="px-2 py-1 text-[10px] font-semibold rounded cursor-pointer" style={{ color: '#2E6FAF' }}>View</button>
                          {!b.isArchived && b.status === 'validated' && b.syncStatus !== 'synced' && (
                            <button onClick={() => navigate(`/sync?batchId=${b.id}`)} className="px-2 py-1 text-[10px] font-semibold rounded cursor-pointer" style={{ color: '#10B981' }}>Sync</button>
                          )}
                          {!b.isArchived && (b.status === 'validated' || b.syncStatus === 'synced') && (
                            <button onClick={() => setShowArchive(b)} className="px-2 py-1 text-[10px] font-semibold rounded cursor-pointer" style={{ color: '#D97706' }}>Archive</button>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[2px]" onClick={() => { setShowArchive(null); setArchiveReason(''); }}>
          <div className="bg-white border border-gray-200 shadow-xl w-full max-w-[420px] mx-4 overflow-hidden" style={{ borderRadius: '5px' }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100" style={{ background: '#FAFCFF' }}>
              <div className="flex items-center gap-2">
                <i className="ri-archive-line text-lg" style={{ color: '#D97706' }} />
                <h3 className="text-sm font-bold" style={{ color: '#0F2D52' }}>Archive Import Batch?</h3>
              </div>
              <button onClick={() => { setShowArchive(null); setArchiveReason(''); }} className="text-gray-400 hover:text-gray-600 transition-colors p-1 rounded cursor-pointer">
                <i className="ri-close-line text-lg" />
              </button>
            </div>
            <div className="p-5 space-y-3">
              <div className="grid grid-cols-2 gap-2 p-3 rounded-lg" style={{ background: '#F8FAFC', border: '1px solid #F1F5F9' }}>
                <div><span className="text-[10px] font-bold uppercase" style={{ color: '#64748B' }}>Batch</span><p className="text-xs font-mono font-bold" style={{ color: '#0F2D52' }}>{showArchive.id?.slice(0, 8)}</p></div>
                <div><span className="text-[10px] font-bold uppercase" style={{ color: '#64748B' }}>File</span><p className="text-xs font-bold" style={{ color: '#0F2D52' }}>{showArchive.filename}</p></div>
              </div>
              <p className="text-xs leading-relaxed" style={{ color: '#475569' }}>
                This batch will be removed from the active import list while preserving its import information, associated records, synchronization history, and audit trail.
              </p>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider block mb-1" style={{ color: '#64748B' }}>Reason for Archiving</label>
                <textarea
                  value={archiveReason}
                  onChange={(e) => setArchiveReason(e.target.value)}
                  placeholder="Enter reason..."
                  rows={3}
                  className="w-full px-3 py-2 text-xs rounded-lg outline-none resize-none"
                  style={{ background: '#ffffff', border: '1px solid #E2E8F0', color: '#0F2D52' }}
                />
              </div>
            </div>
            <div className="px-5 py-3.5 bg-gray-50 border-t border-gray-100 flex justify-end gap-2">
              <button onClick={() => { setShowArchive(null); setArchiveReason(''); }} className="px-4 py-2 text-xs font-bold rounded-md cursor-pointer border border-gray-300 text-gray-600 bg-white">Cancel</button>
              <button onClick={handleArchive} disabled={archiving} className="px-4 py-2 text-xs font-bold text-white rounded-md cursor-pointer disabled:opacity-50" style={{ background: '#D97706' }}>{archiving ? 'Archiving...' : 'Archive Batch'}</button>
            </div>
          </div>
        </div>
      )}

      {showDetails && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[2px]" onClick={() => setShowDetails(false)}>
          <div className="bg-white border border-gray-200 shadow-xl w-full max-w-[560px] mx-4 overflow-hidden max-h-[80vh] flex flex-col" style={{ borderRadius: '5px' }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0" style={{ background: '#FAFCFF' }}>
              <div className="flex items-center gap-2">
                <i className="ri-file-list-3-line text-lg" style={{ color: '#0F2D52' }} />
                <h3 className="text-sm font-bold" style={{ color: '#0F2D52' }}>Import Details</h3>
              </div>
              <button onClick={() => setShowDetails(false)} className="text-gray-400 hover:text-gray-600 transition-colors p-1 rounded cursor-pointer">
                <i className="ri-close-line text-lg" />
              </button>
            </div>
            <div className="p-5 overflow-y-auto space-y-4">
              {detailsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <i className="ri-loader-4-line animate-spin text-lg" style={{ color: '#94A3B8' }} />
                </div>
              ) : detailsData ? (
                <>
                  <div>
                    <h4 className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: '#64748B' }}>Import Information</h4>
                    <div className="grid grid-cols-2 gap-2 p-3 rounded-lg" style={{ background: '#F8FAFC', border: '1px solid #F1F5F9' }}>
                      <div><span className="text-[10px] font-semibold" style={{ color: '#94A3B8' }}>Batch ID</span><p className="text-xs font-mono font-bold" style={{ color: '#0F2D52' }}>{detailsData.batch?.id?.slice(0, 8) || '—'}</p></div>
                      <div><span className="text-[10px] font-semibold" style={{ color: '#94A3B8' }}>File Name</span><p className="text-xs font-bold" style={{ color: '#0F2D52' }}>{detailsData.batch?.filename || '—'}</p></div>
                      <div><span className="text-[10px] font-semibold" style={{ color: '#94A3B8' }}>Imported By</span><p className="text-xs" style={{ color: '#475569' }}>{detailsData.batch?.imported_by_username || '—'}</p></div>
                      <div><span className="text-[10px] font-semibold" style={{ color: '#94A3B8' }}>Import Date</span><p className="text-xs" style={{ color: '#475569' }}>{detailsData.batch?.created_at ? new Date(detailsData.batch.created_at).toLocaleString() : '—'}</p></div>
                      <div><span className="text-[10px] font-semibold" style={{ color: '#94A3B8' }}>Total Records</span><p className="text-xs font-bold" style={{ color: '#0F2D52' }}>{detailsData.batch?.total_rows ?? '—'}</p></div>
                      <div><span className="text-[10px] font-semibold" style={{ color: '#94A3B8' }}>Status</span><p className="text-xs"><StatusBadge status={detailsData.batch?.status} /></p></div>
                    </div>
                  </div>

                  <div>
                    <h4 className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: '#64748B' }}>Validation Summary</h4>
                    <div className="grid grid-cols-3 gap-2 p-3 rounded-lg" style={{ background: '#F8FAFC', border: '1px solid #F1F5F9' }}>
                      <div className="text-center"><p className="text-[10px] font-semibold" style={{ color: '#94A3B8' }}>Accepted</p><p className="text-sm font-extrabold" style={{ color: '#10B981' }}>{detailsData.batch?.valid_count ?? '—'}</p></div>
                      <div className="text-center"><p className="text-[10px] font-semibold" style={{ color: '#94A3B8' }}>Rejected</p><p className="text-sm font-extrabold" style={{ color: '#EF4444' }}>{detailsData.batch?.error_count ?? '—'}</p></div>
                      <div className="text-center"><p className="text-[10px] font-semibold" style={{ color: '#94A3B8' }}>Sync Status</p><p className="text-xs mt-1"><StatusBadge status={detailsData.batch?.sync_status} /></p></div>
                    </div>
                  </div>

                  {detailsData.syncLogs?.length > 0 && (
                    <div>
                      <h4 className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: '#64748B' }}>Synchronization History</h4>
                      <div className="space-y-1.5">
                        {detailsData.syncLogs.map((log, i) => (
                          <div key={i} className="flex items-center justify-between p-2.5 rounded-lg text-xs" style={{ background: '#F8FAFC', border: '1px solid #F1F5F9' }}>
                            <div className="flex items-center gap-2">
                              <span className={`w-2 h-2 rounded-full ${log.status === 'sent' ? 'bg-emerald-500' : 'bg-red-500'}`} />
                              <span className="font-semibold" style={{ color: '#0F2D52' }}>{log.username || 'System'}</span>
                            </div>
                            <span style={{ color: '#64748B' }}>{log.sent_at ? new Date(log.sent_at).toLocaleString() : '—'}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {detailsData.batch?.is_archived && (
                    <div>
                      <h4 className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: '#64748B' }}>Archive Information</h4>
                      <div className="grid grid-cols-2 gap-2 p-3 rounded-lg" style={{ background: '#FFF7ED', border: '1px solid #FDBA74' }}>
                        <div><span className="text-[10px] font-semibold" style={{ color: '#9A3412' }}>Archived By</span><p className="text-xs" style={{ color: '#9A3412' }}>{detailsData.batch?.archived_by_username || '—'}</p></div>
                        <div><span className="text-[10px] font-semibold" style={{ color: '#9A3412' }}>Archived At</span><p className="text-xs" style={{ color: '#9A3412' }}>{detailsData.batch?.archived_at ? new Date(detailsData.batch.archived_at).toLocaleString() : '—'}</p></div>
                        {detailsData.batch?.archive_reason && (
                          <div className="col-span-2"><span className="text-[10px] font-semibold" style={{ color: '#9A3412' }}>Reason</span><p className="text-xs" style={{ color: '#9A3412' }}>{detailsData.batch.archive_reason}</p></div>
                        )}
                      </div>
                    </div>
                  )}
                </>
              ) : null}
            </div>
            <div className="px-5 py-3.5 bg-gray-50 border-t border-gray-100 flex justify-end shrink-0">
              <button onClick={() => setShowDetails(false)} className="px-4 py-2 text-xs font-bold rounded-md cursor-pointer border border-gray-300 text-gray-600 bg-white">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
