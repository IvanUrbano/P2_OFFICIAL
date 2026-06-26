/* ─── Helper: relative time from offset minutes ─── */
function relativeTime(minutesAgo) {
  const d = new Date(Date.now() - minutesAgo * 60 * 1000);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  if (isToday) return `Today ${time}`;
  const diffHrs = Math.floor(minutesAgo / 60);
  if (diffHrs < 24) return `${diffHrs} hours ago`;
  const diffDays = Math.floor(diffHrs / 24);
  return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
}

export default function Notifications() {
  const alerts = [
    { type: 'danger', icon: 'ri-alarm-warning-line', title: 'Manggahan — Critical Case Surge', desc: 'Cases increased 34% in the past 30 days. Immediate intervention required.', offsetMin: 120 },
    { type: 'warning', icon: 'ri-error-warning-line', title: 'Dela Paz — Low Success Rate', desc: 'Treatment success rate dropped to 58%. Below WHO threshold.', offsetMin: 360 },
    { type: 'warning', icon: 'ri-error-warning-line', title: 'Dela Paz — Supply Critical', desc: 'Medicine stock below 15%. Immediate resupply needed.', offsetMin: 600 },
    { type: 'info', icon: 'ri-refresh-line', title: 'System Sync Completed', desc: 'Data from 47 barangay health centers successfully synchronized.', offsetMin: 5 },
  ].map(a => ({ ...a, time: relativeTime(a.offsetMin) }));

  const colorMap = { danger: '#ff4d4d', warning: '#ffd166', info: '#00bfff' };
  const bgMap = { danger: 'rgba(255,77,77,0.07)', warning: 'rgba(255,209,102,0.06)', info: 'rgba(0,191,255,0.05)' };
  const borderMap = { danger: 'rgba(255,77,77,0.2)', warning: 'rgba(255,209,102,0.2)', info: 'rgba(0,191,255,0.12)' };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        {alerts.map(a => (
          <div key={a.title} className="flex gap-4 items-start rounded-xl p-4"
            style={{ background: bgMap[a.type], border: `1px solid ${borderMap[a.type]}` }}>
            <i className={`${a.icon} text-2xl mt-0.5 shrink-0`} style={{ color: colorMap[a.type] }} />
            <div className="flex-1">
              <div className="text-sm font-bold mb-1" style={{ color: '#eaf8ff' }}>{a.title}</div>
              <div className="text-xs" style={{ color: '#6f8a99' }}>{a.desc}</div>
              <div className="text-[11px] mt-1.5" style={{ color: '#6f8a99' }}>{a.time}</div>
            </div>
            <button className="text-xs px-3 py-1 rounded-lg" style={{ color: colorMap[a.type], border: `1px solid ${borderMap[a.type]}` }}>
              Dismiss
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
