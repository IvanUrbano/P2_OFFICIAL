import { useState, useMemo } from 'react';
import { useTBData } from '../context/TBDataContext';

/* ─── Icon mapping: context icon names → remixicon classes ─── */
const iconMap = {
    MapPin: 'ri-map-pin-line',
    AlertTriangle: 'ri-error-warning-line',
    TrendingUp: 'ri-arrow-up-circle-line',
    Users: 'ri-team-line',
    RefreshCw: 'ri-refresh-line',
    BarChart2: 'ri-bar-chart-line',
    FileText: 'ri-file-text-line',
};

function getIconClass(icon) {
    return iconMap[icon] || 'ri-alarm-warning-line';
}

/* ─── Format ISO timestamp → readable string ─── */
function formatTimestamp(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    let hours = d.getHours();
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    return `${year}-${month}-${day} ${hours}:${minutes} ${ampm}`;
}

/* ─── Derive notifications from records ─── */
function deriveNotifications(records) {
    const notifications = [];
    let notifId = 1;

    const totalRecords = records.length;
    const barangaySet = new Set(records.map((r) => r.barangay));
    const validatedCount = records.filter((r) => r.validationStatus === 'Validated').length;
    const activeCount = records.filter((r) => r.status === 'Active' || r.status === 'Treatment').length;
    const curedCount = records.filter((r) => r.status === 'Cured').length;
    const completedCount = records.filter((r) => r.status === 'Completed').length;

    // Data Sync notification
    notifications.push({
        id: `notif-${notifId++}`,
        type: 'success',
        title: 'Data Sync Completed',
        desc: `Automatic data synchronization from ${barangaySet.size} barangay health centers completed successfully. ${totalRecords} records updated.`,
        timestamp: new Date().toISOString(),
        icon: 'ri-check-double-line',
    });

    // Records summary
    notifications.push({
        id: `notif-${notifId++}`,
        type: 'success',
        title: 'Records Imported',
        desc: `${totalRecords} TB case records from ${barangaySet.size} health centers imported and validated successfully.`,
        timestamp: new Date(Date.now() - 3600000).toISOString(),
        icon: 'ri-database-2-line',
    });

    // Validation status
    if (validatedCount > 0) {
        notifications.push({
            id: `notif-${notifId++}`,
            type: 'success',
            title: 'Validation Complete',
            desc: `${validatedCount} of ${totalRecords} records have been validated and confirmed.`,
            timestamp: new Date(Date.now() - 7200000).toISOString(),
            icon: 'ri-check-double-line',
        });
    }

    // Active treatment tracking
    if (activeCount > 0) {
        notifications.push({
            id: `notif-${notifId++}`,
            type: 'info',
            title: 'Treatment Tracking Active',
            desc: `${activeCount} patients are currently under active treatment monitoring across ${barangaySet.size} barangays.`,
            timestamp: new Date(Date.now() - 10800000).toISOString(),
            icon: 'ri-heart-pulse-line',
        });
    }

    // Forecast generated
    notifications.push({
        id: `notif-${notifId++}`,
        type: 'info',
        title: 'Forecast Updated',
        desc: `ARIMA forecasting models recalibrated with latest data. ${barangaySet.size} barangay forecasts updated.`,
        timestamp: new Date(Date.now() - 14400000).toISOString(),
        icon: 'ri-brain-line',
    });

    // Success rate
    const successRate = totalRecords > 0
        ? (((curedCount + completedCount) / totalRecords) * 100).toFixed(1)
        : 0;
    notifications.push({
        id: `notif-${notifId++}`,
        type: Number(successRate) >= 60 ? 'success' : 'info',
        title: 'Report Generated',
        desc: `Monthly TB Case Summary report generated. Overall treatment success rate: ${successRate}%.`,
        timestamp: new Date(Date.now() - 18000000).toISOString(),
        icon: 'ri-file-chart-line',
    });

    // Hotspot map
    notifications.push({
        id: `notif-${notifId++}`,
        type: 'info',
        title: 'Hotspot Map Refreshed',
        desc: `GIS hotspot visualization updated with latest case distribution data across ${barangaySet.size} barangays.`,
        timestamp: new Date(Date.now() - 21600000).toISOString(),
        icon: 'ri-map-2-line',
    });

    // Backup
    notifications.push({
        id: `notif-${notifId++}`,
        type: 'success',
        title: 'Backup Completed',
        desc: 'Weekly system backup completed successfully. All patient data secured to cloud storage.',
        timestamp: new Date(Date.now() - 86400000).toISOString(),
        icon: 'ri-cloud-line',
    });

    return notifications;
}

const alertTypeConfig = {
    High: { color: '#EF4444', bg: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.20)', iconBg: 'rgba(239,68,68,0.15)' },
    Medium: { color: '#F59E0B', bg: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.20)', iconBg: 'rgba(245,158,11,0.15)' },
    Low: { color: '#3B82F6', bg: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.20)', iconBg: 'rgba(59,130,246,0.15)' },
};

const notifTypeConfig = {
    success: { color: '#10B981', bg: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.20)', iconBg: 'rgba(16,185,129,0.15)' },
    info: { color: '#3B82F6', bg: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.20)', iconBg: 'rgba(59,130,246,0.15)' },
    warning: { color: '#F59E0B', bg: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.20)', iconBg: 'rgba(245,158,11,0.15)' },
};

function SeverityBadge({ type }) {
    const config = alertTypeConfig[type] || alertTypeConfig.Low;
    return (
        <span
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold whitespace-nowrap"
            style={{ background: `${config.color}1A`, color: config.color }}
        >
            <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: config.color }} />
            {type}
        </span>
    );
}

export default function Alert() {
    const { alerts, records } = useTBData();
    const [activeTab, setActiveTab] = useState('alerts');
    const [selectedItem, setSelectedItem] = useState(null);
    const [dismissed, setDismissed] = useState([]);

    // Derive notifications from records
    const notificationsData = useMemo(() => deriveNotifications(records), [records]);

    // Normalize alerts: map icon names and format timestamps
    const normalizedAlerts = useMemo(() => {
        return alerts.map((a) => ({
            ...a,
            icon: getIconClass(a.icon),
            timestamp: formatTimestamp(a.timestamp),
        }));
    }, [alerts]);

    // Normalize notifications: format timestamps
    const normalizedNotifs = useMemo(() => {
        return notificationsData.map((n) => ({
            ...n,
            timestamp: formatTimestamp(n.timestamp),
        }));
    }, [notificationsData]);

    const highAlerts = normalizedAlerts.filter(a => a.type === 'High').length;
    const medAlerts = normalizedAlerts.filter(a => a.type === 'Medium').length;
    const lowAlerts = normalizedAlerts.filter(a => a.type === 'Low').length;

    const visibleAlerts = normalizedAlerts.filter(a => !dismissed.includes(a.id));
    const visibleNotifs = normalizedNotifs.filter(n => !dismissed.includes(n.id));

    const handleDismiss = (id) => {
        setDismissed(prev => [...prev, id]);
    };

    return (
        <div className="relative space-y-5">

            {/* ── Metric Strip ── */}
            <section
                className="rounded-2xl px-6 py-5 flex items-center"
                style={{
                    background: '#ffffff',
                    border: '1px solid rgba(148,163,184,0.18)',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                }}
            >
                {[
                    { title: 'Total Alerts', value: visibleAlerts.length, icon: 'ri-alarm-warning-line', color: '#0F2D52', tag: `${highAlerts} critical`, tagColor: '#EF4444' },
                    { title: 'High Severity', value: highAlerts, icon: 'ri-error-warning-line', color: '#EF4444', tag: 'Urgent', tagColor: '#EF4444' },
                    { title: 'Medium Severity', value: medAlerts, icon: 'ri-information-line', color: '#F59E0B', tag: 'Warning', tagColor: '#F59E0B' },
                    { title: 'Low Severity', value: lowAlerts, icon: 'ri-alert-line', color: '#3B82F6', tag: 'Info', tagColor: '#3B82F6' },
                    { title: 'Dismissed', value: dismissed.length, icon: 'ri-check-double-line', color: '#10B981', tag: 'Read', tagColor: '#10B981' },
                    { title: 'Notifications', value: visibleNotifs.length, icon: 'ri-notification-3-line', color: '#2E6FAF', tag: 'New', tagColor: '#2E6FAF' },
                ].map((c, i) => (
                    <div key={c.title} className="flex items-center" style={{ flex: '1 1 0' }}>
                        {/* Vertical Divider */}
                        {i > 0 && (
                            <div style={{ width: 2, height: 48, background: 'rgba(3,33,62,0.12)', marginRight: 20, borderRadius: 2 }} />
                        )}
                        {/* Metric Content */}
                        <div className="flex items-center gap-3 min-w-0" style={{ paddingLeft: i === 0 ? 4 : 0 }}>
                            <i className={`${c.icon} text-xl shrink-0`} style={{ color: c.color }} />
                            <div className="min-w-0">
                                <div style={{ fontSize: '.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.1em', color: '#64748b', marginBottom: 2, lineHeight: 1 }}>
                                    {c.title}
                                </div>
                                <div className="flex items-baseline gap-2">
                                    <span style={{ fontSize: '1.5rem', fontWeight: 800, color: '#0f172a', lineHeight: 1.1 }}>{c.value}</span>
                                    <span style={{ fontSize: '.65rem', fontWeight: 700, color: c.tagColor }}>{c.tag}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                ))}
            </section>

            {/* ── Tabs ── */}
            <section className="glass-card p-5">
                <div className="flex items-center gap-2 mb-5">
                    <button
                        onClick={() => setActiveTab('alerts')}
                        className="px-4 py-2 rounded-lg text-xs font-bold transition-all"
                        style={{
                            background: activeTab === 'alerts' ? 'rgba(239,68,68,0.12)' : 'rgba(148,163,184,0.08)',
                            border: activeTab === 'alerts' ? '1px solid rgba(239,68,68,0.3)' : '1px solid rgba(148,163,184,0.2)',
                            color: activeTab === 'alerts' ? '#EF4444' : '#64748B',
                        }}
                    >
                        <i className="ri-alarm-warning-line mr-1" />
                        Alerts ({visibleAlerts.length})
                    </button>
                    <button
                        onClick={() => setActiveTab('notifications')}
                        className="px-4 py-2 rounded-lg text-xs font-bold transition-all"
                        style={{
                            background: activeTab === 'notifications' ? 'rgba(59,130,246,0.12)' : 'rgba(148,163,184,0.08)',
                            border: activeTab === 'notifications' ? '1px solid rgba(59,130,246,0.3)' : '1px solid rgba(148,163,184,0.2)',
                            color: activeTab === 'notifications' ? '#3B82F6' : '#64748B',
                        }}
                    >
                        <i className="ri-notification-3-line mr-1" />
                        Notifications ({visibleNotifs.length})
                    </button>
                </div>

                {/* ── Alerts Tab ── */}
                {activeTab === 'alerts' && (
                    <div className="space-y-3">
                        {visibleAlerts.map((alert) => {
                            const config = alertTypeConfig[alert.type] || alertTypeConfig.Low;
                            return (
                                <div
                                    key={alert.id}
                                    className="rounded-2xl p-4 transition-all hover:-translate-y-1"
                                    style={{ background: config.bg, border: config.border }}
                                >
                                    <div className="flex gap-3">
                                        <div
                                            className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                                            style={{ background: config.iconBg }}
                                        >
                                            <i className={`${alert.icon} text-lg`} style={{ color: config.color }} />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-start justify-between gap-2">
                                                <div>
                                                    <div className="flex items-center gap-2 mb-1">
                                                        <span className="text-sm font-bold" style={{ color: '#0F172A' }}>{alert.title}</span>
                                                        <SeverityBadge type={alert.type} />
                                                    </div>
                                                    <div className="text-xs" style={{ color: '#64748B' }}>{alert.desc}</div>
                                                    <div className="flex items-center gap-3 mt-2">
                                                        <span className="text-[11px] font-semibold" style={{ color: '#94A3B8' }}>
                                                            <i className="ri-time-line mr-1" />{alert.timestamp}
                                                        </span>
                                                        {alert.barangay !== 'System' && (
                                                            <span className="text-[11px] font-semibold" style={{ color: '#94A3B8' }}>
                                                                <i className="ri-map-pin-line mr-1" />{alert.barangay}
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                                <div className="flex gap-2 shrink-0">
                                                    <button
                                                        onClick={() => setSelectedItem(alert)}
                                                        className="text-xs px-3 py-1.5 rounded-lg font-bold transition hover:opacity-80"
                                                        style={{ background: '#ffffff', border: `1px solid ${config.color}30`, color: config.color }}
                                                    >
                                                        View Details
                                                    </button>
                                                    <button
                                                        onClick={() => handleDismiss(alert.id)}
                                                        className="text-xs px-3 py-1.5 rounded-lg font-bold transition hover:opacity-80"
                                                        style={{ background: '#ffffff', border: '1px solid rgba(148,163,184,0.2)', color: '#64748B' }}
                                                    >
                                                        Dismiss
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                        {visibleAlerts.length === 0 && (
                            <div className="text-center py-12">
                                <i className="ri-check-double-line text-4xl block mb-3" style={{ color: '#10B981' }} />
                                <p className="text-sm font-semibold" style={{ color: '#0f172a' }}>No active alerts</p>
                                <p className="text-xs mt-1" style={{ color: '#64748b' }}>All systems operating normally</p>
                            </div>
                        )}
                    </div>
                )}

                {/* ── Notifications Tab ── */}
                {activeTab === 'notifications' && (
                    <div className="space-y-3">
                        {visibleNotifs.map((notif) => {
                            const config = notifTypeConfig[notif.type] || notifTypeConfig.info;
                            return (
                                <div
                                    key={notif.id}
                                    className="rounded-2xl p-4 transition-all hover:-translate-y-1"
                                    style={{ background: config.bg, border: config.border }}
                                >
                                    <div className="flex gap-3">
                                        <div
                                            className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                                            style={{ background: config.iconBg }}
                                        >
                                            <i className={`${notif.icon} text-lg`} style={{ color: config.color }} />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-start justify-between gap-2">
                                                <div>
                                                    <div className="flex items-center gap-2 mb-1">
                                                        <span className="text-sm font-bold" style={{ color: '#0F172A' }}>{notif.title}</span>
                                                        <span
                                                            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold"
                                                            style={{ background: `${config.color}1A`, color: config.color }}
                                                        >
                                                            {notif.type === 'success' ? 'Completed' : 'Info'}
                                                        </span>
                                                    </div>
                                                    <div className="text-xs" style={{ color: '#64748B' }}>{notif.desc}</div>
                                                    <div className="mt-2">
                                                        <span className="text-[11px] font-semibold" style={{ color: '#94A3B8' }}>
                                                            <i className="ri-time-line mr-1" />{notif.timestamp}
                                                        </span>
                                                    </div>
                                                </div>
                                                <div className="flex gap-2 shrink-0">
                                                    <button
                                                        onClick={() => setSelectedItem(notif)}
                                                        className="text-xs px-3 py-1.5 rounded-lg font-bold transition hover:opacity-80"
                                                        style={{ background: '#ffffff', border: `1px solid ${config.color}30`, color: config.color }}
                                                    >
                                                        View Details
                                                    </button>
                                                    <button
                                                        onClick={() => handleDismiss(notif.id)}
                                                        className="text-xs px-3 py-1.5 rounded-lg font-bold transition hover:opacity-80"
                                                        style={{ background: '#ffffff', border: '1px solid rgba(148,163,184,0.2)', color: '#64748B' }}
                                                    >
                                                        Dismiss
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                        {visibleNotifs.length === 0 && (
                            <div className="text-center py-12">
                                <i className="ri-notification-off-line text-4xl block mb-3" style={{ color: '#94A3B8' }} />
                                <p className="text-sm font-semibold" style={{ color: '#0f172a' }}>No notifications</p>
                                <p className="text-xs mt-1" style={{ color: '#64748b' }}>No new system notifications</p>
                            </div>
                        )}
                    </div>
                )}
            </section>

            {/* ── Detail Modal ── */}
            {selectedItem && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/30 p-4 backdrop-blur-sm">
                    <div
                        className="glass-card w-full max-w-2xl max-h-[90vh] overflow-hidden"
                        style={{ background: 'rgba(255,255,255,0.97)' }}
                    >
                        <div
                            className="flex flex-col gap-4 px-6 py-5 sm:flex-row sm:items-center sm:justify-between"
                            style={{ borderBottom: '1px solid rgba(148,163,184,.15)' }}
                        >
                            <div>
                                <p className="text-[10px] font-bold uppercase tracking-[0.3em]" style={{ color: '#64748b' }}>
                                    {activeTab === 'alerts' ? 'Alert Details' : 'Notification Details'}
                                </p>
                                <h2 className="mt-2 text-xl font-bold tracking-tight" style={{ color: '#0f172a' }}>
                                    {selectedItem.title}
                                </h2>
                            </div>
                            <button
                                onClick={() => setSelectedItem(null)}
                                className="inline-flex h-9 w-9 items-center justify-center rounded-full transition hover:opacity-80"
                                style={{ background: '#f1f5f9', color: '#475569' }}
                            >
                                <i className="ri-close-line text-base" />
                            </button>
                        </div>

                        <div className="space-y-4 overflow-y-auto px-6 py-6" style={{ maxHeight: '70vh' }}>
                            <div className="rounded-xl p-5" style={{ background: '#f8fafc', border: '1px solid rgba(148,163,184,0.15)' }}>
                                <div className="space-y-3 text-sm">
                                    {[
                                        { label: 'Title', value: selectedItem.title },
                                        { label: 'Description', value: selectedItem.desc },
                                        { label: 'Timestamp', value: selectedItem.timestamp },
                                        { label: 'Severity', value: selectedItem.type || 'Info' },
                                        ...(selectedItem.barangay ? [{ label: 'Barangay', value: selectedItem.barangay }] : []),
                                    ].map((f) => (
                                        <div key={f.label} className="flex items-start justify-between gap-4">
                                            <span className="shrink-0" style={{ color: '#64748b' }}>{f.label}</span>
                                            <span className="font-semibold text-right" style={{ color: '#0f172a' }}>{f.value}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="flex gap-3">
                                <button
                                    onClick={() => { handleDismiss(selectedItem.id); setSelectedItem(null); }}
                                    className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-xs font-bold text-white transition hover:opacity-90"
                                    style={{ background: 'linear-gradient(135deg, #0066FF 0%, #00D8F6 100%)' }}
                                >
                                    <i className="ri-check-line text-sm" />
                                    Mark as Read
                                </button>
                                <button
                                    onClick={() => setSelectedItem(null)}
                                    className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-xs font-bold transition"
                                    style={{ background: '#f8fafc', border: '1px solid #e2e8f0', color: '#475569' }}
                                >
                                    <i className="ri-close-line text-sm" />
                                    Close
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
