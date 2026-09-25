import { useNavigate } from 'react-router-dom';
import Logo from '../../components/Logo';

const FEATURES = [
  { icon: 'ri-map-pin-line', title: 'GIS', desc: 'Visualize and track TB cases geographically' },
  { icon: 'ri-bar-chart-grouped-line', title: 'Analytics', desc: 'Turn data into actionable insights' },
  { icon: 'ri-notification-3-line', title: 'Alert', desc: 'Detect and respond to risks early' },
  { icon: 'ri-dashboard-3-line', title: 'Dashboard', desc: 'Monitor progress in real time' },
  { icon: 'ri-stethoscope-line', title: 'Intervention Planning', desc: 'Plan targeted and effective interventions' },
];

const PASIG_CLONE_URL =
  import.meta.env.VITE_PASIG_CLONE_URL || 'https://pasig-clone.onrender.com';

export default function LandingPage() {
  const navigate = useNavigate();

  const handleSelect = (system) => {
    if (system === 'tbinsight') {
      navigate('/login');
    } else {
      window.location.href = `${PASIG_CLONE_URL}/login`;
    }
  };

  return (
    <div
      className="h-screen w-full flex flex-col overflow-hidden relative"
      style={{
        backgroundImage: "url('/images/LANDING_BG.png')",
        backgroundPosition: 'center 90%',
        backgroundRepeat: 'no-repeat',
        backgroundSize: 'cover',
      }}
    >
      <div className="relative z-10 flex flex-col h-full">

        {/* ─── Top Nav: Logo ─── */}
        <nav className="w-full px-10 lg:px-20 py-4 flex-shrink-0">
          <Logo width={86} />
        </nav>

        {/* ─── Hero ─── */}
        <main className="flex-1 flex flex-col justify-center px-10 lg:px-20 max-w-[1400px] w-full">

          <div className="flex items-center gap-2.5 mb-4">
            <div className="w-[3px] h-5 rounded-full" style={{ background: '#2E6FAF' }} />
            <span
              className="text-[10px] font-semibold tracking-[0.12em] uppercase"
              style={{ color: '#2E6FAF' }}
            >
              Data-Driven Tuberculosis Intelligence
            </span>
          </div>

          <h1
            className="text-[2.2rem] md:text-[2.8rem] lg:text-[3.1rem] font-extrabold leading-[1.1] tracking-tight max-w-lg"
            style={{ color: '#0F2D52' }}
          >
            Understand TB.
            <br />
            <span style={{ color: '#2E6FAF' }}>
              Predict Risks.
            </span>
            <br />
            Take Action.
          </h1>

          <p
            className="mt-4 text-[13px] leading-[1.75] max-w-[420px]"
            style={{ color: '#64748B', letterSpacing: '0.01em' }}
          >
            TBInsight transforms tuberculosis data into clear, actionable insights.
            Combining advanced analytics, predictive forecasting, GIS hotspot detection,
            risk classification, and automated reporting — it empowers health professionals
            to anticipate risks and take timely, evidence-based action.
          </p>

          <div className="mt-6 flex items-center gap-3">
            <button
              onClick={() => handleSelect('tbinsight')}
              className="group flex items-center gap-2 px-6 py-2.5 rounded-lg text-[13px] font-semibold transition-all duration-200 cursor-pointer"
              style={{ background: '#0F2D52', color: '#ffffff', boxShadow: '0 4px 14px rgba(15,45,82,0.25)' }}
              onMouseEnter={(e) => { e.currentTarget.style.background = '#174A7E'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = '#0F2D52'; }}
            >
              Explore TBInsight
              <i className="ri-arrow-right-line text-sm transition-transform duration-200 group-hover:translate-x-1" />
            </button>

            <button
              onClick={() => handleSelect('pasig-clone')}
              className="group flex items-center gap-2 px-6 py-2.5 rounded-lg text-[13px] font-semibold transition-all duration-200 cursor-pointer"
              style={{ background: 'transparent', color: '#0F2D52', border: '2px solid #0F2D52' }}
              onMouseEnter={(e) => { e.currentTarget.style.background = '#0F2D52'; e.currentTarget.style.color = '#ffffff'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#0F2D52'; }}
            >
              Access External TB System
              <i className="ri-arrow-right-line text-sm transition-transform duration-200 group-hover:translate-x-1" />
            </button>
          </div>
        </main>

        {/* ─── Feature Highlights ─── */}
        <footer className="flex-shrink-0 w-full px-10 lg:px-20 pb-5 pt-3 max-w-[1400px]">
          {/* Divider */}
          <div className="w-full h-px mb-4" style={{ background: '#E2E8F0' }} />

          <div className="flex items-start gap-0">
            {FEATURES.map((f, i) => (
              <div key={f.title} className="flex items-start">
                <div className="flex flex-col items-center text-center gap-1.5 w-[130px]">
                  <div
                    className="w-9 h-9 rounded-full flex items-center justify-center"
                    style={{ background: '#EFF6FF' }}
                  >
                    <i className={`${f.icon} text-sm`} style={{ color: '#1E40AF' }} />
                  </div>
                  <h4 className="text-[11.5px] font-bold leading-tight" style={{ color: '#1E3A5F' }}>
                    {f.title}
                  </h4>
                  <p className="text-[10px] leading-snug px-1" style={{ color: '#94A3B8' }}>
                    {f.desc}
                  </p>
                </div>
                {i < FEATURES.length - 1 && (
                  <div className="h-14 w-px mx-2 mt-2 flex-shrink-0" style={{ background: '#E2E8F0' }} />
                )}
              </div>
            ))}
          </div>

          <p className="text-center text-[9.5px] mt-3" style={{ color: '#CBD5E1' }}>
            &copy; 2026 TBInsight &mdash; Pasig City Tuberculosis Surveillance System
          </p>
        </footer>
      </div>
    </div>
  );
}
