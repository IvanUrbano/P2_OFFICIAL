// Whether this browser has accepted the current Data Privacy Notice (components/PrivacyNotice.jsx).
// Bump VERSION when the notice text changes so everyone sees the new one.
const STORAGE_KEY = 'tbinsight_privacy_notice';
const VERSION = '2026-10-11';

export function privacyNoticeAccepted() {
  try { return localStorage.getItem(STORAGE_KEY) === VERSION; } catch { return false; }
}

export function rememberPrivacyNoticeAccepted() {
  try { localStorage.setItem(STORAGE_KEY, VERSION); } catch { /* private window: asked again next time */ }
}
