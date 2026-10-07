export function avatarColorForRole(role) {
  return String(role || '').toLowerCase() === 'admin' ? '#0F2D52' : '#475569';
}

export function initialsForUsername(username) {
  const parts = String(username || '').trim().split(/\s+/).filter(Boolean);
  return parts.length ? parts.map(part => part[0]).join('').toUpperCase().slice(0, 2) : 'U';
}
