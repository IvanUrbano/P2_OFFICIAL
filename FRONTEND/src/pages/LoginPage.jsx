import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import API from '../api/axios';
import Logo from '../../components/Logo';

export default function LoginPage() {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [lockoutSeconds, setLockoutSeconds] = useState(0);
  const [activeField, setActiveField] = useState(null);
  const [showForgotModal, setShowForgotModal] = useState(false);
  const [forgotRole, setForgotRole] = useState('staff');
  const [resetEmail, setResetEmail] = useState('');
  const [resetNewPassword, setResetNewPassword] = useState('');
  const [resetStep, setResetStep] = useState(1);
  const [otpCode, setOtpCode] = useState('');
  const [generatedOtp, setGeneratedOtp] = useState('');
  const [otpTimer, setOtpTimer] = useState(60);
  const [otpError, setOtpError] = useState('');

  useEffect(() => {
    if (showForgotModal) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [showForgotModal]);

  useEffect(() => {
    if (resetStep !== 2 || otpTimer <= 0) return;
    const timer = setInterval(() => {
      setOtpTimer((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [resetStep, otpTimer]);

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
      localStorage.setItem('token', res.data.token);
      localStorage.setItem('user', JSON.stringify(res.data.user));
      navigate('/dashboard');
    } catch (err) {
      const isRateLimited = err.response?.status === 429;
      setError(err.response?.data?.error || 'Invalid email or password. Please try again.');
      if (isRateLimited && err.response?.data?.retryAfter) setLockoutSeconds(err.response.data.retryAfter);
    } finally {
      setLoading(false);
    }
  };

  const handleResetRequest = (e) => {
    e.preventDefault();
    const otp = String(Math.floor(100000 + Math.random() * 900000));
    setGeneratedOtp(otp);
    setOtpTimer(60);
    setResetStep(2);
  };

  const handleResendOtp = () => {
    const otp = String(Math.floor(100000 + Math.random() * 900000));
    setGeneratedOtp(otp);
    setOtpTimer(60);
    setOtpError('');
    setOtpCode('');
  };

  const handleVerifyOtp = (e) => {
    e.preventDefault();
    if (otpCode !== generatedOtp) {
      setOtpError('Invalid OTP code. Please try again.');
      return;
    }
    setOtpError('');
    setResetStep(3);
  };

  const handleResetConfirm = (e) => {
    e.preventDefault();
    setResetStep(4);
  };

  const closeForgotModal = () => {
    setShowForgotModal(false);
    setForgotRole('staff');
    setResetEmail('');
    setResetNewPassword('');
    setOtpCode('');
    setGeneratedOtp('');
    setOtpError('');
    setResetStep(1);
  };

  return (
    <div className="h-screen w-full flex overflow-hidden relative" style={{ background: '#f0f4f8' }}>

      {/* ─── Full Background Image ─── */}
      <div className="absolute inset-0 z-0">
        <img src="/images/BACKGROUND.png" alt="" className="w-full h-full" style={{ objectFit: 'cover', objectPosition: 'left bottom' }} />
      </div>

      {/* ─── Form Content ─── */}
      <div className="relative z-10 w-full flex items-center justify-center px-8">

        {/* White Card */}
        <div className="w-full max-w-[400px] p-8 rounded-2xl" style={{ background: 'rgba(255,255,255,0.35)', backdropFilter: 'blur(8px)', boxShadow: '0 8px 32px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.08)' }}>

          {/* Logo */}
          <div className="mb-4">
            <Logo width={100} />
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
            {/* Username */}
            <div>
              <input
                type="text" name="email" value={formData.email} onChange={handleChange} required
                disabled={lockoutSeconds > 0 || loading} placeholder="Username"
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

            {/* Password */}
            <div>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'} name="password" value={formData.password} onChange={handleChange} required
                  disabled={lockoutSeconds > 0 || loading} placeholder="Password"
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
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" className="w-3.5 h-3.5 rounded accent-[#0F2D52]" />
                <span className="text-[12px] font-medium" style={{ color: '#64748B' }}>Remember me</span>
              </label>
              <button type="button" onClick={() => setShowForgotModal(true)}
                className="text-[12px] font-semibold transition-colors"
                style={{ color: '#0F2D52' }}
                onMouseEnter={(e) => e.currentTarget.style.color = '#174A7E'}
                onMouseLeave={(e) => e.currentTarget.style.color = '#0F2D52'}>
                Forgot Password?
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

          <div className="mt-5 text-center">
            <p className="text-[10px] font-semibold" style={{ color: '#94A3B8' }}><i className="ri-shield-check-line mr-1" />Authorized users only</p>
            <p className="text-[9px] mt-1" style={{ color: '#CBD5E1' }}>&copy; 2026 TBInsight</p>
          </div>
        </div>
      </div>

      {/* ═══════ Forgot Password Modal ═══════ */}
      {showForgotModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          style={{ background: 'rgba(10,22,40,0.6)', backdropFilter: 'blur(4px)' }}
          onClick={closeForgotModal}>
          <div className="w-full max-w-[480px] max-h-[90vh] overflow-y-auto no-scrollbar relative rounded-2xl"
            style={{ background: '#ffffff', boxShadow: '0 25px 60px rgba(0,0,0,0.25)' }}
            onClick={(e) => e.stopPropagation()}>
            <button onClick={closeForgotModal}
              className="absolute top-4 right-4 z-10 w-8 h-8 rounded-lg flex items-center justify-center transition-colors"
              style={{ background: 'rgba(0,0,0,0.08)', color: '#64748B', border: '1px solid rgba(0,0,0,0.1)' }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(0,0,0,0.15)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(0,0,0,0.08)'; }}>
              <i className="ri-close-line text-base" />
            </button>

            <div className="px-8 pt-8 pb-4">
              <h2 className="text-xl font-extrabold mb-1" style={{ color: '#0F2D52' }}>Forgot Password?</h2>
              <p className="text-[13px]" style={{ color: '#94A3B8' }}>Select your account role to see the appropriate reset process.</p>
            </div>

            <div className="px-8">
              <div className="flex gap-2 p-1 rounded-lg" style={{ background: '#F1F5F9' }}>
                {[
                  { id: 'staff', label: 'Staff', icon: 'ri-user-line' },
                  { id: 'admin', label: 'Administrator', icon: 'ri-shield-keyhole-line' },
                ].map((role) => (
                  <button key={role.id} onClick={() => { setForgotRole(role.id); setResetStep(1); setResetEmail(''); setResetNewPassword(''); setOtpCode(''); setOtpError(''); }}
                    className="flex-1 py-2.5 rounded-lg text-[13px] font-semibold flex items-center justify-center gap-2 transition-all duration-200"
                    style={{ background: forgotRole === role.id ? '#ffffff' : 'transparent', color: forgotRole === role.id ? '#0F2D52' : '#94A3B8', boxShadow: forgotRole === role.id ? '0 2px 8px rgba(0,0,0,0.06)' : 'none' }}>
                    <i className={`${role.icon} text-base`} />{role.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="px-8 py-6">
              <p className="text-[11px] font-bold uppercase tracking-wider mb-4" style={{ color: '#94A3B8' }}>
                <i className="ri-lock-password-line mr-1" />Password Recovery — {forgotRole === 'admin' ? 'Administrator' : 'Staff'}
              </p>

              <div className="flex items-center gap-1.5 mb-5">
                {['Enter Email', 'Verify OTP', 'New Password', 'Done'].map((label, i) => (
                  <div key={i} className="flex items-center gap-1.5 flex-1">
                    <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 transition-all duration-300"
                      style={{ background: resetStep > i + 1 ? '#10B981' : resetStep === i + 1 ? '#0F2D52' : '#E2E8F0', color: resetStep >= i + 1 ? 'white' : '#94A3B8' }}>
                      {resetStep > i + 1 ? <i className="ri-check-line" /> : i + 1}
                    </div>
                    {i < 3 && <div className="flex-1 h-[2px] rounded-full" style={{ background: resetStep > i + 1 ? '#10B981' : '#E2E8F0' }} />}
                  </div>
                ))}
              </div>

              {resetStep === 1 && (
                <form onSubmit={handleResetRequest} className="space-y-4">
                  <div>
                    <label className="block text-[11px] font-bold mb-1.5 uppercase tracking-widest" style={{ color: '#94A3B8' }}>Registered email address</label>
                    <input type="email" required value={resetEmail} onChange={(e) => setResetEmail(e.target.value)}
                      placeholder="you@pasigcity.gov.ph"
                      className="w-full px-4 py-3 rounded-lg text-[13px] font-medium outline-none transition-all"
                      style={{ background: '#F8FAFC', border: '1.5px solid #E2E8F0', color: '#0F2D52' }}
                      onFocus={(e) => { e.target.style.borderColor = '#0F2D52'; }}
                      onBlur={(e) => { e.target.style.borderColor = '#E2E8F0'; }} />
                  </div>
                  <button type="submit"
                    className="w-full py-3 rounded-lg font-bold text-[13px] text-white transition-all duration-200 flex items-center justify-center gap-2"
                    style={{ background: '#0F2D52', boxShadow: '0 4px 14px rgba(15,45,82,0.2)' }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = '#174A7E'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = '#0F2D52'; }}>
                    <i className="ri-mail-send-line text-base" /> Send OTP Code
                  </button>
                </form>
              )}

              {resetStep === 2 && (
                <form onSubmit={handleVerifyOtp} className="space-y-4">
                  <div className="text-center mb-2">
                    <div className="w-12 h-12 rounded-2xl mx-auto mb-3 flex items-center justify-center" style={{ background: 'rgba(15,45,82,0.08)' }}>
                      <i className="ri-mail-check-line text-xl" style={{ color: '#0F2D52' }} />
                    </div>
                    <p className="text-[13px]" style={{ color: '#64748B' }}>A 6-digit code has been sent to</p>
                    <p className="text-[13px] font-bold" style={{ color: '#0F2D52' }}>{resetEmail}</p>
                    <p className="text-[11px] mt-1" style={{ color: '#94A3B8' }}>Check your console for the OTP code</p>
                  </div>
                  {otpError && (
                     <div className="px-3 py-2 rounded-lg text-[12px] flex items-center gap-2 border" style={{ background: '#FEF2F2', borderColor: '#FECACA', color: '#991B1B' }}>
                      <i className="ri-error-warning-line text-sm" />{otpError}
                    </div>
                  )}
                  <div>
                    <label className="block text-[11px] font-bold mb-1.5 uppercase tracking-widest" style={{ color: '#94A3B8' }}>Enter OTP code</label>
                    <input type="text" required maxLength={6} placeholder="000000" value={otpCode} onChange={(e) => { setOtpCode(e.target.value.replace(/\D/g, '')); setOtpError(''); }}
                      className="w-full px-4 py-3 rounded-lg text-[13px] font-medium outline-none transition-all text-center tracking-[0.3em]"
                      style={{ background: '#F8FAFC', border: '1.5px solid #E2E8F0', color: '#0F2D52', fontSize: '18px' }}
                      onFocus={(e) => { e.target.style.borderColor = '#0F2D52'; }}
                      onBlur={(e) => { e.target.style.borderColor = '#E2E8F0'; }} />
                  </div>
                  <button type="submit" className="w-full py-3 rounded-lg font-bold text-[13px] text-white transition-all duration-200" style={{ background: '#0F2D52' }}>
                    Verify Code
                  </button>
                  <p className="text-center text-[12px]" style={{ color: '#94A3B8' }}>
                    {otpTimer > 0 ? (<span>Resend code in <span className="font-bold" style={{ color: '#0F2D52' }}>{otpTimer}s</span></span>)
                      : (<button type="button" onClick={handleResendOtp} className="font-semibold" style={{ color: '#0F2D52' }}>Resend OTP Code</button>)}
                  </p>
                </form>
              )}

              {resetStep === 3 && (
                <form onSubmit={handleResetConfirm} className="space-y-4">
                  <div className="text-center mb-2">
                    <div className="w-12 h-12 rounded-2xl mx-auto mb-3 flex items-center justify-center" style={{ background: 'rgba(16,185,129,0.08)' }}>
                      <i className="ri-lock-password-line text-xl" style={{ color: '#10B981' }} />
                    </div>
                    <p className="text-[13px] font-bold" style={{ color: '#0F2D52' }}>Create New Password</p>
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold mb-1.5 uppercase tracking-widest" style={{ color: '#94A3B8' }}>New password</label>
                    <input type="password" required minLength={6} value={resetNewPassword} onChange={(e) => setResetNewPassword(e.target.value)}
                      placeholder="Min. 6 characters"
                      className="w-full px-4 py-3 rounded-lg text-[13px] font-medium outline-none transition-all"
                      style={{ background: '#F8FAFC', border: '1.5px solid #E2E8F0', color: '#0F2D52' }}
                      onFocus={(e) => { e.target.style.borderColor = '#10B981'; }}
                      onBlur={(e) => { e.target.style.borderColor = '#E2E8F0'; }} />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold mb-1.5 uppercase tracking-widest" style={{ color: '#94A3B8' }}>Confirm password</label>
                    <input type="password" required minLength={6} placeholder="Re-enter password"
                      className="w-full px-4 py-3 rounded-lg text-[13px] font-medium outline-none transition-all"
                      style={{ background: '#F8FAFC', border: '1.5px solid #E2E8F0', color: '#0F2D52' }}
                      onFocus={(e) => { e.target.style.borderColor = '#10B981'; }}
                      onBlur={(e) => { e.target.style.borderColor = '#E2E8F0'; }} />
                  </div>
                  <button type="submit" className="w-full py-3 rounded-lg font-bold text-[13px] text-white transition-all duration-200" style={{ background: '#10B981', boxShadow: '0 4px 14px rgba(16,185,129,0.25)' }}>
                    <i className="ri-check-line mr-1" /> Reset Password
                  </button>
                </form>
              )}

              {resetStep === 4 && (
                <div className="text-center py-4">
                  <div className="w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center" style={{ background: 'rgba(16,185,129,0.1)' }}>
                    <i className="ri-check-double-line text-2xl" style={{ color: '#10B981' }} />
                  </div>
                  <h3 className="text-base font-bold mb-1" style={{ color: '#0F2D52' }}>Password Reset Successfully</h3>
                  <p className="text-[13px] mb-5" style={{ color: '#94A3B8' }}>Your password has been updated. You can now sign in with your new credentials.</p>
                  <button onClick={closeForgotModal} className="px-6 py-2.5 rounded-lg font-bold text-[13px] text-white transition-all" style={{ background: '#0F2D52' }}>
                    <i className="ri-login-box-line mr-1" /> Back to Login
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
