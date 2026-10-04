import API from '../api/axios';

// Shared by the header bell (components/Layout.jsx) and pages/NotificationsPage.jsx.

export const SEVERITY_COLOR = {
  danger: '#DC2626',
  warning: '#D97706',
  success: '#059669',
  info: '#2E6FAF',
};

export const TYPE_ICON = {
  referral_received: 'ri-inbox-archive-line',
  referral_accepted: 'ri-checkbox-circle-line',
  referral_rejected: 'ri-close-circle-line',
  referral_cancelled: 'ri-arrow-go-back-line',
  case_assigned: 'ri-map-pin-user-line',
  validation_summary: 'ri-checkbox-multiple-line',
  sync_completed: 'ri-upload-cloud-2-line',
  sync_failed: 'ri-error-warning-line',
  account_updated: 'ri-user-settings-line',
};

export function timeAgo(value) {
  if (!value) return '';
  const d = new Date(value);
  const mins = Math.floor((Date.now() - d) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
}

export const markRead = (id) => API.put(`/api/auth/notifications/${id}/read`);
export const markUnread = (id) => API.put(`/api/auth/notifications/${id}/unread`);
export const markAllRead = () => API.put('/api/auth/notifications/read-all');

// Other parts of the page (e.g. the Notifications page) announce changes so the bell
// count updates without waiting for its next poll.
export const NOTIFICATIONS_CHANGED = 'pasig:notifications-changed';
export const announceChange = () => window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED));
