import axios from 'axios';

const API = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:5000',
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

const SAFE_METHODS = new Set(['get', 'head', 'options']);

// Request interceptor — attach the CSRF nonce (handed to us once in the login
// response body, see LoginPage.jsx) to every state-changing request, since
// the auth cookie is SameSite=None and gets sent automatically cross-site.
API.interceptors.request.use((config) => {
  const method = (config.method || 'get').toLowerCase();
  if (!SAFE_METHODS.has(method)) {
    const csrfToken = sessionStorage.getItem('csrf_token');
    if (csrfToken) {
      config.headers = config.headers || {};
      config.headers['x-csrf-token'] = csrfToken;
    }
  }
  return config;
});

// Response interceptor — handle auth errors globally
API.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 || error.response?.status === 403) {
      localStorage.removeItem('user');
      sessionStorage.removeItem('csrf_token');
      if (window.location.pathname !== '/login') {
        window.location.replace('/login');
      }
    }
    return Promise.reject(error);
  }
);

export default API;
