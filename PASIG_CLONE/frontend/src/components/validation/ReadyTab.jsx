import { useNavigate } from 'react-router-dom';
import { fmtDate, th, thStyle, td } from './shared';
import { primaryBtn } from '../SidePanel';

/**
 * Ready — per-batch readiness with the way forward to synchronization.
 */
export default function ReadyTab({ batch, batches, canSync = false }) {
  const navigate = useNavigate();

  const shownBatches = (batches || []).filter(b => b.status !== 'uploaded' && (!batch || b.id === batch));

  return (
    <div>
      {shownBatches.length > 0 && (
        <div className="px-5 pt-4">
          <div className="overflow-hidden rounded-lg" style={{ border: '1px solid #0F2D52', background: '#F8FAFC' }}>
            <p className="text-[11px] font-bold uppercase tracking-wide px-4 py-2.5" style={{ color: '#FFFFFF', background: '#0F2D52' }}>Batch readiness</p>
            <div className="flex items-start gap-2.5 px-4 py-3" style={{ background: '#EEF4FA', borderBottom: '1px solid #D7E2EF' }}>
              <i className="ri-refresh-line mt-0.5 text-sm" aria-hidden="true" style={{ color: '#0F2D52' }} />
              <p className="text-[11px] leading-relaxed" style={{ color: '#475569' }}>
                <span className="font-semibold" style={{ color: '#0F2D52' }}>Why re-sync?</span>{' '}
                Records can change after an initial sync. Re-sync sends the latest validated batch data to TBInsight.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr>{['Batch', 'Ready', 'Open items', 'Sync status', ''].map(h => <th key={h} className={th} style={{ ...thStyle, color: '#0F2D52', background: '#EAF0F6', borderBottom: '1px solid #D7E2EF' }}>{h}</th>)}</tr>
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
                            b.counts.facilityNames && `${b.counts.facilityNames} facility name${b.counts.facilityNames === 1 ? '' : 's'}`,
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
          </div>
          <p className="text-[10px] mt-1.5" style={{ color: '#94A3B8' }}>
            Syncing needs every possible match in the batch decided. Rows with data issues and records without a Pasig barangay are not sent; an unmapped facility name does not hold a record back.
          </p>
        </div>
      )}

    </div>
  );
}
