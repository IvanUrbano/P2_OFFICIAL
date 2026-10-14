import { createContext, useContext, useEffect, useState } from 'react';

/**
 * Theme system — light/dark mode with localStorage persistence.
 *
 * Pages consume tokens via useTheme() instead of hardcoded light colors:
 *
 *   const { t } = useTheme();
 *   <div style={{ background: t.card, color: t.text }} />
 *
 * Tokens cover the surfaces used across the app: page background, cards,
 * text tiers, borders, inputs, and table striping. Accent colors
 * (#2E6FAF, greens, reds) are theme-independent and stay hardcoded.
 */

const palettes = {
  light: {
    pageBg: 'linear-gradient(135deg, #F8FAFC 0%, #EEF4FB 50%, #F5F8FC 100%)',
    card: 'rgba(255,255,255,0.65)',
    cardSolid: '#ffffff',
    panel: 'rgba(255,255,255,0.45)',
    border: 'rgba(0,0,0,0.05)',
    borderStrong: 'rgba(0,0,0,0.08)',
    text: '#1e293b',
    textSecondary: '#64748b',
    textMuted: '#94a3b8',
    inputBg: '#ffffff',
    inputBorder: 'rgba(15,23,42,0.12)',
    tableStripe: 'rgba(15,23,42,0.03)',
    chartGrid: 'rgba(15,23,42,0.08)',
    blob1: '#2E6FAF',
    blob2: '#4FD1C5',
  },
  dark: {
    pageBg: 'linear-gradient(135deg, #0B1220 0%, #0E1628 50%, #0A101E 100%)',
    card: 'rgba(17,25,40,0.85)',
    cardSolid: '#111928',
    panel: 'rgba(13,20,34,0.6)',
    border: 'rgba(148,163,184,0.10)',
    borderStrong: 'rgba(148,163,184,0.18)',
    text: '#E2E8F0',
    textSecondary: '#94A3B8',
    textMuted: '#64748B',
    inputBg: '#0F172A',
    inputBorder: 'rgba(148,163,184,0.22)',
    tableStripe: 'rgba(148,163,184,0.05)',
    chartGrid: 'rgba(148,163,184,0.14)',
    blob1: 'rgba(46,111,175,0.35)',
    blob2: 'rgba(79,209,197,0.25)',
  },
};

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  // The app has no theme switch, so it always opens light. A 'dark' value saved by an
  // older version (key 'tb-theme') would otherwise lock a browser in dark mode.
  const [mode, setMode] = useState('light');

  useEffect(() => {
    try {
      localStorage.removeItem('tb-theme');
    } catch { /* storage unavailable */ }
    // Drive CSS variable overrides in index.css ([data-theme='dark'])
    document.documentElement.setAttribute('data-theme', mode);
  }, [mode]);

  const toggle = () => setMode((m) => (m === 'dark' ? 'light' : 'dark'));

  return (
    <ThemeContext.Provider value={{ mode, toggle, t: palettes[mode] || palettes.light }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}
