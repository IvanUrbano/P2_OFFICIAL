import axios from 'axios';

const instance = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '',
  withCredentials: true,
});

function readCookie(name) {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

const SAFE_METHODS = new Set(['get', 'head', 'options']);

instance.interceptors.request.use((requestConfig) => {
  const method = (requestConfig.method || 'get').toLowerCase();
  if (!SAFE_METHODS.has(method)) {
    const csrfToken = readCookie('csrf_token');
    if (csrfToken) {
      requestConfig.headers = requestConfig.headers || {};
      requestConfig.headers['x-csrf-token'] = csrfToken;
    }
  }
  return requestConfig;
});

instance.interceptors.response.use(
  (response) => response,
  (error) => {
    // skipAuthRedirect: the request answers 401 for its own reason (a wrong Records PIN),
    // not because the session ended — the caller shows the error instead of logging out.
    if (!error.config?.skipAuthRedirect && (error.response?.status === 401 || error.response?.status === 403)) {
      localStorage.removeItem('user');
      if (window.location.pathname !== '/login') {
        window.location.replace('/login');
      }
    }
    return Promise.reject(error);
  }
);

export default instance;
