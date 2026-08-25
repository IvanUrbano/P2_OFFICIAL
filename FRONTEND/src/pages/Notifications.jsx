import { useState, useEffect } from 'react';
import API from '../api/axios';

/**
 * Notifications page — displays system notifications with light theme styling.
 */
export default function Notifications() {
  const [notifications, setNotifications] = useState([]);

  useEffect(() => {
    const fetchNotifications = async () => {
      try {
        const res = await API.get('/api/tb/alerts');
        setNotifications(res.data.alerts || []);
      } catch (err) {
        console.error('Failed to fetch notifications:', err);
      }
    };
    fetchNotifications();
  }, []);

  const handleDismiss = async (id) => {
    try {
      await API.put(`/api/tb/alerts/${id}/read`);
      setNotifications(prev => prev.filter(n => n.id !== id));
    } catch (err) {
      console.error('Failed to dismiss notification:', err);
    }
  };

  const getSeverity = (severity) => {
    if (severity === 'High') return { label: 'High', color: '#EF4444', textBg: '#FEE2E2', textColor: '#EF4444', dotColor: '#EF4444' };
    if (severity === 'Medium') return { label: 'Medium', color: '#D97706', textBg: '#FEF3C7', textColor: '#D97706', dotColor: '#D97706' };
    return { label: 'Low', color: '#2E6FAF', textBg: '#DBEAFE', textColor: '#2E6FAF', dotColor: '#2E6FAF' };
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div
        className="rounded-2xl p-6"
        style={{
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          boxShadow: '0 4px 20px rgba(15, 45, 82, 0.06)',
        }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: 'rgba(0,102,255,0.1)' }}
          >
            <i className="ri-notification-3-line text-xl" style={{ color: '#0066FF' }} />
          </div>
          <div>
            <h2 className="text-lg font-bold" style={{ color: '#0F2D52' }}>Notifications</h2>
            <p className="text-xs" style={{ color: '#94A3B8' }}>System notifications and updates.</p>
          </div>
          {notifications.length > 0 && (
            <span
              className="ml-auto inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold"
              style={{ background: 'rgba(0,102,255,0.1)', color: '#0066FF' }}
            >
              {notifications.length} new
            </span>
          )}
        </div>
      </div>

      {/* Notification list */}
      {notifications.length === 0 ? (
        <div
          className="rounded-2xl p-12 text-center"
          style={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            boxShadow: '0 4px 20px rgba(15, 45, 82, 0.06)',
          }}
        >
          <i className="ri-notification-off-line text-5xl" style={{ color: '#CBD5E1' }} />
          <p className="mt-4 text-sm font-bold" style={{ color: '#64748B' }}>No notifications</p>
          <p className="text-xs mt-1" style={{ color: '#94A3B8' }}>You're all caught up!</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {notifications.map(n => {
            const sev = getSeverity(n.severity);
            return (
              <div
                key={n.id}
                className="flex items-center gap-4 rounded-xl p-4"
                style={{ background: '#ffffff', border: '1px solid #e2e8f0', boxShadow: '0 2px 8px rgba(15,45,82,0.04)' }}
              >
                {/* Icon */}
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
                  style={{ background: 'rgba(0,102,255,0.08)' }}
                >
                  <i className="ri-notification-3-line text-base" style={{ color: '#0066FF' }} />
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-sm font-bold" style={{ color: '#0F2D52' }}>{n.alert_type || 'System Notification'}</span>
                    <span
                      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold"
                      style={{ background: sev.textBg, color: sev.textColor }}
                    >
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: sev.dotColor }} />
                      {sev.label}
                    </span>
                  </div>
                  <p className="text-xs" style={{ color: '#64748B' }}>{n.message}</p>
                  {n.recommendation && (
                    <p className="text-xs mt-1" style={{ color: '#64748B' }}>
                      <strong>Recommendation:</strong> {n.recommendation}
                    </p>
                  )}
                  <div className="flex items-center gap-3 mt-1.5 text-[11px]" style={{ color: '#94A3B8' }}>
                    <span className="flex items-center gap-1">
                      <i className="ri-time-line" />
                      {n.created_at ? new Date(n.created_at).toLocaleString() : 'N/A'}
                    </span>
                    <span className="flex items-center gap-1">
                      <i className="ri-map-pin-line" />
                      {n.barangay_name || 'System'}
                    </span>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    className="text-xs px-3 py-1.5 rounded-lg font-bold transition-opacity hover:opacity-80"
                    style={{ color: '#0066FF', border: '1px solid rgba(0,102,255,0.2)', background: 'rgba(0,102,255,0.06)' }}
                  >
                    View Details
                  </button>
                  <button
                    onClick={() => handleDismiss(n.id)}
                    className="text-xs px-3 py-1.5 rounded-lg font-bold transition-opacity hover:opacity-80"
                    style={{ color: '#64748B', border: '1px solid #e2e8f0', background: '#ffffff' }}
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
