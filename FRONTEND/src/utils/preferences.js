// Per-browser display preferences for TBInsight Settings.
//
// These live in this browser only (localStorage). They are conveniences, not account data:
// they are never sent to the server and do not follow the user to another device.

const KEY = 'tbinsight_prefs';
const EVENT = 'tbinsight:prefs';

export const LANDING_PAGES = [
  { path: '/dashboard', label: 'Dashboard' },
  { path: '/gis-map', label: 'GIS Mapping' },
  { path: '/forecasting', label: 'Forecasting' },
  { path: '/alert', label: 'Alerts & Notifications' },
  { path: '/records', label: 'TB Records' },
];

export const DEFAULT_PREFS = { landingPage: '/dashboard', bellCount: true };

export function getPrefs() {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) || '{}');
    const landingPage = LANDING_PAGES.some(p => p.path === stored.landingPage)
      ? stored.landingPage
      : DEFAULT_PREFS.landingPage;
    return {
      landingPage,
      bellCount: typeof stored.bellCount === 'boolean' ? stored.bellCount : DEFAULT_PREFS.bellCount,
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function setPrefs(patch) {
  const next = { ...getPrefs(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable: the preference simply does not persist */
  }
  window.dispatchEvent(new Event(EVENT));
  return next;
}

/** Subscribe to preference changes made anywhere in this tab or another tab. */
export function onPrefsChange(handler) {
  const onStorage = (e) => { if (e.key === KEY) handler(); };
  window.addEventListener(EVENT, handler);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(EVENT, handler);
    window.removeEventListener('storage', onStorage);
  };
}
