import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import API from '../../api/axios';
import EmptyState from '../EmptyState';
import { fmtDate, fullName, Pager, th, thStyle, td } from './shared';
import { primaryBtn } from '../SidePanel';

/**
 * Ready — records with no unresolved issue, plus a per-batch readiness list with the
 * way forward to synchronization.
 */
export default function ReadyTab({ batch, batches, refreshKey, canSync = false }) {
  const navigate = useNavigate();
  const [data, setData] = useState({ records: [], pagination: null });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ page });
      if (batch) params.set('batch', batch);
      const res = await API.get(`/api/data/validation-queue/ready?${params}`);
      setData(res.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load ready records.');
    } finally {
      setLoading(false);
    }
  }, [batch, page]);

  useEffect(() => { load(); }, [load, refreshKey]);
  useEffect(() => { setPage(1); }, [batch]);

  const shownBatches = (batches || []).filter(b => b.status !== 'uploaded' && (!batch || b.id === batch));

  return (
    <div>
      {shownBatches.length > 0 && (
        <div className="px-5 pt-4">
          <p className="text-[11px] font-bold uppercase tracking-wide mb-2" style={{ color: '#64748B' }}>Batch readiness</p>
          <div className="overflow-x-auto rounded-lg" style={{ border: '1px solid #E2E8F0' }}>
            <table className="w-full">
              <thead>
                <tr>{['Batch', 'Ready', 'Open items', 'Sync status', ''].map(h => <th key={h} className={th} style={thStyle}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {shownBatches.map(b => {
                  const blocked = b.counts.matches > 0;
                  return (
                    <tr key={b.id} style={{ borderBottom: '1px solid #F1F5F9' }}>
                      <td className={td} style={{ color: '#0F2D52' }}>
                        <span className="font-semibold">{b.filename}</span>
                        <span className="block text-[10px]" style={{ color: '#94A3B8' }}>{fmtDate(b.created_at)}</span>
                      </td>
                      <td className={td} style={{ color: '#047857' }}>{b.counts.ready.toLocaleString()}</td>
                      <td className={td} style={{ color: b.open_items ? '#B45309' : '#94A3B8' }}>
                        {b.open_items === 0 ? 'None' : [
                          b.counts.matches && `${b.counts.matches} match${b.counts.matches === 1 ? '' : 'es'}`,
                          b.counts.assignment && `${b.counts.assignment} assignment`,
                          b.counts.issues && `${b.counts.issues} data issue${b.counts.issues === 1 ? '' : 's'}`,
                        ].filter(Boolean).join(' · ')}
                      </td>
                      <td className={td} style={{ color: '#475569' }}>{b.sync_status || 'not synced'}</td>
                      <td className={`${td} text-right whitespace-nowrap`}>
                        {canSync ? (
                          <button
                            onClick={() => navigate(`/sync?batchId=${b.id}`)}
                            disabled={blocked}
                            title={blocked ? 'Resolve the possible matches in this batch first' : ''}
                            className="px-3 py-1.5 text-[11px] font-semibold disabled:opacity-40"
                            style={primaryBtn}
                          >
                            {b.sync_status === 'synced' ? 'Re-sync' : 'Sync'}
                          </button>
                        ) : (
                          <span className="text-[10px]" style={{ color: '#94A3B8' }} title="An administrator syncs batches to TBInsight.">Sync: admin</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-[10px] mt-1.5" style={{ color: '#94A3B8' }}>
            Syncing needs every possible match in the batch decided. Rows with data issues and records without a Pasig barangay are not sent; an unmapped facility name does not hold a record back.
          </p>
        </div>
      )}

      <div className="mt-4">
        {loading ? (
          <p className="text-xs text-center py-10" style={{ color: '#94A3B8' }}>Loading…</p>
        ) : error ? (
          <p className="text-xs text-center py-10" style={{ color: '#991B1B' }}>{error}</p>
        ) : data.records.length === 0 ? (
          <EmptyState icon="ri-checkbox-circle-line" title="No Ready Records Yet" description="Records appear here once their matches, assignments and data issues are resolved." />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr>{['Case ID', 'Patient #', 'Name', 'Barangay', 'Diagnosed', 'Treatment facility', 'Destination'].map(h => <th key={h} className={th} style={thStyle}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {data.records.map(r => (
                    <tr key={r.id} style={{ borderBottom: '1px solid #F1F5F9' }}>
                      <td className={`${td} font-mono`} style={{ color: '#0F2D52' }}>{r.case_no || '—'}</td>
                      <td className={`${td} font-mono`} style={{ color: '#475569' }}>{r.patient_no || '—'}</td>
                      <td className={td} style={{ color: '#0F2D52' }}>{fullName(r)}</td>
                      <td className={td} style={{ color: '#475569' }}>{r.barangay_name || '—'}</td>
                      <td className={`${td} whitespace-nowrap`} style={{ color: '#475569' }}>{fmtDate(r.date_of_diagnosis)}</td>
                      <td className={td} style={{ color: '#475569' }}>
                        {r.treatment_facility_registry || r.treatment_facility || '—'}
                        {r.treatment_facility_registry && r.treatment_facility && r.treatment_facility_registry !== r.treatment_facility && (
                          <span className="block text-[10px]" style={{ color: '#94A3B8' }}>{r.treatment_facility}</span>
                        )}
                      </td>
                      <td className={td}>
                        {r.sends_to_tbinsight
                          ? <span className="text-[11px]" style={{ color: '#047857' }}>TBInsight</span>
                          : <span className="text-[11px]" style={{ color: '#64748B' }} title="Patient lives outside Pasig">PASIG only</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager pagination={data.pagination} onPage={setPage} />
          </>
        )}
      </div>
    </div>
  );
}
