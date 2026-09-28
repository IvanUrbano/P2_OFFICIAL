import { useState, useEffect } from 'react';
import API from '../api/axios';
import { useTheme } from '../theme';
import EmptyState from '../components/EmptyState';

const SETTINGS_TABS = [
  { key: 'general', label: 'General', desc: 'System information and account settings' },
  { key: 'population', label: 'Barangay Population', desc: 'Manage population reference data' },
  { key: 'security', label: 'Security', desc: 'Password and security settings' },
];

// Must match the canonical 30 PSGC barangays in BACKEND/services/dataCleaner.js.
const PASIG_BARANGAYS = [
  'Bagong Ilog', 'Bagong Katipunan', 'Bambang', 'Buting', 'Caniogan', 'Dela Paz',
  'Kalawaan', 'Kapasigan', 'Kapitolyo', 'Malinao', 'Manggahan', 'Maybunga',
  'Oranbo', 'Palatiw', 'Pinagbuhatan', 'Pineda', 'Rosario', 'Sagad',
  'San Antonio', 'San Joaquin', 'San Jose', 'San Miguel', 'San Nicolas',
  'Santa Cruz', 'Santa Lucia', 'Santa Rosa', 'Santo Tomas', 'Santolan',
  'Sumilang', 'Ugong',
];

export default function SettingsPage() {
  const { t } = useTheme();
  const [activeTab, setActiveTab] = useState('general');
  const [user, setUser] = useState(null);
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [pwMsg, setPwMsg] = useState(null);
  const [savingPw, setSavingPw] = useState(false);

  const [population, setPopulation] = useState([]);
  const [popLoading, setPopLoading] = useState(false);
  const [showAddPop, setShowAddPop] = useState(false);
  const [showEditPop, setShowEditPop] = useState(null);
  const [popForm, setPopForm] = useState({ barangay_name: '', population: '', reference_year: '', source: '' });
  const [popError, setPopError] = useState('');
  const [popSaving, setPopSaving] = useState(false);

  useEffect(() => {
    API.get('/api/auth/profile').then(res => setUser(res.data.user)).catch(() => {});
  }, []);

  useEffect(() => {
    if (activeTab === 'population') {
      setPopLoading(true);
      API.get('/api/data/population')
        .then(res => setPopulation(res.data.population || []))
        .catch(() => {})
        .finally(() => setPopLoading(false));
    }
  }, [activeTab]);

  const handlePasswordSave = async () => {
    if (!pw.currentPassword || !pw.newPassword) { setPwMsg({ kind: 'error', text: 'All fields are required.' }); return; }
    if (pw.newPassword.length < 8) { setPwMsg({ kind: 'error', text: 'Password must be at least 8 characters.' }); return; }
    if (pw.newPassword !== pw.confirmPassword) { setPwMsg({ kind: 'error', text: 'Passwords do not match.' }); return; }
    setSavingPw(true);
    try {
      await API.put('/api/auth/password', { currentPassword: pw.currentPassword, newPassword: pw.newPassword });
      setPwMsg({ kind: 'success', text: 'Password changed successfully.' });
      setPw({ currentPassword: '', newPassword: '', confirmPassword: '' });
    } catch (err) {
      setPwMsg({ kind: 'error', text: err.response?.data?.error || 'Failed to change password.' });
    } finally {
      setSavingPw(false);
    }
  };

  const handlePopSave = async () => {
    setPopError('');
    if (!popForm.barangay_name || !popForm.population || !popForm.reference_year) {
      setPopError('Barangay, population, and year are required.'); return;
    }
    setPopSaving(true);
    try {
      if (showEditPop) {
        await API.put(`/api/data/population/${showEditPop.id}`, { population: Number(popForm.population), source: popForm.source || null });
      } else {
        await API.post('/api/data/population', {
          barangay_name: popForm.barangay_name,
          population: Number(popForm.population),
          reference_year: Number(popForm.reference_year),
          source: popForm.source || null,
        });
      }
      const res = await API.get('/api/data/population');
      setPopulation(res.data.population || []);
      setShowAddPop(false);
      setShowEditPop(null);
      setPopForm({ barangay_name: '', population: '', reference_year: '', source: '' });
    } catch (err) {
      setPopError(err.response?.data?.error || 'Failed to save.');
    } finally {
      setPopSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl overflow-hidden" style={{ background: '#ffffff', boxShadow: '0 2px 16px rgba(15,45,82,0.07), 0 1px 3px rgba(15,45,82,0.04)', border: '1px solid #E2E8F0' }}>
        <div className="px-6 py-4" style={{ borderBottom: '1px solid #DBEAFE' }}>
          <h1 className="text-lg font-extrabold tracking-tight" style={{ color: '#0F2D52' }}>Settings</h1>
          <p className="text-xs mt-0.5" style={{ color: '#94A3B8' }}>
            {SETTINGS_TABS.find(tab => tab.key === activeTab)?.desc}
          </p>
        </div>
        <div style={{ borderBottom: '1px solid #E2E8F0' }}>
          <div className="flex gap-0 overflow-x-auto">
            {SETTINGS_TABS.map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className="relative px-6 py-3 text-left transition-colors whitespace-nowrap"
                style={{ background: 'transparent' }}
              >
                <p className="text-[13px] font-bold" style={{ color: activeTab === tab.key ? '#0F2D52' : '#94A3B8' }}>
                  {tab.label}
                </p>
                <p className="text-[11px] mt-0.5" style={{ color: activeTab === tab.key ? '#64748B' : '#CBD5E1' }}>
                  {tab.desc}
                </p>
                {activeTab === tab.key && (
                  <div className="absolute bottom-0 left-0 right-0 h-[2px]" style={{ background: '#0F2D52' }} />
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      {activeTab === 'general' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div style={cardStyle(t)} className="p-5">
            <h2 className="text-sm font-bold mb-4" style={{ color: t.text }}>System Information</h2>
            <div className="space-y-3">
              {[{ label: 'System Name', value: 'PASIG TB-IS' }, { label: 'Version', value: '1.0' }, { label: 'Integration', value: 'Connected to TBInsight' }].map((item) => (
                <div key={item.label} className="flex justify-between py-2" style={{ borderBottom: `1px solid ${t.border}` }}>
                  <span className="text-xs" style={{ color: t.textSecondary }}>{item.label}</span>
                  <span className="text-xs font-semibold" style={{ color: t.text }}>{item.value}</span>
                </div>
              ))}
            </div>
          </div>
          <div style={cardStyle(t)} className="p-5">
            <h2 className="text-sm font-bold mb-4" style={{ color: t.text }}>Account Settings</h2>
            {user && (
              <div className="space-y-3">
                {[{ label: 'Username', value: user.username }, { label: 'Email', value: user.email }, { label: 'Role', value: user.role }].map((item) => (
                  <div key={item.label} className="flex justify-between py-2" style={{ borderBottom: `1px solid ${t.border}` }}>
                    <span className="text-xs" style={{ color: t.textSecondary }}>{item.label}</span>
                    <span className="text-xs font-semibold" style={{ color: t.text }}>{item.value}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'population' && (
        <div className="rounded-xl overflow-hidden" style={{ background: '#ffffff', border: '1px solid #E2E8F0', boxShadow: '0 4px 16px rgba(15,23,42,0.04)' }}>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-6 py-4" style={{ borderBottom: '1px solid #E2E8F0' }}>
            <div>
              <h2 className="text-sm font-bold" style={{ color: '#0F2D52' }}>Barangay Population</h2>
              <p className="text-[11px] mt-0.5" style={{ color: '#94A3B8' }}>Manage population reference data used for barangay-level incidence calculations.</p>
            </div>
            <button onClick={() => { setShowAddPop(true); setPopForm({ barangay_name: '', population: '', reference_year: '2020', source: 'PSA Census' }); setPopError(''); }} className="px-4 py-2 text-xs font-semibold shrink-0 flex items-center gap-2" style={{ background: '#0F2D52', color: '#ffffff', borderRadius: 4 }}>
              + Add Population Year
            </button>
          </div>

          {popLoading ? (
            <div className="flex items-center justify-center py-12"><i className="ri-loader-4-line animate-spin text-lg" style={{ color: '#94A3B8' }} /></div>
          ) : population.length === 0 ? (
            <EmptyState icon="ri-group-line" title="No Population Data" description="Add population reference data for barangays." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr style={{ background: '#FAFCFF', borderBottom: '1px solid #E2E8F0' }}>
                    {['Barangay', 'Population', 'Reference Year', 'Source', 'Last Updated', 'Actions'].map((h) => (
                      <th key={h} className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-wider" style={{ color: '#0F2D52' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {population.map((p) => (
                    <tr key={p.id} className="hover:bg-blue-50/40 transition-colors" style={{ borderBottom: '1px solid #F1F5F9' }}>
                      <td className="px-4 py-3 text-xs font-bold" style={{ color: '#0F2D52' }}>{p.barangay_name}</td>
                      <td className="px-4 py-3 text-xs font-semibold" style={{ color: '#475569' }}>{Number(p.population).toLocaleString()}</td>
                      <td className="px-4 py-3 text-xs" style={{ color: '#475569' }}>{p.reference_year}</td>
                      <td className="px-4 py-3 text-xs" style={{ color: '#475569' }}>{p.source || '—'}</td>
                      <td className="px-4 py-3 text-xs" style={{ color: '#64748B' }}>{p.updated_at ? new Date(p.updated_at).toLocaleDateString() : '—'}</td>
                      <td className="px-4 py-3">
                        <button onClick={() => { setShowEditPop(p); setPopForm({ barangay_name: p.barangay_name, population: String(p.population), reference_year: String(p.reference_year), source: p.source || '' }); setPopError(''); }} className="px-2 py-1 text-[10px] font-semibold rounded cursor-pointer" style={{ color: '#2E6FAF' }}>Edit</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeTab === 'security' && (
        <div style={cardStyle(t)} className="p-5 max-w-lg">
          <h2 className="text-sm font-bold mb-4" style={{ color: t.text }}>Change Password</h2>
          <div className="space-y-2">
            {[
              { key: 'currentPassword', label: 'Current Password', type: 'password' },
              { key: 'newPassword', label: 'New Password', type: 'password' },
              { key: 'confirmPassword', label: 'Confirm Password', type: 'password' },
            ].map((field) => (
              <input key={field.key} type={field.type} placeholder={field.label} value={pw[field.key]}
                onChange={(e) => setPw({ ...pw, [field.key]: e.target.value })}
                className="w-full px-3 py-2 text-xs rounded-lg outline-none" style={{ background: t.inputBg, border: `1px solid ${t.inputBorder}`, color: t.text }} />
            ))}
          </div>
          {pwMsg && (
            <div className="mt-2 px-3 py-2 rounded-lg text-[11px]" style={{ background: pwMsg.kind === 'error' ? 'rgba(239,68,68,0.05)' : 'rgba(16,185,129,0.05)', color: pwMsg.kind === 'error' ? '#991B1B' : '#047857' }}>
              {pwMsg.text}
            </div>
          )}
          <button onClick={handlePasswordSave} disabled={savingPw} className="mt-3 px-4 py-2 text-xs font-semibold rounded-lg disabled:opacity-50" style={{ background: '#0F2D52', color: '#ffffff' }}>
            {savingPw ? 'Updating...' : 'Update Password'}
          </button>
        </div>
      )}

      {(showAddPop || showEditPop) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[2px]" onClick={() => { setShowAddPop(false); setShowEditPop(null); }}>
          <div className="bg-white border border-gray-200 shadow-xl w-full max-w-[420px] mx-4 overflow-hidden" style={{ borderRadius: '5px' }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100" style={{ background: '#FAFCFF' }}>
              <h3 className="text-sm font-bold" style={{ color: '#0F2D52' }}>{showEditPop ? 'Edit Population' : 'Add Population Year'}</h3>
              <button onClick={() => { setShowAddPop(false); setShowEditPop(null); }} className="text-gray-400 hover:text-gray-600 p-1 rounded cursor-pointer"><i className="ri-close-line text-lg" /></button>
            </div>
            <div className="p-5 space-y-3">
              {popError && <div className="px-3 py-2 rounded-lg text-xs" style={{ background: 'rgba(239,68,68,0.05)', color: '#991B1B' }}>{popError}</div>}

              {showAddPop && (
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider block mb-1" style={{ color: '#64748B' }}>Barangay</label>
                  <select
                    value={popForm.barangay_name}
                    onChange={(e) => setPopForm({ ...popForm, barangay_name: e.target.value })}
                    className="w-full px-3 py-2 text-xs rounded-lg outline-none"
                    style={{ background: '#ffffff', border: '1px solid #E2E8F0', color: '#0F2D52' }}
                  >
                    <option value="">Select Barangay</option>
                    {PASIG_BARANGAYS.map(b => <option key={b} value={b}>{b}</option>)}
                  </select>
                </div>
              )}

              {showEditPop && (
                <div className="p-2.5 rounded-lg" style={{ background: '#F8FAFC', border: '1px solid #F1F5F9' }}>
                  <label className="text-[10px] font-bold uppercase tracking-wider block mb-1" style={{ color: '#64748B' }}>Barangay</label>
                  <p className="text-xs font-bold" style={{ color: '#0F2D52' }}>{popForm.barangay_name}</p>
                </div>
              )}

              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider block mb-1" style={{ color: '#64748B' }}>Reference Year</label>
                <input
                  type="number"
                  value={popForm.reference_year}
                  onChange={(e) => setPopForm({ ...popForm, reference_year: e.target.value })}
                  disabled={!!showEditPop}
                  className="w-full px-3 py-2 text-xs rounded-lg outline-none disabled:opacity-50"
                  style={{ background: '#ffffff', border: '1px solid #E2E8F0', color: '#0F2D52' }}
                />
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider block mb-1" style={{ color: '#64748B' }}>Population</label>
                <input
                  type="number"
                  value={popForm.population}
                  onChange={(e) => setPopForm({ ...popForm, population: e.target.value })}
                  className="w-full px-3 py-2 text-xs rounded-lg outline-none"
                  style={{ background: '#ffffff', border: '1px solid #E2E8F0', color: '#0F2D52' }}
                />
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider block mb-1" style={{ color: '#64748B' }}>Source</label>
                <input
                  type="text"
                  value={popForm.source}
                  onChange={(e) => setPopForm({ ...popForm, source: e.target.value })}
                  placeholder="e.g. PSA Census"
                  className="w-full px-3 py-2 text-xs rounded-lg outline-none"
                  style={{ background: '#ffffff', border: '1px solid #E2E8F0', color: '#0F2D52' }}
                />
              </div>
            </div>
            <div className="px-5 py-3.5 bg-gray-50 border-t border-gray-100 flex justify-end gap-2">
              <button onClick={() => { setShowAddPop(false); setShowEditPop(null); }} className="px-4 py-2 text-xs font-bold rounded-md cursor-pointer border border-gray-300 text-gray-600 bg-white">Cancel</button>
              <button onClick={handlePopSave} disabled={popSaving} className="px-4 py-2 text-xs font-bold text-white rounded-md cursor-pointer disabled:opacity-50" style={{ background: '#0F2D52' }}>{popSaving ? 'Saving...' : (showEditPop ? 'Save Population' : 'Add Population')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const cardStyle = (t) => ({
  background: t.cardSolid,
  border: `1px solid ${t.border}`,
  borderRadius: '12px',
  boxShadow: '0 4px 16px rgba(15,23,42,0.04)',
});
