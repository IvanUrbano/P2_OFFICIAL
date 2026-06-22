export default function TBRecords() {
  return (
    <div
      className="relative overflow-hidden min-h-[80vh] flex flex-col items-center justify-center text-center p-6"
      style={{
        background:
          'linear-gradient(135deg, #F8FAFC 0%, #EEF4FB 50%, #F5F8FC 100%)'
      }}
    >
      <h1
        className="text-2xl font-bold mb-2"
        style={{
          color: '#0F172A'
        }}
      >
        TB Records
      </h1>

      <p
        className="text-sm mb-6 max-w-md"
        style={{
          color: '#64748B'
        }}
      >
        Individual tuberculosis case records, patient monitoring,
        treatment tracking, and case management.
      </p>

      <div
        className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs font-semibold"
        style={{
          background: 'rgba(46,111,175,.08)',
          color: '#2E6FAF'
        }}
      >
        <i className="ri-time-line" />
        Coming Soon
      </div>
    </div>
  );
}