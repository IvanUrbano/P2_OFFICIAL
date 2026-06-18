import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer,
  BarChart, Bar,
  PieChart, Pie, Cell, Legend
} from 'recharts';

// Mock Data for Charts
const trendData = [
  { name: 'Jan', actual: 45, forecast: null },
  { name: 'Feb', actual: 52, forecast: null },
  { name: 'Mar', actual: 48, forecast: null },
  { name: 'Apr', actual: 61, forecast: null },
  { name: 'May', actual: 65, forecast: null },
  { name: 'Jun', actual: 59, forecast: null },
  { name: 'Jul', actual: null, forecast: 62 },
  { name: 'Aug', actual: null, forecast: 68 },
];

const barangayData = [
  { name: 'Rosario', cases: 85 },
  { name: 'Caniogan', cases: 72 },
  { name: 'Kalawaan', cases: 68 },
  { name: 'Pinagbuhatan', cases: 61 },
  { name: 'Bambang', cases: 54 },
];

const outcomeData = [
  { name: 'Completed', value: 400 },
  { name: 'Cured', value: 300 },
  { name: 'Failed', value: 50 },
  { name: 'Died', value: 20 },
  { name: 'Defaulted', value: 80 },
];
const COLORS = ['#22c55e', '#0ea5e9', '#ef4444', '#1e1b4b', '#f59e0b'];

export default function DashboardPage() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);

  useEffect(() => {
    const stored = localStorage.getItem('user');
    if (!stored) {
      navigate('/login');
      return;
    }
    setUser(JSON.parse(stored));
  }, [navigate]);

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    navigate('/login');
  };

  if (!user) return null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0f0c29] via-[#302b63] to-[#24243e] text-white overflow-hidden flex flex-col">
      {/* Background Animated Orbs */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
        <div className="absolute -top-40 -left-40 w-80 h-80 bg-primary/20 rounded-full blur-[100px] animate-float" />
        <div className="absolute top-1/2 -right-20 w-96 h-96 bg-secondary/15 rounded-full blur-[120px] animate-float" style={{ animationDelay: '2s' }} />
      </div>

      {/* Grid Pattern Overlay */}
      <div
        className="fixed inset-0 opacity-[0.03] z-0 pointer-events-none"
        style={{
          backgroundImage: `linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)`,
          backgroundSize: '60px 60px',
        }}
      />

      {/* Floating Top Navigation */}
      <div className="relative z-20 px-6 pt-6">
        <nav className="glass-strong rounded-2xl border border-white/10 shadow-2xl shadow-primary/10">
          <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
            {/* Logo & Brand */}
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center shadow-lg shadow-primary/20">
                <span className="text-white font-bold text-lg tracking-tighter">TB</span>
              </div>
              <div>
                <h1 className="text-xl font-bold tracking-tight text-white leading-tight">TB System</h1>
                <p className="text-xs text-white/50 font-medium tracking-wide">HEALTH INSIGHT</p>
              </div>
            </div>

            {/* Nav Links */}
            <div className="hidden md:flex items-center gap-2 bg-white/5 p-1.5 rounded-xl border border-white/10">
              <button className="px-4 py-2 rounded-lg bg-primary/20 text-primary-light font-medium text-sm transition-colors">
                Dashboard
              </button>
              <button className="px-4 py-2 rounded-lg hover:bg-white/5 text-white/70 hover:text-white font-medium text-sm transition-colors cursor-pointer">
                Records
              </button>
              <button className="px-4 py-2 rounded-lg hover:bg-white/5 text-white/70 hover:text-white font-medium text-sm transition-colors cursor-pointer">
                Map
              </button>
              <button className="px-4 py-2 rounded-lg hover:bg-white/5 text-white/70 hover:text-white font-medium text-sm transition-colors cursor-pointer">
                Alerts
              </button>
            </div>

            {/* User & Actions */}
            <div className="flex items-center gap-5">
              <div className="hidden sm:block text-right">
                <p className="text-sm font-semibold text-white">{user.username}</p>
                <p className="text-xs text-white/50">Admin</p>
              </div>
              <div className="w-px h-8 bg-white/10 hidden sm:block"></div>
              <button
                onClick={handleLogout}
                className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 hover:bg-danger/20 hover:border-danger/30 hover:text-danger flex items-center justify-center transition-all duration-300 cursor-pointer text-white/70 group"
                title="Logout"
              >
                <svg className="w-5 h-5 group-hover:translate-x-0.5 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
              </button>
            </div>
          </div>
        </nav>
      </div>

      {/* Main Content Area */}
      <main className="relative z-10 flex-1 overflow-y-auto px-6 py-8">
        <div className="max-w-7xl mx-auto space-y-6">
          
          {/* Header Row */}
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4 animate-slide-up">
            <div>
              <h2 className="text-2xl font-bold text-white mb-1">Overview</h2>
              <p className="text-white/50 text-sm">Last synced: Today, 08:42 AM</p>
            </div>
            <button className="px-4 py-2 rounded-xl bg-primary text-white text-sm font-medium hover:bg-primary-dark transition-colors shadow-lg shadow-primary/20 flex items-center gap-2 cursor-pointer">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              Export Report
            </button>
          </div>

          {/* Top Stats Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 animate-slide-up" style={{ animationDelay: '0.1s' }}>
            {/* Stat Card 1 */}
            <div className="glass rounded-2xl p-5 border border-white/10 hover:border-primary/30 transition-colors relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                <svg className="w-16 h-16 text-primary" fill="currentColor" viewBox="0 0 24 24"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>
              </div>
              <p className="text-sm text-white/50 font-medium mb-1 relative z-10">Total TB Cases</p>
              <h3 className="text-4xl font-bold text-white mb-2 relative z-10">320</h3>
              <div className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-success/20 text-success text-xs font-semibold relative z-10">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18" /></svg>
                12% vs 2024
              </div>
            </div>

            {/* Stat Card 2 */}
            <div className="glass rounded-2xl p-5 border border-white/10 hover:border-accent/30 transition-colors relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                <svg className="w-16 h-16 text-accent" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
              </div>
              <p className="text-sm text-white/50 font-medium mb-1 relative z-10">Active Cases</p>
              <h3 className="text-4xl font-bold text-accent mb-2 relative z-10">103</h3>
              <div className="inline-flex items-center gap-1 text-white/50 text-xs font-medium relative z-10">
                Ongoing treatment
              </div>
            </div>

            {/* Stat Card 3 */}
            <div className="glass rounded-2xl p-5 border border-danger/20 hover:border-danger/40 transition-colors relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                <svg className="w-16 h-16 text-danger" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2L1 21h22M12 6l7.53 13H4.47M11 10v4h2v-4m-2 6v2h2v-2"/></svg>
              </div>
              <p className="text-sm text-white/50 font-medium mb-1 relative z-10">High Risk Barangays</p>
              <h3 className="text-4xl font-bold text-danger mb-2 relative z-10">14</h3>
              <div className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-danger/20 text-danger text-xs font-semibold relative z-10">
                Immediate action needed
              </div>
            </div>

            {/* Stat Card 4 */}
            <div className="glass rounded-2xl p-5 border border-white/10 hover:border-success/30 transition-colors relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                <svg className="w-16 h-16 text-success" fill="currentColor" viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
              </div>
              <p className="text-sm text-white/50 font-medium mb-1 relative z-10">Treatment Success Rate</p>
              <h3 className="text-4xl font-bold text-white mb-2 relative z-10">84%</h3>
              <div className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-danger/20 text-danger text-xs font-semibold relative z-10">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" /></svg>
                Below WHO Target (90%)
              </div>
            </div>
          </div>

          {/* Charts Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-slide-up" style={{ animationDelay: '0.2s' }}>
            
            {/* Main Trend Chart */}
            <div className="glass rounded-2xl p-6 border border-white/10 lg:col-span-2 flex flex-col">
              <div className="mb-4">
                <h3 className="text-lg font-semibold text-white">Monthly TB Case Trends</h3>
                <p className="text-sm text-white/50">Actual cases vs ARIMA forecast for 2024</p>
              </div>
              <div className="flex-1 min-h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trendData} margin={{ top: 5, right: 20, left: -20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" vertical={false} />
                    <XAxis dataKey="name" stroke="rgba(255,255,255,0.5)" tick={{fill: 'rgba(255,255,255,0.5)', fontSize: 12}} tickLine={false} axisLine={false} />
                    <YAxis stroke="rgba(255,255,255,0.5)" tick={{fill: 'rgba(255,255,255,0.5)', fontSize: 12}} tickLine={false} axisLine={false} />
                    <RechartsTooltip 
                      contentStyle={{ backgroundColor: 'rgba(30, 27, 75, 0.9)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px', color: '#fff' }}
                      itemStyle={{ color: '#fff' }}
                    />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: '12px', color: 'rgba(255,255,255,0.7)' }} />
                    <Line type="monotone" dataKey="actual" name="Actual Cases" stroke="#0ea5e9" strokeWidth={3} dot={{ r: 4, strokeWidth: 2 }} activeDot={{ r: 6 }} />
                    <Line type="monotone" dataKey="forecast" name="Forecast" stroke="#f59e0b" strokeWidth={3} strokeDasharray="5 5" dot={{ r: 4, strokeWidth: 2 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Donut Chart - Outcomes */}
            <div className="glass rounded-2xl p-6 border border-white/10 flex flex-col">
              <div className="mb-4">
                <h3 className="text-lg font-semibold text-white">Treatment Outcomes</h3>
                <p className="text-sm text-white/50">Distribution for current year</p>
              </div>
              <div className="flex-1 min-h-[300px] w-full flex items-center justify-center">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={outcomeData}
                      cx="50%"
                      cy="50%"
                      innerRadius={80}
                      outerRadius={110}
                      paddingAngle={5}
                      dataKey="value"
                      stroke="none"
                    >
                      {outcomeData.map((entry, index) => (
                         <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <RechartsTooltip 
                      contentStyle={{ backgroundColor: 'rgba(30, 27, 75, 0.9)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' }}
                      itemStyle={{ color: '#fff' }}
                    />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: '12px' }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Bar Chart - Barangays */}
            <div className="glass rounded-2xl p-6 border border-white/10 lg:col-span-3 flex flex-col">
              <div className="mb-4">
                <h3 className="text-lg font-semibold text-white">Cases by Barangay (Top 5)</h3>
                <p className="text-sm text-white/50">Highest concentration areas</p>
              </div>
              <div className="min-h-[250px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={barangayData} margin={{ top: 5, right: 0, left: -20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" vertical={false} />
                    <XAxis dataKey="name" stroke="rgba(255,255,255,0.5)" tick={{fill: 'rgba(255,255,255,0.5)', fontSize: 12}} tickLine={false} axisLine={false} />
                    <YAxis stroke="rgba(255,255,255,0.5)" tick={{fill: 'rgba(255,255,255,0.5)', fontSize: 12}} tickLine={false} axisLine={false} />
                    <RechartsTooltip 
                      cursor={{fill: 'rgba(255,255,255,0.05)'}}
                      contentStyle={{ backgroundColor: 'rgba(30, 27, 75, 0.9)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' }}
                    />
                    <Bar dataKey="cases" name="Cases" fill="#818cf8" radius={[6, 6, 0, 0]} barSize={40} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

          </div>
          
          {/* Bottom Alerts Section */}
          <div className="glass rounded-2xl p-6 border border-white/10 animate-slide-up" style={{ animationDelay: '0.3s' }}>
             <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                  <svg className="w-5 h-5 text-danger" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
                  </svg>
                  Latest Alerts
                </h3>
                <button className="text-sm text-primary-light hover:text-primary transition-colors font-medium">View All</button>
             </div>
             
             <div className="space-y-3">
                <div className="bg-danger/10 border border-danger/20 rounded-xl p-4 flex gap-4 items-start">
                  <div className="w-2 h-2 rounded-full bg-danger mt-1.5 animate-pulse"></div>
                  <div>
                    <h4 className="font-semibold text-danger text-sm">Manggahan — Critical Case Surge</h4>
                    <p className="text-white/70 text-xs mt-1">Cases increased 34% in the past 30 days. Immediate intervention required.</p>
                    <span className="text-danger/60 text-xs mt-2 block">2 hours ago</span>
                  </div>
                </div>
                
                <div className="bg-white/5 border border-white/10 rounded-xl p-4 flex gap-4 items-start">
                  <div className="w-2 h-2 rounded-full bg-accent mt-1.5"></div>
                  <div>
                    <h4 className="font-semibold text-white text-sm">System Sync Completed</h4>
                    <p className="text-white/70 text-xs mt-1">Data from 47 barangay health centers successfully synchronized.</p>
                    <span className="text-white/40 text-xs mt-2 block">Today at 08:42 AM</span>
                  </div>
                </div>
             </div>
          </div>

        </div>
      </main>
    </div>
  );
}
