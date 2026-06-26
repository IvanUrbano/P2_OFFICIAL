export default function Users() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-center h-64 rounded-xl" style={{ background: 'rgba(255,255,255,0.55)', border: '1px solid rgba(0,0,0,0.04)' }}>
        <div className="text-center">
          <i className="ri-team-line text-5xl mb-3 block" style={{ color: '#2E6FAF' }} />
          <p className="text-lg font-semibold" style={{ color: '#1e293b' }}>Users</p>
          <p className="text-sm mt-1" style={{ color: '#64748b' }}>Manage health worker accounts and access roles — coming soon.</p>
        </div>
      </div>
    </div>
  );
}
