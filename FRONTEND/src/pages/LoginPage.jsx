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

  // OTP countdown timer
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

  // ── Forgot Password Handlers ──
  const handleResetRequest = (e) => {
    e.preventDefault();
    // Generate a 6-digit OTP
    const otp = String(Math.floor(100000 + Math.random() * 900000));
    setGeneratedOtp(otp);
    console.log(`[OTP] Password reset code for ${resetEmail}: ${otp}`);
    setOtpTimer(60);
    setResetStep(2);
  };

  const handleResendOtp = () => {
    const otp = String(Math.floor(100000 + Math.random() * 900000));
    setGeneratedOtp(otp);
    console.log(`[OTP] Resent code for ${resetEmail}: ${otp}`);
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

  const features = [
    'Real-time TB Monitoring',
    'ARIMA Forecasting',
    'GIS Hotspot Mapping',
    'Resource Prioritization',
    'Analytics & Reports',
  ];

  return (
    <div className="h-screen w-full flex flex-col overflow-hidden" style={{ background: '#f5f7fa' }}>

      {/* ═══════ Main Content ═══════ */}
      <div className="flex-1 flex min-h-0">

        {/* ─── LEFT — Form Panel ─── */}
        <div className="w-full lg:w-[480px] xl:w-[520px] flex flex-col justify-center px-8 sm:px-12 lg:px-16 relative z-20 flex-shrink-0 overflow-hidden"
          style={{ background: 'white' }}>

          <div className="w-full max-w-sm mx-auto py-8">

            {/* Logo + Brand */}
            <div className="flex items-center gap-3 mb-4">
              <div className="w-11 h-11 rounded-2xl flex items-center justify-center"
                style={{ background: 'linear-gradient(135deg, #0F2D52, #2E6FAF)', boxShadow: '0 4px 16px rgba(15,45,82,0.2)' }}>
                <Logo size={26} />
              </div>
              <div>
                <span className="text-xl font-extrabold tracking-tight block" style={{ color: '#0F2D52' }}>TBInsight</span>
                <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: '#94A3B8' }}>Pasig City Health Office</span>
              </div>
            </div>

            <div className="h-px w-full my-6" style={{ background: 'linear-gradient(90deg, #0066FF, #e2e8f0)' }} />

            <h1 className="text-[28px] font-extrabold tracking-tight mb-1.5" style={{ color: '#0F2D52' }}>Welcome Back!</h1>
            <p className="text-[15px] font-semibold mb-1" style={{ color: '#334155' }}>Log in to your account</p>
            <p className="text-[13px] leading-relaxed mb-8" style={{ color: '#94A3B8' }}>
              Access the TBInsight platform to monitor, analyze, and manage tuberculosis surveillance data, forecasting, hotspot mapping, and resource prioritization across Pasig City.
            </p>

            {error && (
              <div className="mb-6 px-4 py-3.5 rounded-2xl text-sm flex items-center gap-3 border bg-red-50 border-red-200 text-red-600">
                <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 bg-red-100">
                  <i className="ri-error-warning-line text-sm" />
                </div>
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="block text-[11px] font-bold mb-2 uppercase tracking-widest" style={{ color: '#94A3B8' }}>Email</label>
                <div className="relative group">
                  <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-0 rounded-full transition-all duration-300 group-focus-within:h-5"
                    style={{ background: activeField === 'email' ? '#0066FF' : 'transparent' }} />
                  <input type="email" name="email" value={formData.email} onChange={handleChange} required
                    disabled={lockoutSeconds > 0 || loading} placeholder="you@example.com"
                    onFocus={() => setActiveField('email')} onBlur={() => setActiveField(null)}
                    className="w-full pl-5 pr-4 py-3.5 rounded-xl text-sm font-medium outline-none transition-all duration-300 disabled:opacity-40"
                    style={{ background: activeField === 'email' ? '#f0f7ff' : '#f8fafc', border: `1.5px solid ${activeField === 'email' ? '#0066FF' : '#e2e8f0'}`, color: '#0f172a' }} />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold mb-2 uppercase tracking-widest" style={{ color: '#94A3B8' }}>Password</label>
                <div className="relative group">
                  <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-0 rounded-full transition-all duration-300 group-focus-within:h-5"
                    style={{ background: activeField === 'password' ? '#0066FF' : 'transparent' }} />
                  <input type={showPassword ? 'text' : 'password'} name="password" value={formData.password} onChange={handleChange} required
                    disabled={lockoutSeconds > 0 || loading} placeholder="Enter your password"
                    onFocus={() => setActiveField('password')} onBlur={() => setActiveField(null)}
                    className="w-full pl-5 pr-12 py-3.5 rounded-xl text-sm font-medium outline-none transition-all duration-300 disabled:opacity-40"
                    style={{ background: activeField === 'password' ? '#f0f7ff' : '#f8fafc', border: `1.5px solid ${activeField === 'password' ? '#0066FF' : '#e2e8f0'}`, color: '#0f172a' }} />
                  <button type="button" onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 transition-colors duration-200"
                    style={{ color: '#cbd5e1' }}
                    onMouseEnter={(e) => e.currentTarget.style.color = '#64748B'}
                    onMouseLeave={(e) => e.currentTarget.style.color = '#cbd5e1'}>
                    <i className={`${showPassword ? 'ri-eye-off-line' : 'ri-eye-line'} text-lg`} />
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between pt-0.5">
                <label className="flex items-center gap-2.5 cursor-pointer group">
                  <div className="relative">
                    <input type="checkbox" className="sr-only peer" />
                    <div className="w-4 h-4 rounded border-2 transition-all duration-200 flex items-center justify-center peer-checked:border-[#0066FF] peer-checked:bg-[#0066FF]"
                      style={{ borderColor: '#d1d5db' }}>
                      <i className="ri-check-line text-[10px] text-white opacity-0 peer-checked:opacity-100 transition-opacity" />
                    </div>
                  </div>
                  <span className="text-[13px] font-medium" style={{ color: '#64748B' }}>Remember me</span>
                </label>
                <button type="button" onClick={() => setShowForgotModal(true)}
                  className="text-[13px] font-semibold transition-colors duration-200"
                  style={{ color: '#0066FF' }}
                  onMouseEnter={(e) => e.currentTarget.style.color = '#0052cc'}
                  onMouseLeave={(e) => e.currentTarget.style.color = '#0066FF'}>
                  Forgot password?
                </button>
              </div>

              <button type="submit" disabled={loading || lockoutSeconds > 0}
                className="w-full py-3.5 rounded-xl font-bold text-[15px] text-white transition-all duration-300 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ background: lockoutSeconds > 0 ? 'linear-gradient(135deg, #F59E0B, #D97706)' : 'linear-gradient(135deg, #0F2D52 0%, #2E6FAF 100%)', boxShadow: lockoutSeconds > 0 ? '0 4px 20px rgba(245,158,11,0.3)' : '0 4px 20px rgba(15,45,82,0.25)' }}
                onMouseEnter={(e) => { if (!loading && lockoutSeconds <= 0) { e.currentTarget.style.boxShadow = '0 8px 30px rgba(15,45,82,0.35)'; e.currentTarget.style.transform = 'translateY(-1px)'; } }}
                onMouseLeave={(e) => { e.currentTarget.style.boxShadow = lockoutSeconds > 0 ? '0 4px 20px rgba(245,158,11,0.3)' : '0 4px 20px rgba(15,45,82,0.25)'; e.currentTarget.style.transform = 'translateY(0)'; }}>
                {lockoutSeconds > 0 ? (<><i className="ri-lock-line text-lg" /> Locked out ({formatLockoutTime(lockoutSeconds)})</>)
                  : loading ? (<><i className="ri-loader-4-line text-lg animate-spin" /> Signing in...</>)
                    : (<>Sign In <i className="ri-arrow-right-up-line text-lg" /></>)}
              </button>
            </form>

            <p className="text-center text-[13px] mt-8" style={{ color: '#94A3B8' }}>
              Don't have an account?{' '}
              <a href="mailto:admin@pasigcity.gov.ph" className="font-semibold transition-colors" style={{ color: '#0066FF' }}
                onMouseEnter={(e) => e.target.style.color = '#0052cc'}
                onMouseLeave={(e) => e.target.style.color = '#0066FF'}>
                Contact your system administrator
              </a>
            </p>
            <div className="flex items-center justify-center gap-4 mt-3">
              <div className="flex items-center gap-1.5">
                <i className="ri-mail-line text-[11px]" style={{ color: '#94A3B8' }} />
                <span className="text-[11px]" style={{ color: '#94A3B8' }}>admin@pasigcity.gov.ph</span>
              </div>
              <div className="w-px h-3" style={{ background: '#e2e8f0' }} />
              <div className="flex items-center gap-1.5">
                <i className="ri-phone-line text-[11px]" style={{ color: '#94A3B8' }} />
                <span className="text-[11px]" style={{ color: '#94A3B8' }}>(02) 8XXX-XXXX</span>
              </div>
            </div>


          </div>
        </div>

        {/* ─── RIGHT — Image Panel ─── */}
        <div className="hidden lg:block flex-1 relative overflow-hidden">
          <div className="absolute inset-0" style={{ background: 'linear-gradient(135deg, #0F2D52, #1a4a7a)' }} />
          <img src="/images/healthcare-login.jpg" alt="Healthcare worker showing chest X-ray to patient" className="absolute inset-0 w-full h-full object-cover" />
          <div className="absolute inset-0" style={{ background: 'linear-gradient(135deg, rgba(10,22,40,0.55) 0%, rgba(15,45,82,0.35) 50%, rgba(10,22,40,0.5) 100%)' }} />
          <div className="absolute bottom-0 left-0 right-0" style={{ background: 'linear-gradient(to top, rgba(10,22,40,0.92) 0%, rgba(10,22,40,0.5) 45%, transparent 75%)', height: '85%' }} />
          <div className="absolute top-8 right-8 z-20 px-5 py-3 rounded-2xl" style={{ background: 'rgba(255,255,255,0.08)', backdropFilter: 'blur(16px)', border: '1px solid rgba(255,255,255,0.1)' }}>
            <div className="flex items-center gap-2.5">
              <div className="w-2 h-2 rounded-full" style={{ background: '#00D8F6', boxShadow: '0 0 8px #00D8F6' }} />
              <span className="text-xs font-semibold" style={{ color: 'rgba(255,255,255,0.8)' }}>Pasig City Health Office</span>
            </div>
          </div>
          <div className="absolute bottom-0 left-0 right-0 z-20 px-10 pb-6">
            <div className="max-w-lg">
              <h2 className="text-[26px] font-extrabold text-white leading-tight mb-4">
                Better Data. Better Decisions.<br /><span style={{ color: '#00D8F6' }}>A Healthier Pasig City.</span>
              </h2>
              <p className="text-[13px] leading-relaxed mb-6" style={{ color: 'rgba(255,255,255,0.6)' }}>
                Real-time monitoring, forecasting, GIS hotspot mapping, and resource prioritization to support tuberculosis control and public health decision-making.
              </p>
              <div className="flex flex-wrap gap-2">
                {features.map((feat, i) => (
                  <div key={i} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold"
                    style={{ background: 'rgba(0,216,246,0.1)', border: '1px solid rgba(0,216,246,0.15)', color: '#00D8F6' }}>
                    <i className="ri-check-line text-[10px]" />{feat}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ═══════ Footer ═══════ */}
      <div className="flex-shrink-0 w-full px-6 lg:px-10" style={{ background: '#0F2D52', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 py-3.5 max-w-[1800px] mx-auto">
          <div className="flex items-center gap-3 text-center sm:text-left">
            <i className="ri-shield-check-line text-sm flex-shrink-0" style={{ color: '#00D8F6' }} />
            <p className="text-[11px] leading-relaxed" style={{ color: 'rgba(255,255,255,0.4)' }}>
              <span className="font-semibold" style={{ color: 'rgba(255,255,255,0.55)' }}>For authorized personnel only.</span>{' '}
              All tuberculosis surveillance data and analytics are confidential and protected under applicable data privacy and public health regulations.
            </p>
          </div>
          <div className="flex items-center gap-4 flex-shrink-0">
            <span className="text-[11px] font-bold" style={{ color: 'rgba(255,255,255,0.5)' }}>Pasig City Health Office</span>
            <div className="w-px h-3" style={{ background: 'rgba(255,255,255,0.12)' }} />
            <span className="text-[10px] font-medium" style={{ color: 'rgba(255,255,255,0.3)' }}>TBInsight — GIS-Based Predictive Tuberculosis Hotspot and Resource Prioritization Dashboard</span>
          </div>
        </div>
      </div>

      {/* ═══════ Forgot Password Modal ═══════ */}
      {showForgotModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          style={{ background: 'rgba(10,22,40,0.6)', backdropFilter: 'blur(4px)' }}
          onClick={closeForgotModal}>
          <div className="w-full max-w-[560px] max-h-[90vh] overflow-y-auto no-scrollbar relative"
            style={{ background: 'white', borderRadius: '20px', boxShadow: '0 25px 60px rgba(0,0,0,0.25)' }}
            onClick={(e) => e.stopPropagation()}>

            {/* Close */}
            <button onClick={closeForgotModal}
              className="absolute top-4 right-4 z-10 w-8 h-8 rounded-xl flex items-center justify-center transition-colors"
              style={{ background: '#f1f5f9', color: '#94A3B8' }}
              onMouseEnter={(e) => { e.currentTarget.style.background = '#e2e8f0'; e.currentTarget.style.color = '#475569'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = '#f1f5f9'; e.currentTarget.style.color = '#94A3B8'; }}>
              <i className="ri-close-line text-base" />
            </button>

            {/* Header */}
            <div className="px-8 pt-8 pb-4">
              <h2 className="text-xl font-extrabold mb-1" style={{ color: '#0F2D52' }}>Forgot Password?</h2>
              <p className="text-[13px]" style={{ color: '#94A3B8' }}>Select your account role to see the appropriate reset process.</p>
            </div>

            {/* Role Tabs */}
            <div className="px-8">
              <div className="flex gap-2 p-1 rounded-xl" style={{ background: '#f1f5f9' }}>
                {[
                  { id: 'staff', label: 'Staff', icon: 'ri-user-line' },
                  { id: 'admin', label: 'Administrator', icon: 'ri-shield-keyhole-line' },
                ].map((role) => (
                  <button key={role.id} onClick={() => { setForgotRole(role.id); setResetStep(1); setResetEmail(''); setResetNewPassword(''); setOtpCode(''); setOtpError(''); }}
                    className="flex-1 py-2.5 rounded-lg text-[13px] font-semibold flex items-center justify-center gap-2 transition-all duration-200"
                    style={{ background: forgotRole === role.id ? 'white' : 'transparent', color: forgotRole === role.id ? '#0F2D52' : '#94A3B8', boxShadow: forgotRole === role.id ? '0 2px 8px rgba(0,0,0,0.06)' : 'none' }}>
                    <i className={`${role.icon} text-base`} />{role.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Content */}
            <div className="px-8 py-6">
              <p className="text-[12px] font-bold uppercase tracking-wider mb-4" style={{ color: '#94A3B8' }}>
                <i className="ri-lock-password-line mr-1" />
                Password Recovery — {forgotRole === 'admin' ? 'Administrator' : 'Staff'}
              </p>

              {/* Step Indicators */}
              <div className="flex items-center gap-1.5 mb-5">
                {['Enter Email', 'Verify OTP', 'New Password', 'Done'].map((label, i) => (
                  <div key={i} className="flex items-center gap-1.5 flex-1">
                    <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 transition-all duration-300"
                      style={{
                        background: resetStep > i + 1 ? '#10B981' : resetStep === i + 1 ? '#0066FF' : '#e2e8f0',
                        color: resetStep >= i + 1 ? 'white' : '#94A3B8',
                      }}>
                      {resetStep > i + 1 ? <i className="ri-check-line" /> : i + 1}
                    </div>
                    {i < 3 && <div className="flex-1 h-[2px] rounded-full" style={{ background: resetStep > i + 1 ? '#10B981' : '#e2e8f0' }} />}
                  </div>
                ))}
              </div>

              {/* Step 1: Enter Email */}
              {resetStep === 1 && (
                <form onSubmit={handleResetRequest} className="space-y-4">
                  <div>
                    <label className="block text-[11px] font-bold mb-1.5 uppercase tracking-widest" style={{ color: '#94A3B8' }}>Registered email address</label>
                    <input type="email" required value={resetEmail} onChange={(e) => setResetEmail(e.target.value)}
                      placeholder="you@pasigcity.gov.ph"
                      className="w-full px-4 py-3 rounded-xl text-sm font-medium outline-none transition-all"
                      style={{ background: '#f8fafc', border: '1.5px solid #e2e8f0', color: '#0f172a' }}
                      onFocus={(e) => { e.target.style.borderColor = '#0066FF'; }}
                      onBlur={(e) => { e.target.style.borderColor = '#e2e8f0'; }} />
                  </div>
                  <button type="submit"
                    className="w-full py-3 rounded-xl font-bold text-[13px] text-white transition-all duration-200 flex items-center justify-center gap-2"
                    style={{ background: 'linear-gradient(135deg, #0F2D52, #2E6FAF)', boxShadow: '0 4px 14px rgba(15,45,82,0.2)' }}
                    onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-1px)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; }}>
                    <i className="ri-mail-send-line text-base" /> Send OTP Code
                  </button>
                </form>
              )}

              {/* Step 2: OTP Verification */}
              {resetStep === 2 && (
                <form onSubmit={handleVerifyOtp} className="space-y-4">
                  <div className="text-center mb-2">
                    <div className="w-12 h-12 rounded-2xl mx-auto mb-3 flex items-center justify-center" style={{ background: 'rgba(0,102,255,0.08)' }}>
                      <i className="ri-mail-check-line text-xl" style={{ color: '#0066FF' }} />
                    </div>
                    <p className="text-[13px]" style={{ color: '#64748B' }}>A 6-digit code has been sent to</p>
                    <p className="text-[13px] font-bold" style={{ color: '#0F2D52' }}>{resetEmail}</p>
                    <p className="text-[11px] mt-1" style={{ color: '#94A3B8' }}>Check your console for the OTP code</p>
                  </div>
                  {otpError && (
                    <div className="px-3 py-2 rounded-xl text-[12px] flex items-center gap-2 border bg-red-50 border-red-200 text-red-600">
                      <i className="ri-error-warning-line text-sm" />
                      {otpError}
                    </div>
                  )}
                  <div>
                    <label className="block text-[11px] font-bold mb-1.5 uppercase tracking-widest" style={{ color: '#94A3B8' }}>Enter OTP code</label>
                    <input type="text" required maxLength={6} placeholder="000000" value={otpCode} onChange={(e) => { setOtpCode(e.target.value.replace(/\D/g, '')); setOtpError(''); }}
                      className="w-full px-4 py-3 rounded-xl text-sm font-medium outline-none transition-all text-center tracking-[0.3em]"
                      style={{ background: '#f8fafc', border: '1.5px solid #e2e8f0', color: '#0f172a', fontSize: '18px' }}
                      onFocus={(e) => { e.target.style.borderColor = '#0066FF'; }}
                      onBlur={(e) => { e.target.style.borderColor = '#e2e8f0'; }} />
                  </div>
                  <button type="submit"
                    className="w-full py-3 rounded-xl font-bold text-[13px] text-white transition-all duration-200"
                    style={{ background: 'linear-gradient(135deg, #0F2D52, #2E6FAF)' }}>
                    Verify Code
                  </button>
                  <p className="text-center text-[12px]" style={{ color: '#94A3B8' }}>
                    {otpTimer > 0 ? (
                      <>Resend code in <span className="font-bold" style={{ color: '#0066FF' }}>{otpTimer}s</span></>
                    ) : (
                      <button type="button" onClick={handleResendOtp} className="font-semibold" style={{ color: '#0066FF' }}>Resend OTP Code</button>
                    )}
                  </p>
                </form>
              )}

              {/* Step 3: New Password */}
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
                      className="w-full px-4 py-3 rounded-xl text-sm font-medium outline-none transition-all"
                      style={{ background: '#f8fafc', border: '1.5px solid #e2e8f0', color: '#0f172a' }}
                      onFocus={(e) => { e.target.style.borderColor = '#10B981'; }}
                      onBlur={(e) => { e.target.style.borderColor = '#e2e8f0'; }} />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold mb-1.5 uppercase tracking-widest" style={{ color: '#94A3B8' }}>Confirm password</label>
                    <input type="password" required minLength={6} placeholder="Re-enter password"
                      className="w-full px-4 py-3 rounded-xl text-sm font-medium outline-none transition-all"
                      style={{ background: '#f8fafc', border: '1.5px solid #e2e8f0', color: '#0f172a' }}
                      onFocus={(e) => { e.target.style.borderColor = '#10B981'; }}
                      onBlur={(e) => { e.target.style.borderColor = '#e2e8f0'; }} />
                  </div>
                  <button type="submit"
                    className="w-full py-3 rounded-xl font-bold text-[13px] text-white transition-all duration-200"
                    style={{ background: 'linear-gradient(135deg, #10B981, #059669)', boxShadow: '0 4px 14px rgba(16,185,129,0.25)' }}>
                    <i className="ri-check-line mr-1" /> Reset Password
                  </button>
                </form>
              )}

              {/* Step 4: Success */}
              {resetStep === 4 && (
                <div className="text-center py-4">
                  <div className="w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center" style={{ background: 'rgba(16,185,129,0.1)' }}>
                    <i className="ri-check-double-line text-2xl" style={{ color: '#10B981' }} />
                  </div>
                  <h3 className="text-base font-bold mb-1" style={{ color: '#0F2D52' }}>Password Reset Successfully</h3>
                  <p className="text-[13px] mb-5" style={{ color: '#94A3B8' }}>Your password has been updated. You can now sign in with your new credentials.</p>
                  <button onClick={closeForgotModal}
                    className="px-6 py-2.5 rounded-xl font-bold text-[13px] text-white transition-all"
                    style={{ background: 'linear-gradient(135deg, #0F2D52, #2E6FAF)' }}>
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
