import { createContext, useContext, useEffect } from 'react';

/**
 * Theme tokens for the app's single (light) appearance.
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
};

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  // The app has one light appearance. Clear the 'tb-theme' key an older version saved, and the
  // data-theme attribute, so no browser is left in the removed dark mode.
  useEffect(() => {
    try {
      localStorage.removeItem('tb-theme');
    } catch { /* storage unavailable */ }
    document.documentElement.removeAttribute('data-theme');
  }, []);

  return (
    <ThemeContext.Provider value={{ mode: 'light', t: palettes.light }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}
