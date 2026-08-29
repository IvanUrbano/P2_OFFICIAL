import { useState, useEffect } from 'react';
import API from '../api/axios';

/**
 * Alert page — displays TB alerts with stats bar.
 */
export default function Alert() {
  const [alerts, setAlerts] = useState([]);

  useEffect(() => {
    const fetchAlerts = async () => {
      try {
        const res = await API.get('/api/tb/alerts');
        setAlerts(res.data.alerts || []);
      } catch (err) {
        console.error('Failed to fetch alerts:', err);
      }
    };
    fetchAlerts();
  }, []);

  const handleDismiss = async (id) => {
    try {
      await API.put(`/api/tb/alerts/${id}/read`);
      setAlerts(prev => prev.filter(a => a.id !== id));
    } catch (err) {
      console.error('Failed to dismiss alert:', err);
    }
  };

  const getSeverity = (severity) => {
    if (severity === 'High') return { label: 'High', color: '#EF4444', bg: 'rgba(239,68,68,0.08)', border: 'rgba(239,68,68,0.2)', textBg: '#FEE2E2', textColor: '#EF4444', dotColor: '#EF4444' };
    if (severity === 'Medium') return { label: 'Medium', color: '#D97706', bg: 'rgba(217,119,6,0.06)', border: 'rgba(217,119,6,0.2)', textBg: '#FEF3C7', textColor: '#D97706', dotColor: '#D97706' };
    return { label: 'Low', color: '#2E6FAF', bg: 'rgba(46,111,175,0.06)', border: 'rgba(46,111,175,0.15)', textBg: '#DBEAFE', textColor: '#2E6FAF', dotColor: '#2E6FAF' };
  };

  const highCount = alerts.filter(a => a.severity === 'High').length;
  const mediumCount = alerts.filter(a => a.severity === 'Medium').length;
  const lowCount = alerts.filter(a => a.severity === 'Low').length;

  return (
    <div className="flex flex-col gap-5">
      {/* ── Stats Bar ── */}
      <div
        className="rounded-xl overflow-hidden"
        style={{
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          boxShadow: '0 4px 20px rgba(15, 45, 82, 0.06)',
        }}
      >
        <div className="grid grid-cols-2 sm:grid-cols-4 divide-x" style={{ borderColor: '#f1f5f9' }}>
          {/* Total Alerts */}
          <div className="flex items-center gap-3 px-5 py-4">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: '#F1F5F9' }}>
              <i className="ri-alarm-warning-line text-base" style={{ color: '#0F2D52' }} />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#94A3B8' }}>Total Alerts</p>
              <div className="flex items-baseline gap-1.5">
                <span className="text-xl font-extrabold" style={{ color: '#0F2D52' }}>{alerts.length}</span>
                <span className="text-[10px] font-semibold" style={{ color: '#EF4444' }}>{highCount} critical</span>
              </div>
            </div>
          </div>

          {/* High Severity */}
          <div className="flex items-center gap-3 px-5 py-4">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: 'rgba(239,68,68,0.08)' }}>
              <i className="ri-error-warning-line text-base" style={{ color: '#EF4444' }} />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#94A3B8' }}>High Severity</p>
              <div className="flex items-baseline gap-1.5">
                <span className="text-xl font-extrabold" style={{ color: '#0F2D52' }}>{highCount}</span>
                <span className="text-[10px] font-semibold" style={{ color: '#EF4444' }}>Urgent</span>
              </div>
            </div>
          </div>

          {/* Medium Severity */}
          <div className="flex items-center gap-3 px-5 py-4">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: 'rgba(217,119,6,0.08)' }}>
              <i className="ri-information-line text-base" style={{ color: '#D97706' }} />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#94A3B8' }}>Medium Severity</p>
              <div className="flex items-baseline gap-1.5">
                <span className="text-xl font-extrabold" style={{ color: '#0F2D52' }}>{mediumCount}</span>
                <span className="text-[10px] font-semibold" style={{ color: '#D97706' }}>Warning</span>
              </div>
            </div>
          </div>

          {/* Low Severity */}
          <div className="flex items-center gap-3 px-5 py-4">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: 'rgba(46,111,175,0.08)' }}>
              <i className="ri-alert-line text-base" style={{ color: '#2E6FAF' }} />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#94A3B8' }}>Low Severity</p>
              <div className="flex items-baseline gap-1.5">
                <span className="text-xl font-extrabold" style={{ color: '#0F2D52' }}>{lowCount}</span>
                <span className="text-[10px] font-semibold" style={{ color: '#2E6FAF' }}>Info</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Alerts List ── */}
      <div className="flex flex-col gap-3">
        {alerts.length === 0 ? (
          <div
            className="rounded-xl p-12 text-center"
            style={{
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              boxShadow: '0 4px 20px rgba(15, 45, 82, 0.06)',
            }}
          >
            <i className="ri-check-double-line text-5xl" style={{ color: '#10B981' }} />
            <p className="mt-4 text-sm font-bold" style={{ color: '#64748B' }}>All caught up!</p>
            <p className="text-xs mt-1" style={{ color: '#94A3B8' }}>No active alerts at this time.</p>
          </div>
        ) : (
          alerts.map(a => {
            const sev = getSeverity(a.severity);
            return (
              <div
                key={a.id}
                className="flex items-center gap-4 rounded-xl p-4"
                style={{ background: sev.bg, border: `1px solid ${sev.border}` }}
              >
                {/* Icon */}
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
                  style={{ background: sev.textBg }}
                >
                  <i className="ri-map-pin-2-fill text-base" style={{ color: sev.color }} />
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-sm font-bold" style={{ color: '#0F2D52' }}>{a.alert_type || 'High-Risk Hotspot Detected'}</span>
                    <span
                      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold"
                      style={{ background: sev.textBg, color: sev.textColor }}
                    >
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: sev.dotColor }} />
                      {sev.label}
                    </span>
                  </div>
                  <p className="text-xs" style={{ color: '#64748B' }}>{a.message}</p>
                  <div className="flex items-center gap-3 mt-1.5 text-[11px]" style={{ color: '#94A3B8' }}>
                    <span className="flex items-center gap-1">
                      <i className="ri-time-line" />
                      {a.created_at ? new Date(a.created_at).toLocaleString() : 'N/A'}
                    </span>
                    <span className="flex items-center gap-1">
                      <i className="ri-map-pin-line" />
                      {a.barangay_name || 'Unknown'}
                    </span>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    className="text-xs font-semibold px-3 py-1.5"
                    style={{ background: '#0F2D52', color: '#ffffff', border: '1px solid #0F2D52', borderRadius: 4, transition: 'background 0.15s, color 0.15s, border-color 0.15s, opacity 0.15s' }}
                    onMouseEnter={e => { e.currentTarget.style.background = '#174A7E'; e.currentTarget.style.borderColor = '#174A7E'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = '#0F2D52'; e.currentTarget.style.borderColor = '#0F2D52'; }}
                  >
                    View Details
                  </button>
                  <button
                    onClick={() => handleDismiss(a.id)}
                    className="text-xs font-medium px-3 py-1.5"
                    style={{ background: '#F3F4F6', color: '#374151', border: '1px solid #D1D5DB', borderRadius: 4, transition: 'background 0.15s, color 0.15s, border-color 0.15s, opacity 0.15s' }}
                    onMouseEnter={e => { e.currentTarget.style.background = '#E5E7EB'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = '#F3F4F6'; }}
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
