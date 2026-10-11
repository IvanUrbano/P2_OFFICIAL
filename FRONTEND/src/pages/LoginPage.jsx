import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import API from '../api/axios';
import { PASIG_CLONE_URL } from '../config/externalSystems';
import ModalCloseButton from '../components/ModalCloseButton';
import { getPrefs } from '../utils/preferences';

export default function LoginPage() {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [lockoutSeconds, setLockoutSeconds] = useState(0);
  const [activeField, setActiveField] = useState(null);
  const [showForgotModal, setShowForgotModal] = useState(false);
  const [showPasswordResetNotice, setShowPasswordResetNotice] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);

  useEffect(() => {
    const savedEmail = localStorage.getItem('tbinsight_remember_me');
    if (savedEmail) {
      setFormData((prev) => ({ ...prev, email: savedEmail }));
      setRememberMe(true);
    }
  }, []);

  useEffect(() => {
    if (lockoutSeconds <= 0) return;
    const timer = setInterval(() => {
      setLockoutSeconds((prev) => {
        if (prev <= 1) { setError(''); return 0; }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [lockoutSeconds]);

  const formatLockoutTime = (s) => `${Math.floor(s / 60)}m ${s % 60}s`;

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
    if (lockoutSeconds === 0) setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (lockoutSeconds > 0) return;
    setLoading(true);
    setError('');
    try {
      const res = await API.post('/api/auth/login', formData);
      if (rememberMe) {
        localStorage.setItem('tbinsight_remember_me', formData.email);
      } else {
        localStorage.removeItem('tbinsight_remember_me');
      }
      localStorage.setItem('user', JSON.stringify(res.data.user));
      if (res.data.csrfToken) {
        sessionStorage.setItem('csrf_token', res.data.csrfToken);
      }
      if (res.data.passwordRecentlyChanged) {
        setShowPasswordResetNotice(true);
      } else {
        navigate(getPrefs().landingPage);
      }
    } catch (err) {
      const status = err.response?.status;
      const data = err.response?.data;
      setError(data?.error || 'Invalid credentials. Please try again.');
      if (status === 429 && data?.retryAfter) {
        setLockoutSeconds(data.retryAfter);
      } else if (status === 423 && data?.retryAfter) {
        setLockoutSeconds(data.retryAfter);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-screen w-full flex overflow-hidden relative" style={{ background: '#f0f4f8' }}>

      <div className="absolute inset-0 z-0">
        <img src="/images/tbinsight-bg.png" alt="" className="w-full h-full" style={{ objectFit: 'cover', objectPosition: 'center 60%' }} />
      </div>

      <div className="relative z-10 w-full flex items-center justify-center px-4">
        <div className="w-full max-w-[400px] p-8" style={{ background: '#ffffff', borderRadius: '5px', boxShadow: '0 8px 32px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.08)' }}>

          <div className="mb-5 flex flex-col items-center text-center">
            <img
              src="/images/tbinsight-icon.png"
              alt="TBInsight logo"
              className="h-24 w-24 shrink-0 object-contain"
            />
            <div className="mt-2">
              <h1 className="text-[15px] font-extrabold leading-tight" style={{ color: '#0F2D52' }}>TBInsight</h1>
              <p className="mt-0.5 text-[11px]" style={{ color: '#94A3B8' }}>Pasig City TB Surveillance</p>
            </div>
          </div>

          <div className="mb-4">
            <h2 className="text-xl font-extrabold tracking-tight" style={{ color: '#0F2D52' }}>Welcome Back</h2>
            <p className="text-[13px] mt-1" style={{ color: '#94A3B8' }}>Sign in to access TBInsight</p>
          </div>

          {error && (
            <div className="mb-3 px-3 py-2 rounded-lg text-[12px] flex items-center gap-2" style={{ background: '#FEF2F2', color: '#991B1B' }}>
              <i className="ri-error-warning-line text-sm flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-[11px] font-bold mb-1.5 uppercase tracking-wide" style={{ color: '#64748B' }}>Username or Email</label>
              <input
                type="text" name="email" value={formData.email} onChange={handleChange} required
                disabled={lockoutSeconds > 0 || loading} placeholder="Enter username or email"
                onFocus={() => setActiveField('email')} onBlur={() => setActiveField(null)}
                autoComplete="off"
                className="w-full py-2.5 text-[13px] font-medium outline-none disabled:opacity-40 placeholder-gray-400 login-input"
                style={{
                  background: 'transparent',
                  border: 'none',
                  borderBottom: `2px solid ${activeField === 'email' ? '#0F2D52' : '#E2E8F0'}`,
                  borderRadius: 0,
                  color: '#0F2D52',
                  WebkitBoxShadow: 'none',
                  transition: 'border-color 0.2s',
                }}
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold mb-1.5 uppercase tracking-wide" style={{ color: '#64748B' }}>Password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'} name="password" value={formData.password} onChange={handleChange} required
                  disabled={lockoutSeconds > 0 || loading} placeholder="Enter password"
                  onFocus={() => setActiveField('password')} onBlur={() => setActiveField(null)}
                  autoComplete="off"
                  className="w-full py-2.5 pr-8 text-[13px] font-medium outline-none disabled:opacity-40 placeholder-gray-400 login-input"
                  style={{
                    background: 'transparent',
                    border: 'none',
                    borderBottom: `2px solid ${activeField === 'password' ? '#0F2D52' : '#E2E8F0'}`,
                    borderRadius: 0,
                    color: '#0F2D52',
                    WebkitBoxShadow: 'none',
                    transition: 'border-color 0.2s',
                  }}
                />
                <button type="button" onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-0 top-1/2 -translate-y-1/2 transition-colors"
                  style={{ color: '#94A3B8' }}
                  onMouseEnter={(e) => e.currentTarget.style.color = '#0F2D52'}
                  onMouseLeave={(e) => e.currentTarget.style.color = '#94A3B8'}>
                  <i className={`${showPassword ? 'ri-eye-off-line' : 'ri-eye-line'} text-[15px]`} />
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between pt-1">
              <label className="flex items-center gap-2 cursor-pointer select-none text-[12px] font-medium" style={{ color: '#64748B' }}>
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300 accent-[#0F2D52] cursor-pointer"
                />
                <span>Remember username</span>
              </label>
              <button
                type="button"
                onClick={() => setShowForgotModal(true)}
                className="text-[12px] font-medium transition-colors cursor-pointer"
                style={{ color: '#2E6FAF' }}
                onMouseEnter={(e) => e.currentTarget.style.color = '#0F2D52'}
                onMouseLeave={(e) => e.currentTarget.style.color = '#2E6FAF'}
              >
                Forgot password?
              </button>
            </div>

            <button type="submit" disabled={loading || lockoutSeconds > 0}
              className="w-full py-3 rounded-lg font-bold text-[13px] transition-all duration-200 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                background: lockoutSeconds > 0 ? '#F59E0B' : '#0F2D52',
                color: '#ffffff',
                boxShadow: '0 4px 14px rgba(15,45,82,0.25)',
              }}
              onMouseEnter={(e) => { if (!loading && lockoutSeconds <= 0) e.currentTarget.style.background = '#174A7E'; }}
              onMouseLeave={(e) => { if (!loading && lockoutSeconds <= 0) e.currentTarget.style.background = '#0F2D52'; }}>
              {lockoutSeconds > 0 ? (<><i className="ri-lock-line text-sm" /> Locked ({formatLockoutTime(lockoutSeconds)})</>)
                : loading ? (<><i className="ri-loader-4-line text-sm animate-spin" /> Signing in...</>)
                  : 'Sign In'}
            </button>
          </form>

          <a
            href={PASIG_CLONE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 w-full py-2.5 rounded-lg font-semibold text-[12px] flex items-center justify-center gap-2 transition-colors"
            style={{ border: '1px solid #E2E8F0', color: '#2E6FAF', background: '#ffffff' }}
            onMouseEnter={(e) => { e.currentTarget.style.background = '#F8FAFC'; e.currentTarget.style.color = '#0F2D52'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = '#ffffff'; e.currentTarget.style.color = '#2E6FAF'; }}
          >
            <i className="ri-upload-cloud-2-line text-sm" />
            Go to Pasig Clone (data import)
            <i className="ri-external-link-line text-xs" />
          </a>

          <div className="mt-5 text-center">
            <p className="text-[10px] font-semibold" style={{ color: '#94A3B8' }}>Authorized users only</p>
            <p className="text-[9px] mt-1" style={{ color: '#CBD5E1' }}>&copy; 2026 TBInsight</p>
          </div>
        </div>
      </div>

      {showForgotModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[2px]" onClick={() => setShowForgotModal(false)}>
          <div className="bg-white border border-gray-200 shadow-xl w-full max-w-[380px] mx-4 overflow-hidden" style={{ borderRadius: '5px' }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100" style={{ background: '#FAFCFF' }}>
              <div className="flex items-center gap-2">
                <i className="ri-information-line text-lg" style={{ color: '#0F2D52' }} />
                <h3 className="text-sm font-bold" style={{ color: '#0F2D52' }}>Password Reset Assistance</h3>
              </div>
              <ModalCloseButton onClick={() => setShowForgotModal(false)} />
            </div>

            <div className="p-5 space-y-3">
              <p className="text-[13px] leading-relaxed" style={{ color: '#475569' }}>
                Self-service password resets are restricted for security purposes.
              </p>

              <div className="p-3 border text-[12px] space-y-1" style={{ background: '#F8FAFC', borderColor: '#E2E8F0', color: '#334155', borderRadius: '5px' }}>
                <div className="font-semibold flex items-center gap-1.5" style={{ color: '#0F2D52' }}>

                  <span>Administrator Action Required</span>
                </div>
                <p className="text-[11px] leading-relaxed text-gray-500">
                  Please contact your System Administrator to reset your password or issue temporary login credentials from the User Management console.
                </p>
              </div>
            </div>

            <div className="px-5 py-3.5 bg-gray-50 border-t border-gray-100 flex justify-end">
              <button
                onClick={() => setShowForgotModal(false)}
                className="px-5 py-2 font-bold text-[12px] transition-colors cursor-pointer"
                style={{ background: '#0F2D52', color: '#ffffff', borderRadius: '5px' }}
                onMouseEnter={(e) => e.currentTarget.style.background = '#174A7E'}
                onMouseLeave={(e) => e.currentTarget.style.background = '#0F2D52'}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {showPasswordResetNotice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[2px]">
          <div className="bg-white border border-gray-200 shadow-xl w-full max-w-[380px] mx-4 overflow-hidden" style={{ borderRadius: '5px' }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100" style={{ background: '#FAFCFF' }}>
              <div className="flex items-center gap-2">
                <i className="ri-shield-keyhole-line text-lg" style={{ color: '#0F2D52' }} />
                <h3 className="text-sm font-bold" style={{ color: '#0F2D52' }}>Password Recently Reset</h3>
              </div>
              <ModalCloseButton onClick={() => { setShowPasswordResetNotice(false); navigate(getPrefs().landingPage); }} />
            </div>

            <div className="p-5 space-y-3">
              <p className="text-[13px] leading-relaxed" style={{ color: '#475569' }}>
                Your password was recently reset by a system administrator.
              </p>

              <div className="p-3 border text-[12px] space-y-1" style={{ background: '#F8FAFC', borderColor: '#E2E8F0', color: '#334155', borderRadius: '5px' }}>
                <p className="text-[11px] leading-relaxed text-gray-500">
                  For your security, we recommend updating your password to a new private password in Account Settings.
                </p>
              </div>
            </div>

            <div className="px-5 py-3.5 bg-gray-50 border-t border-gray-100 flex justify-end">
              <button
                onClick={() => { setShowPasswordResetNotice(false); navigate(getPrefs().landingPage); }}
                className="px-5 py-2 font-bold text-[12px] transition-colors cursor-pointer"
                style={{ background: '#0F2D52', color: '#ffffff', borderRadius: '5px' }}
                onMouseEnter={(e) => e.currentTarget.style.background = '#174A7E'}
                onMouseLeave={(e) => e.currentTarget.style.background = '#0F2D52'}
              >
                Continue to Dashboard
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
