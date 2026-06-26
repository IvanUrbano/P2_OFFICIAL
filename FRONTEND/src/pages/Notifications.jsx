import { useState, useEffect } from 'react';
import API from '../api/axios';

export default function Notifications() {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAlerts();
  }, []);

  const fetchAlerts = async () => {
    try {
      const res = await API.get('/api/tb/alerts');
      setAlerts(res.data.alerts || []);
    } catch (err) {
      console.error('Failed to fetch alerts:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleDismiss = async (id) => {
    try {
      await API.put(`/api/tb/alerts/${id}/read`);
      setAlerts(prev => prev.filter(a => a.id !== id));
    } catch (err) {
      console.error('Failed to dismiss alert:', err);
    }
  };

  const getAlertType = (severity) => {
    if (severity === 'High') return 'danger';
    if (severity === 'Medium') return 'warning';
    return 'info';
  };

  const colorMap = { danger: '#EF4444', warning: '#D97706', info: '#2E6FAF' };
  const bgMap = { danger: 'rgba(239,68,68,0.06)', warning: 'rgba(217,119,6,0.05)', info: 'rgba(46,111,175,0.05)' };
  const borderMap = { danger: 'rgba(239,68,68,0.15)', warning: 'rgba(217,119,6,0.15)', info: 'rgba(46,111,175,0.12)' };
  const iconMap = { danger: 'ri-alarm-warning-line', warning: 'ri-error-warning-line', info: 'ri-refresh-line' };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <i className="ri-loader-4-line animate-spin text-3xl" style={{ color: '#2E6FAF' }} />
          <p className="mt-2 text-sm" style={{ color: '#64748b' }}>Loading alerts...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        {alerts.length === 0 ? (
          <div className="text-center py-12 glass-card">
            <i className="ri-check-double-line text-4xl" style={{ color: '#10B981' }} />
            <p className="mt-3 text-sm font-bold" style={{ color: '#64748b' }}>All caught up!</p>
            <p className="text-xs" style={{ color: '#94A3B8' }}>No active alerts at this time.</p>
          </div>
        ) : (
          alerts.map(a => {
            const type = getAlertType(a.severity);
            return (
              <div key={a.id} className="flex gap-4 items-start rounded-xl p-4"
                style={{ background: bgMap[type], border: `1px solid ${borderMap[type]}` }}>
                <i className={`${iconMap[type]} text-2xl mt-0.5 shrink-0`} style={{ color: colorMap[type] }} />
                <div className="flex-1">
                  <div className="text-sm font-bold mb-1" style={{ color: '#1e293b' }}>
                    {a.barangay_name} — {a.alert_type}
                  </div>
                  <div className="text-xs" style={{ color: '#475569' }}>{a.message}</div>
                  {a.recommendation && (
                    <div className="text-xs mt-1" style={{ color: '#475569' }}>
                      <strong>Recommendation:</strong> {a.recommendation}
                    </div>
                  )}
                  <div className="text-[11px] mt-1.5" style={{ color: '#94a3b8' }}>
                    {a.created_at ? new Date(a.created_at).toLocaleString() : 'N/A'}
                  </div>
                </div>
                <button
                  onClick={() => handleDismiss(a.id)}
                  className="text-xs px-3 py-1 rounded-lg hover:opacity-80 transition"
                  style={{ color: colorMap[type], border: `1px solid ${borderMap[type]}` }}
                >
                  Dismiss
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
