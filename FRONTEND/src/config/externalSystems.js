const PASIG_CLONE_RENDER_URL = 'https://pasig-clone-frontend.onrender.com';
const configuredPasigCloneUrl = (import.meta.env.VITE_PASIG_CLONE_URL || '').replace(/\/+$/, '');
const pointsToLocalhost = /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::|\/|$)/i.test(
  configuredPasigCloneUrl,
);

export const PASIG_CLONE_URL =
  import.meta.env.PROD && pointsToLocalhost
    ? PASIG_CLONE_RENDER_URL
    : configuredPasigCloneUrl ||
      (import.meta.env.DEV ? 'http://localhost:5174' : PASIG_CLONE_RENDER_URL);
