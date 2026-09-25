import { createContext, useContext, useEffect, useState } from 'react';

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
  },
};

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const [mode] = useState('light');

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', mode);
  }, [mode]);

  return (
    <ThemeContext.Provider value={{ mode, t: palettes.light }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}
