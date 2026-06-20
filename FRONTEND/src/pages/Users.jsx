export default function Users() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-center h-64 rounded-xl" style={{ background: '#081018', border: '1px solid rgba(0,191,255,0.08)' }}>
        <div className="text-center">
          <i className="ri-team-line text-5xl mb-3 block" style={{ color: '#00bfff' }} />
          <p className="text-lg font-semibold" style={{ color: '#eaf8ff' }}>Users</p>
          <p className="text-sm mt-1" style={{ color: '#6f8a99' }}>Manage health worker accounts and access roles — coming soon.</p>
        </div>
      </div>
    </div>
  );
}
