import { useEffect, useRef } from 'react';
import { rememberPrivacyNoticeAccepted } from '../utils/privacyNotice';

// Shown before the landing page until the visitor accepts it (utils/privacyNotice.js remembers
// that per browser), and again from the "Privacy Notice" link in the landing footer.

const SECTIONS = [
  {
    icon: 'ri-database-2-line',
    title: 'What information is processed',
    body: 'Tuberculosis case records from the Pasig City Health Department: Case ID, barangay, health facility, dates of screening, diagnosis and treatment, age, sex, test results and treatment outcomes. Patient names and dates of birth are stored in the case registry and stay hidden unless an authorized user unlocks them with a personal Records PIN.',
  },
  {
    icon: 'ri-focus-3-line',
    title: 'Why it is processed',
    body: 'For TB surveillance and public-health planning only: monitoring cases, forecasting trends, identifying high-risk barangays, tracking treatment and medicine pickups, and planning interventions. TBInsight\'s dashboards and maps show combined figures per barangay, not individual patients.',
  },
  {
    icon: 'ri-shield-user-line',
    title: 'Who can access it',
    body: 'Only authorized health personnel with an account issued by an administrator. Staff see the patients of their assigned barangay; administrators have city-wide access. Sign-ins, record changes and identity unlocks are recorded in audit logs.',
  },
  {
    icon: 'ri-scales-3-line',
    title: 'Your responsibilities and rights',
    body: 'Use the information only for your official duties, and do not copy, share or disclose patient data outside them. Data subjects have rights under the Data Privacy Act of 2012 (Republic Act No. 10173), including the right to be informed, to access and to correct their information. Questions and requests go to the Pasig City Health Department.',
  },
];

/**
 * @param {() => void} onAccept   called when the visitor accepts
 * @param {() => void} [onClose]  when given (reopened from the footer), the notice can be
 *                                closed without accepting again
 */
export default function PrivacyNotice({ onAccept, onClose }) {
  const buttonRef = useRef(null);
  useEffect(() => { buttonRef.current?.focus(); }, []);
  useEffect(() => {
    if (!onClose) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const accept = () => { rememberPrivacyNoticeAccepted(); onAccept(); };

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center p-4" style={{ background: 'rgba(15,23,42,0.55)', backdropFilter: 'blur(6px)' }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="privacy-notice-title"
        className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white"
        style={{ boxShadow: '0 24px 64px rgba(15,23,42,0.3)' }}
      >
        <div className="flex items-start justify-between gap-4 px-6 py-5" style={{ background: '#0F2D52' }}>
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full" style={{ background: 'rgba(255,255,255,0.12)' }}>
              <i className="ri-shield-check-line text-xl text-white" aria-hidden="true" />
            </span>
            <div>
              <h2 id="privacy-notice-title" className="text-base font-bold text-white">Data Privacy Notice</h2>
              <p className="mt-0.5 text-[11px]" style={{ color: 'rgba(255,255,255,0.7)' }}>
                TBInsight — Pasig City Tuberculosis Surveillance System
              </p>
            </div>
          </div>
          {onClose && (
            <button type="button" onClick={onClose} aria-label="Close" className="text-white/70 hover:text-white">
              <i className="ri-close-line text-xl" />
            </button>
          )}
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
          <p className="text-[13px] leading-relaxed" style={{ color: '#334155' }}>
            This system processes personal and health information of tuberculosis patients. That information is
            sensitive personal information under the <b>Data Privacy Act of 2012 (RA 10173)</b>. Please read how it is
            handled before you continue.
          </p>
          {SECTIONS.map(s => (
            <section key={s.title} className="flex gap-3">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full" style={{ background: '#EFF6FF' }}>
                <i className={`${s.icon} text-sm`} style={{ color: '#1E40AF' }} aria-hidden="true" />
              </span>
              <div>
                <h3 className="text-[13px] font-bold" style={{ color: '#0F2D52' }}>{s.title}</h3>
                <p className="mt-1 text-xs leading-relaxed" style={{ color: '#475569' }}>{s.body}</p>
              </div>
            </section>
          ))}
        </div>

        <div className="flex flex-col-reverse gap-3 border-t px-6 py-4 sm:flex-row sm:items-center sm:justify-between" style={{ borderColor: '#E2E8F0' }}>
          <p className="text-[11px]" style={{ color: '#64748B' }}>
            By continuing, you confirm you have read this notice and will handle patient data accordingly.
          </p>
          <button
            ref={buttonRef}
            type="button"
            onClick={accept}
            className="shrink-0 rounded-lg px-5 py-2.5 text-[13px] font-semibold text-white transition-colors"
            style={{ background: '#0F2D52' }}
            onMouseEnter={e => { e.currentTarget.style.background = '#174A7E'; }}
            onMouseLeave={e => { e.currentTarget.style.background = '#0F2D52'; }}
          >
            I understand, continue
          </button>
        </div>
      </div>
    </div>
  );
}
