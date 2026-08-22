import { useTheme } from '../theme';

export default function Users() {
  const { t } = useTheme();
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-center h-64 rounded-xl" style={{ background: t.card, border: `1px solid ${t.border}` }}>
        <div className="text-center">
          <i className="ri-team-line text-5xl mb-3 block" style={{ color: '#2E6FAF' }} />
          <p className="text-lg font-semibold" style={{ color: t.text }}>Users</p>
          <p className="text-sm mt-1" style={{ color: t.textSecondary }}>Manage health worker accounts and access roles — coming soon.</p>
        </div>
      </div>
    </div>
  );
}
