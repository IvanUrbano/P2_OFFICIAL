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
      setError(err.response?.data?.error || 'Invalid credentials. Please try again.');
      if (isRateLimited && err.response?.data?.retryAfter) setLockoutSeconds(err.response.data.retryAfter);
    } finally {
      setLoading(false);
    }
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
            {/* Username or Email */}
            <div>
              <input
                type="text" name="email" value={formData.email} onChange={handleChange} required
                disabled={lockoutSeconds > 0 || loading} placeholder="Username or Email"
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
    </div>
  );
}
