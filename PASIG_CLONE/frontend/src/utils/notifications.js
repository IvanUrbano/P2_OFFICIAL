import API from '../api/axios';

// Shared by the header bell (components/Layout.jsx) and pages/NotificationsPage.jsx.

export const TYPE_LABEL = {
  import_completed: 'Import',
  import_failed: 'Import',
  validation_issues: 'Validation',
  validation_summary: 'Validation',
  assignment_needed: 'Assignment',
  case_assigned: 'Cases',
  sync_completed: 'Sync',
  sync_failed: 'Sync',
  referral_received: 'Referral',
  referral_accepted: 'Referral',
  referral_rejected: 'Referral',
  referral_cancelled: 'Referral',
  account_updated: 'Account',
  outcome_due: 'Treatment',
};

const notificationDateFormatter = new Intl.DateTimeFormat('en-PH', {
  timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric',
  hour: 'numeric', minute: '2-digit', hour12: true,
});

export function formatNotificationDate(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : notificationDateFormatter.format(date);
}

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
