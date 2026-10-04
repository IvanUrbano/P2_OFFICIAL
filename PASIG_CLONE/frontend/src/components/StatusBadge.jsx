const STYLES = {
  validated: { bg: 'rgba(16,185,129,0.1)', color: '#047857', border: 'rgba(16,185,129,0.2)' },
  new: { bg: 'rgba(16,185,129,0.1)', color: '#047857', border: 'rgba(16,185,129,0.2)' },
  existing: { bg: 'rgba(59,130,246,0.1)', color: '#1D4ED8', border: 'rgba(59,130,246,0.2)' },
  updated: { bg: 'rgba(245,158,11,0.1)', color: '#92400E', border: 'rgba(245,158,11,0.2)' },
  duplicate: { bg: 'rgba(107,114,128,0.1)', color: '#374151', border: 'rgba(107,114,128,0.2)' },
  pending: { bg: 'rgba(217,119,6,0.1)', color: '#92400E', border: 'rgba(217,119,6,0.2)' },
  invalid: { bg: 'rgba(239,68,68,0.1)', color: '#991B1B', border: 'rgba(239,68,68,0.2)' },
  synced: { bg: 'rgba(59,130,246,0.1)', color: '#1D4ED8', border: 'rgba(59,130,246,0.2)' },
  archived: { bg: 'rgba(100,116,139,0.1)', color: '#475569', border: 'rgba(100,116,139,0.2)' },
  sent: { bg: 'rgba(16,185,129,0.1)', color: '#047857', border: 'rgba(16,185,129,0.2)' },
  failed: { bg: 'rgba(239,68,68,0.1)', color: '#991B1B', border: 'rgba(239,68,68,0.2)' },
  admin: { bg: 'rgba(46,111,175,0.1)', color: '#2E6FAF', border: 'rgba(46,111,175,0.2)' },
  staff: { bg: 'rgba(16,185,129,0.1)', color: '#047857', border: 'rgba(16,185,129,0.2)' },
  active: { bg: 'rgba(16,185,129,0.1)', color: '#047857', border: 'rgba(16,185,129,0.2)' },
  inactive: { bg: 'rgba(100,116,139,0.1)', color: '#475569', border: 'rgba(100,116,139,0.2)' },
  // TB treatment outcomes (stored uppercase — keyed by the lowercased value, one color
  // per outcome like the original app; without these every outcome fell back to amber).
  'on treatment': { bg: 'rgba(245,158,11,0.1)', color: '#92400E', border: 'rgba(245,158,11,0.2)' },
  'treatment completed': { bg: 'rgba(59,130,246,0.1)', color: '#1D4ED8', border: 'rgba(59,130,246,0.2)' },
  cured: { bg: 'rgba(16,185,129,0.1)', color: '#047857', border: 'rgba(16,185,129,0.2)' },
  died: { bg: 'rgba(239,68,68,0.1)', color: '#991B1B', border: 'rgba(239,68,68,0.2)' },
  'lost to ff-up': { bg: 'rgba(107,114,128,0.1)', color: '#374151', border: 'rgba(107,114,128,0.2)' },
  'treatment failed': { bg: 'rgba(239,68,68,0.1)', color: '#991B1B', border: 'rgba(239,68,68,0.2)' },
  diagnosed: { bg: 'rgba(2,132,199,0.1)', color: '#0369A1', border: 'rgba(2,132,199,0.2)' },
  excluded: { bg: 'rgba(100,116,139,0.1)', color: '#475569', border: 'rgba(100,116,139,0.2)' },
  'not evaluated': { bg: 'rgba(139,92,246,0.1)', color: '#6D28D9', border: 'rgba(139,92,246,0.2)' },
  refused: { bg: 'rgba(107,114,128,0.1)', color: '#374151', border: 'rgba(107,114,128,0.2)' },
  '—': { bg: 'rgba(100,116,139,0.1)', color: '#64748B', border: 'rgba(100,116,139,0.2)' },
};

export default function StatusBadge({ status }) {
  const key = status?.toLowerCase() || 'pending';
  const s = STYLES[key] || STYLES.pending;
  // Same presentation as the original app's badge: no border stroke, and Title Case
  // instead of all caps ('ON TREATMENT' → 'On Treatment').
  const label = typeof status === 'string'
    ? status.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
    : status;
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wide"
      style={{ background: s.bg, color: s.color }}
    >
      {label}
    </span>
  );
}
