import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import API from '../api/axios';
import { useTheme } from '../theme';
import EmptyState from '../components/EmptyState';

const cardStyle = (t) => ({
  background: t.cardSolid,
  border: `1px solid ${t.border}`,
  borderRadius: '12px',
  boxShadow: '0 4px 16px rgba(15,23,42,0.04)',
});

export default function DataImportPage() {
  const { t } = useTheme();
  const navigate = useNavigate();
  const fileRef = useRef(null);
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [duplicateInfo, setDuplicateInfo] = useState(null);

  const handleFile = (e) => {
    const f = e.target.files?.[0];
    if (f) { setFile(f); setError(''); setResult(null); setDuplicateInfo(null); }
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

  return (
    <div className="space-y-6">
      {/* Card Header */}
      <div className="rounded-xl overflow-hidden" style={{ background: '#ffffff', boxShadow: '0 2px 16px rgba(15,45,82,0.07), 0 1px 3px rgba(15,45,82,0.04)', border: '1px solid #E2E8F0' }}>
        <div className="px-6 py-4" style={{ borderBottom: '1px solid #DBEAFE' }}>
          <h1 className="text-lg font-extrabold tracking-tight" style={{ color: '#0F2D52' }}>Data Import</h1>
          <p className="text-xs mt-0.5" style={{ color: '#94A3B8' }}>Import tuberculosis records from external files.</p>
        </div>
      </div>

      <div className="rounded-xl p-6" style={{ background: '#ffffff', border: '1px solid #E2E8F0', boxShadow: '0 4px 16px rgba(15,23,42,0.04)' }}>
        <div className="flex items-center gap-2 text-sm font-bold mb-1" style={{ color: '#0F2D52' }}>
          <i className="ri-upload-cloud-2-line text-lg" style={{ color: '#2E6FAF' }} />
          <span>Upload Tuberculosis Records File</span>
        </div>
        <p className="text-xs text-gray-500 leading-relaxed mb-4">
          Upload an Excel registry file (.xlsx) containing TB patient records. Rows will be processed for validation before sync.
        </p>

        <label
          className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-10 text-center cursor-pointer transition hover:opacity-80"
          style={{ borderColor: file ? '#10B981' : 'rgba(46,111,175,0.35)', background: file ? 'rgba(16,185,129,0.04)' : 'rgba(46,111,175,0.04)' }}
        >
          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="sr-only" onChange={handleFile} />
          <i className={file ? 'ri-file-excel-2-line text-3xl' : 'ri-file-upload-line text-3xl'} style={{ color: file ? '#10B981' : '#2E6FAF' }} />
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
              <span className="text-[11px]" style={{ color: '#64748B' }}>Excel format (.xlsx, .xls)</span>
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
          <button onClick={() => navigate(`/validation?batchId=${result.batch?.id}`)} className="mt-4 px-4 py-2 text-xs font-bold rounded-lg transition-colors cursor-pointer" style={{ background: '#10B981', color: '#ffffff' }}>
            Continue to Validation &rarr;
          </button>
        </div>
      )}
    </div>
  );
}
