const STYLES = {
  validated: { bg: 'rgba(16,185,129,0.1)', color: '#047857', border: 'rgba(16,185,129,0.2)' },
  pending: { bg: 'rgba(217,119,6,0.1)', color: '#92400E', border: 'rgba(217,119,6,0.2)' },
  invalid: { bg: 'rgba(239,68,68,0.1)', color: '#991B1B', border: 'rgba(239,68,68,0.2)' },
  synced: { bg: 'rgba(59,130,246,0.1)', color: '#1D4ED8', border: 'rgba(59,130,246,0.2)' },
  archived: { bg: 'rgba(100,116,139,0.1)', color: '#475569', border: 'rgba(100,116,139,0.2)' },
  sent: { bg: 'rgba(16,185,129,0.1)', color: '#047857', border: 'rgba(16,185,129,0.2)' },
  failed: { bg: 'rgba(239,68,68,0.1)', color: '#991B1B', border: 'rgba(239,68,68,0.2)' },
  admin: { bg: 'rgba(46,111,175,0.1)', color: '#2E6FAF', border: 'rgba(46,111,175,0.2)' },
  staff: { bg: 'rgba(16,185,129,0.1)', color: '#047857', border: 'rgba(16,185,129,0.2)' },
};

export default function StatusBadge({ status }) {
  const key = status?.toLowerCase() || 'pending';
  const s = STYLES[key] || STYLES.pending;
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide"
      style={{ background: s.bg, color: s.color, border: `1px solid ${s.border}` }}
    >
      {status}
    </span>
  );
}
