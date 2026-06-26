import { useState } from 'react';

export default function Settings() {
  const [saved, setSaved] = useState(false);
  const [activeTab, setActiveTab] = useState('general');

  const [settings, setSettings] = useState({
    systemName: 'TBInsight',
    systemDesc: 'Pasig City TB Monitoring & Analytics Platform',
    timezone: 'Asia/Manila',
    language: 'English',
    dateFormat: 'MM/DD/YYYY',
    emailAlerts: true,
    browserNotifications: true,
    alertThreshold: 'medium',
    criticalAlertSound: true,
    autoSync: true,
    syncInterval: '15',
    dataRetention: '24',
    exportFormat: 'CSV',
    compactMode: false,
    chartAnimations: true,
    showForecasts: true,
    sessionTimeout: '30',
    twoFactorAuth: false,
    auditLogging: true,
  });

  const update = (key, value) => setSettings(prev => ({ ...prev, [key]: value }));

  const handleSave = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const TABS = [
    { key: 'general', label: 'General', icon: 'ri-settings-3-line' },
    { key: 'notifications', label: 'Notifications', icon: 'ri-notification-3-line' },
    { key: 'data', label: 'Data Management', icon: 'ri-database-2-line' },
    { key: 'display', label: 'Display', icon: 'ri-palette-line' },
    { key: 'security', label: 'Security', icon: 'ri-shield-keyhole-line' },
  ];

  const Toggle = ({ value, onChange }) => (
    <button
      onClick={() => onChange(!value)}
      className="relative w-11 h-6 rounded-full transition-colors duration-200"
      style={{ background: value ? '#10B981' : '#e2e8f0' }}
    >
      <span
        className="absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow-md transition-transform duration-200"
        style={{ transform: value ? 'translateX(20px)' : 'translateX(0)' }}
      />
    </button>
  );

  const Select = ({ value, onChange, options }) => (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-xl px-4 py-3 text-sm font-medium outline-none transition-all focus:ring-2 focus:ring-[#2E6FAF]/10 focus:border-[#2E6FAF]"
      style={{ background: '#f8fafc', border: '1.5px solid #e2e8f0', color: '#0f172a' }}
    >
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );

  const Input = ({ value, onChange, type = 'text', placeholder }) => (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full rounded-xl px-4 py-3 text-sm font-medium outline-none transition-all focus:ring-2 focus:ring-[#2E6FAF]/10 focus:border-[#2E6FAF]"
      style={{ background: '#f8fafc', border: '1.5px solid #e2e8f0', color: '#0f172a' }}
    />
  );

  const FieldRow = ({ label, desc, children }) => (
    <div className="flex items-center justify-between gap-6 py-4" style={{ borderBottom: '1px solid #f1f5f9' }}>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold" style={{ color: '#0f172a' }}>{label}</p>
        {desc && <p className="text-xs mt-0.5" style={{ color: '#94A3B8' }}>{desc}</p>}
      </div>
      <div className="shrink-0 w-64">{children}</div>
    </div>
  );

  return (
    <div className="relative space-y-5">

      {/* Saved Toast */}
      {saved && (
        <div className="fixed top-20 right-6 z-50 flex items-center gap-2 px-5 py-3 rounded-2xl text-sm font-bold text-white shadow-2xl" style={{ background: 'linear-gradient(135deg, #10B981, #059669)' }}>
          <div className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center"><i className="ri-check-line text-xs" /></div>
          Settings saved successfully
        </div>
      )}

      {/* Header */}
      <section className="rounded-3xl p-6 bg-white shadow-sm" style={{ border: '1px solid rgba(148,163,184,0.12)' }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #0F2D52, #2E6FAF)' }}>
              <i className="ri-settings-3-line text-lg text-white" />
            </div>
            <div>
              <h2 className="text-lg font-extrabold" style={{ color: '#0f172a' }}>System Settings</h2>
              <p className="text-xs mt-0.5" style={{ color: '#94A3B8' }}>Configure your TBInsight platform preferences</p>
            </div>
          </div>
          <button
            onClick={handleSave}
            className="inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-xs font-bold text-white transition-all hover:shadow-lg hover:scale-[1.02] active:scale-[0.98]"
            style={{ background: 'linear-gradient(135deg, #0066FF 0%, #00D8F6 100%)', boxShadow: '0 4px 14px rgba(0,102,255,0.25)' }}
          >
            <i className="ri-save-line text-sm" />
            Save Changes
          </button>
        </div>
      </section>

      {/* Tabs */}
      <div className="flex gap-1 p-1 rounded-2xl w-fit" style={{ background: '#f1f5f9' }}>
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold transition-all duration-200"
            style={activeTab === tab.key ? { background: '#fff', color: '#0f172a', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' } : { color: '#94A3B8' }}
          >
            <i className={`${tab.icon} text-sm`} />
            {tab.label}
          </button>
        ))}
      </div>

      {/* General Settings */}
      {activeTab === 'general' && (
        <section className="rounded-3xl p-6 bg-white shadow-sm" style={{ border: '1px solid rgba(148,163,184,0.12)' }}>
          <div className="flex items-center gap-3 mb-5">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'rgba(46,111,175,0.1)' }}>
              <i className="ri-settings-3-line text-base" style={{ color: '#2E6FAF' }} />
            </div>
            <span className="text-sm font-bold" style={{ color: '#0f172a' }}>General Settings</span>
          </div>

          <FieldRow label="System Name" desc="Display name shown in the sidebar and browser tab">
            <Input value={settings.systemName} onChange={(v) => update('systemName', v)} placeholder="System name" />
          </FieldRow>
          <FieldRow label="System Description" desc="Brief description of this installation">
            <Input value={settings.systemDesc} onChange={(v) => update('systemDesc', v)} placeholder="Description" />
          </FieldRow>
          <FieldRow label="Timezone" desc="Used for timestamps and scheduling">
            <Select value={settings.timezone} onChange={(v) => update('timezone', v)} options={[
              { value: 'Asia/Manila', label: 'Asia/Manila (GMT+8)' },
              { value: 'UTC', label: 'UTC (GMT+0)' },
              { value: 'Asia/Tokyo', label: 'Asia/Tokyo (GMT+9)' },
            ]} />
          </FieldRow>
          <FieldRow label="Language" desc="Interface language">
            <Select value={settings.language} onChange={(v) => update('language', v)} options={[
              { value: 'English', label: 'English' },
              { value: 'Filipino', label: 'Filipino' },
            ]} />
          </FieldRow>
          <FieldRow label="Date Format" desc="How dates are displayed throughout the system">
            <Select value={settings.dateFormat} onChange={(v) => update('dateFormat', v)} options={[
              { value: 'MM/DD/YYYY', label: 'MM/DD/YYYY' },
              { value: 'DD/MM/YYYY', label: 'DD/MM/YYYY' },
              { value: 'YYYY-MM-DD', label: 'YYYY-MM-DD' },
            ]} />
          </FieldRow>
        </section>
      )}

      {/* Notification Settings */}
      {activeTab === 'notifications' && (
        <section className="rounded-3xl p-6 bg-white shadow-sm" style={{ border: '1px solid rgba(148,163,184,0.12)' }}>
          <div className="flex items-center gap-3 mb-5">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'rgba(239,68,68,0.1)' }}>
              <i className="ri-notification-3-line text-base" style={{ color: '#EF4444' }} />
            </div>
            <span className="text-sm font-bold" style={{ color: '#0f172a' }}>Notification Settings</span>
          </div>

          <FieldRow label="Email Alerts" desc="Receive critical alerts via email">
            <Toggle value={settings.emailAlerts} onChange={(v) => update('emailAlerts', v)} />
          </FieldRow>
          <FieldRow label="Browser Notifications" desc="Show desktop push notifications">
            <Toggle value={settings.browserNotifications} onChange={(v) => update('browserNotifications', v)} />
          </FieldRow>
          <FieldRow label="Critical Alert Sound" desc="Play sound for high-severity alerts">
            <Toggle value={settings.criticalAlertSound} onChange={(v) => update('criticalAlertSound', v)} />
          </FieldRow>
          <FieldRow label="Alert Threshold" desc="Minimum severity level to trigger notifications">
            <Select value={settings.alertThreshold} onChange={(v) => update('alertThreshold', v)} options={[
              { value: 'low', label: 'All Alerts (Low, Medium, High)' },
              { value: 'medium', label: 'Medium & High Only' },
              { value: 'high', label: 'High Only' },
            ]} />
          </FieldRow>
        </section>
      )}

      {/* Data Management */}
      {activeTab === 'data' && (
        <section className="rounded-3xl p-6 bg-white shadow-sm" style={{ border: '1px solid rgba(148,163,184,0.12)' }}>
          <div className="flex items-center gap-3 mb-5">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'rgba(16,185,129,0.1)' }}>
              <i className="ri-database-2-line text-base" style={{ color: '#10B981' }} />
            </div>
            <span className="text-sm font-bold" style={{ color: '#0f172a' }}>Data Management</span>
          </div>

          <FieldRow label="Auto-Sync" desc="Automatically synchronize data from health centers">
            <Toggle value={settings.autoSync} onChange={(v) => update('autoSync', v)} />
          </FieldRow>
          <FieldRow label="Sync Interval" desc="How often data is synchronized (minutes)">
            <Select value={settings.syncInterval} onChange={(v) => update('syncInterval', v)} options={[
              { value: '5', label: 'Every 5 minutes' },
              { value: '15', label: 'Every 15 minutes' },
              { value: '30', label: 'Every 30 minutes' },
              { value: '60', label: 'Every hour' },
            ]} />
          </FieldRow>
          <FieldRow label="Data Retention" desc="How long historical data is kept (months)">
            <Select value={settings.dataRetention} onChange={(v) => update('dataRetention', v)} options={[
              { value: '12', label: '12 months' },
              { value: '24', label: '24 months' },
              { value: '36', label: '36 months' },
              { value: '60', label: '60 months' },
            ]} />
          </FieldRow>
          <FieldRow label="Export Format" desc="Default format for data exports">
            <Select value={settings.exportFormat} onChange={(v) => update('exportFormat', v)} options={[
              { value: 'CSV', label: 'CSV (.csv)' },
              { value: 'Excel', label: 'Excel (.xlsx)' },
              { value: 'JSON', label: 'JSON (.json)' },
            ]} />
          </FieldRow>
        </section>
      )}

      {/* Display Settings */}
      {activeTab === 'display' && (
        <section className="rounded-3xl p-6 bg-white shadow-sm" style={{ border: '1px solid rgba(148,163,184,0.12)' }}>
          <div className="flex items-center gap-3 mb-5">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'rgba(139,92,246,0.1)' }}>
              <i className="ri-palette-line text-base" style={{ color: '#8B5CF6' }} />
            </div>
            <span className="text-sm font-bold" style={{ color: '#0f172a' }}>Display Settings</span>
          </div>

          <FieldRow label="Compact Mode" desc="Reduce spacing and padding for more content density">
            <Toggle value={settings.compactMode} onChange={(v) => update('compactMode', v)} />
          </FieldRow>
          <FieldRow label="Chart Animations" desc="Enable smooth transitions on charts and graphs">
            <Toggle value={settings.chartAnimations} onChange={(v) => update('chartAnimations', v)} />
          </FieldRow>
          <FieldRow label="Show Forecast Lines" desc="Display ARIMA forecast projections on trend charts">
            <Toggle value={settings.showForecasts} onChange={(v) => update('showForecasts', v)} />
          </FieldRow>
        </section>
      )}

      {/* Security Settings */}
      {activeTab === 'security' && (
        <section className="rounded-3xl p-6 bg-white shadow-sm" style={{ border: '1px solid rgba(148,163,184,0.12)' }}>
          <div className="flex items-center gap-3 mb-5">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'rgba(239,68,68,0.1)' }}>
              <i className="ri-shield-keyhole-line text-base" style={{ color: '#EF4444' }} />
            </div>
            <span className="text-sm font-bold" style={{ color: '#0f172a' }}>Security Settings</span>
          </div>

          <FieldRow label="Session Timeout" desc="Auto-logout after period of inactivity (minutes)">
            <Select value={settings.sessionTimeout} onChange={(v) => update('sessionTimeout', v)} options={[
              { value: '15', label: '15 minutes' },
              { value: '30', label: '30 minutes' },
              { value: '60', label: '1 hour' },
              { value: '120', label: '2 hours' },
            ]} />
          </FieldRow>
          <FieldRow label="Two-Factor Authentication" desc="Require 2FA for all admin accounts">
            <Toggle value={settings.twoFactorAuth} onChange={(v) => update('twoFactorAuth', v)} />
          </FieldRow>
          <FieldRow label="Audit Logging" desc="Track all user actions for compliance and security">
            <Toggle value={settings.auditLogging} onChange={(v) => update('auditLogging', v)} />
          </FieldRow>

          {/* Danger Zone */}
          <div className="mt-6 rounded-2xl p-5" style={{ background: 'linear-gradient(135deg, #fef2f2, #fee2e2)', border: '1.5px solid #fecaca' }}>
            <p className="text-xs font-bold mb-3" style={{ color: '#991b1b' }}>Danger Zone</p>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-bold" style={{ color: '#7f1d1d' }}>Reset All Settings</p>
                <p className="text-[11px] mt-0.5" style={{ color: '#94A3B8' }}>Restore all settings to their default values</p>
              </div>
              <button
                className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition-all hover:shadow-md active:scale-[0.98]"
                style={{ background: '#fff', border: '1.5px solid #fca5a5', color: '#dc2626' }}
              >
                <i className="ri-refresh-line text-sm" />
                Reset
              </button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
