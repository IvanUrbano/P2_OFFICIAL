import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import PrivacyNotice from '../components/PrivacyNotice';
import { privacyNoticeAccepted } from '../utils/privacyNotice';
import { PASIG_CLONE_URL } from '../config/externalSystems';
import Logo from '../../components/Logo';

const FEATURES = [
  { icon: 'ri-map-pin-line', effect: 'pin', title: 'GIS', desc: 'Visualize and track TB cases geographically' },
  { icon: 'ri-bar-chart-grouped-line', effect: 'chart', title: 'Analytics', desc: 'Turn data into actionable insights' },
  { icon: 'ri-notification-3-line', effect: 'alert', title: 'Alert', desc: 'Detect and respond to risks early' },
  { icon: 'ri-dashboard-3-line', effect: 'dashboard', title: 'Dashboard', desc: 'Monitor progress in real time' },
  { icon: 'ri-stethoscope-line', effect: 'intervention', title: 'Intervention Planning', desc: 'Plan targeted and effective interventions' },
];

export default function LandingPage() {
  const navigate = useNavigate();
  // 'required' until accepted in this browser (shown before the page); 'review' when reopened.
  const [notice, setNotice] = useState(() => (privacyNoticeAccepted() ? null : 'required'));

  const handleSelect = (system) => {
    if (system === 'tbinsight') {
      navigate('/login');
    } else {
      window.location.href = `${PASIG_CLONE_URL}/login`;
    }
  };

  return (
    <>
    {notice && <PrivacyNotice onAccept={() => setNotice(null)} onClose={notice === 'review' ? () => setNotice(null) : undefined} />}
    <div
      aria-hidden={notice === 'required' || undefined}
      className={`landing-page ${notice === 'required' ? 'landing-motion-paused' : ''} h-screen w-full flex flex-col overflow-hidden relative`}
    >
      <div className="landing-background" aria-hidden="true" />
      <div className="landing-radar landing-radar-one" aria-hidden="true" />
      <div className="landing-radar landing-radar-two" aria-hidden="true" />

      <div className="relative z-10 flex flex-col h-full">

        {/* ─── Top Nav: Logo ─── */}
        <nav className="landing-reveal landing-reveal-logo w-full px-10 lg:px-20 py-4 flex-shrink-0">
          <Logo width={86} />
        </nav>

        {/* ─── Hero ─── */}
        <main className="flex-1 flex flex-col justify-center px-10 lg:px-20 max-w-[1400px] w-full">

          <div className="landing-reveal landing-reveal-eyebrow flex items-center gap-2.5 mb-4">
            <div className="w-[3px] h-5 rounded-full" style={{ background: '#2E6FAF' }} />
            <span
              className="text-[10px] font-semibold tracking-[0.12em] uppercase"
              style={{ color: '#2E6FAF' }}
            >
              Data-Driven Tuberculosis Intelligence
            </span>
          </div>

          <h1
            className="landing-reveal landing-reveal-heading text-[2.2rem] md:text-[2.8rem] lg:text-[3.1rem] font-extrabold leading-[1.1] tracking-tight max-w-lg"
            style={{ color: '#0F2D52' }}
          >
            Understand TB.
            <br />
            <span className="landing-headline-highlight" style={{ color: '#2E6FAF' }}>
              Predict Risks.
            </span>
            <br />
            Take Action.
          </h1>

          <p
            className="landing-reveal landing-reveal-copy mt-4 text-[13px] leading-[1.75] max-w-[420px]"
            style={{ color: '#64748B', letterSpacing: '0.01em' }}
          >
            TBInsight transforms tuberculosis data into clear, actionable insights.
            Combining advanced analytics, predictive forecasting, GIS priority mapping,
            risk classification, and automated reporting — it empowers health professionals
            to anticipate risks and take timely, evidence-based action.
          </p>

          <div className="landing-reveal landing-reveal-actions mt-6 flex items-center gap-3">
            <button
              onClick={() => handleSelect('tbinsight')}
              className="landing-cta landing-cta-primary group flex items-center gap-2 px-6 py-2.5 rounded-lg text-[13px] font-semibold cursor-pointer"
            >
              Explore TBInsight
              <i className="ri-arrow-right-line text-sm transition-transform duration-200 group-hover:translate-x-1" />
            </button>

            <button
              onClick={() => handleSelect('pasig-clone')}
              className="landing-cta landing-cta-secondary group flex items-center gap-2 px-6 py-2.5 rounded-lg text-[13px] font-semibold cursor-pointer"
            >
              Explore Pasig TB-IS
              <i className="ri-arrow-right-line text-sm transition-transform duration-200 group-hover:translate-x-1" />
            </button>
          </div>
        </main>

        {/* ─── Feature Highlights ─── */}
        <footer className="flex-shrink-0 w-full px-10 lg:px-20 pb-5 pt-3 max-w-[1400px]">
          {/* Divider */}
          <div className="landing-divider w-[718px] max-w-full h-px mb-4" style={{ background: '#E2E8F0' }} />

          <div className="flex items-start gap-0">
            {FEATURES.map((f, i) => (
              <div
                key={f.title}
                className="landing-feature-wrap flex items-start"
                style={{ '--feature-index': i }}
              >
                <div className="landing-feature flex flex-col items-center text-center gap-1.5 w-[130px]">
                  <div
                    className="landing-feature-icon w-9 h-9 rounded-full flex items-center justify-center"
                    style={{ background: '#EFF6FF' }}
                  >
                    <i className={`${f.icon} landing-icon-${f.effect} text-sm`} style={{ color: '#1E40AF' }} />
                  </div>
                  <h4 className="text-[11.5px] font-bold leading-tight" style={{ color: '#1E3A5F' }}>
                    {f.title}
                  </h4>
                  <p className="text-[10px] leading-snug px-1" style={{ color: '#64748B' }}>
                    {f.desc}
                  </p>
                </div>
                {i < FEATURES.length - 1 && (
                  <div className="h-14 w-px mx-2 mt-2 flex-shrink-0" style={{ background: '#E2E8F0' }} />
                )}
              </div>
            ))}
          </div>

          <p className="text-center text-[10px] mt-3" style={{ color: '#64748B' }}>
            &copy; 2026 TBInsight &mdash; Pasig City Tuberculosis Surveillance System
            {' · '}
            <button type="button" onClick={() => setNotice('review')} className="underline hover:text-[#64748B]">Privacy Notice</button>
          </p>
        </footer>
      </div>
    </div>
    </>
  );
}
