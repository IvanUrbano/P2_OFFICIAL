/**
 * Reports page — placeholder for report generation and download.
 */
export default function Reports() {
  return (
    <div className="flex flex-col gap-5">
      <div
        className="rounded-2xl p-8"
        style={{
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          boxShadow: '0 4px 20px rgba(15, 45, 82, 0.06)',
        }}
      >
        <div className="flex items-center gap-3 mb-4">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: 'rgba(0,102,255,0.1)' }}
          >
            <i className="ri-file-chart-line text-xl" style={{ color: '#0066FF' }} />
          </div>
          <div>
            <h2 className="text-lg font-bold" style={{ color: '#0F2D52' }}>Reports</h2>
            <p className="text-xs" style={{ color: '#94A3B8' }}>Generate and download TB insight reports.</p>
          </div>
        </div>
      </div>

      <div
        className="rounded-2xl p-12 text-center"
        style={{
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          boxShadow: '0 4px 20px rgba(15, 45, 82, 0.06)',
        }}
      >
        <i className="ri-file-chart-line text-5xl" style={{ color: '#CBD5E1' }} />
        <p className="mt-4 text-sm font-bold" style={{ color: '#64748B' }}>Coming Soon</p>
        <p className="text-xs mt-1" style={{ color: '#94A3B8' }}>Report generation and export features are under development.</p>
      </div>
    </div>
  );
}
