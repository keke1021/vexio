import axios from 'axios';

// ─── Token store ────────────────────────────────────────────────────────────
// El access token vive en memoria (no en localStorage) para reducir la
// superficie de ataque ante XSS. Solo el refresh token persiste en localStorage.

let _accessToken = null;
let _isRefreshing = false;
let _failedQueue = []; // Requests que esperan el nuevo access token

export const tokenStore = {
  getAccessToken: () => _accessToken,
  setAccessToken: (token) => { _accessToken = token; },
  getRefreshToken: () => localStorage.getItem('vexio_rt'),
  setRefreshToken: (token) => {
    if (token) localStorage.setItem('vexio_rt', token);
    else localStorage.removeItem('vexio_rt');
  },
  clear: () => {
    _accessToken = null;
    localStorage.removeItem('vexio_rt');
  },
};

// ─── Helpers internos ────────────────────────────────────────────────────────

const processQueue = (error, token = null) => {
  _failedQueue.forEach((p) => (error ? p.reject(error) : p.resolve(token)));
  _failedQueue = [];
};

// Detecta si la URL es un endpoint de auth para evitar el bucle de refresh
const isAuthUrl = (url = '') => url.includes('/auth/');

// ─── Instancia Axios ─────────────────────────────────────────────────────────

const api = axios.create({
  baseURL: 'http://localhost:3001/api',
  headers: { 'Content-Type': 'application/json' },
});

// Request interceptor: adjunta el access token a cada request protegido
api.interceptors.request.use((config) => {
  const token = tokenStore.getAccessToken();
  if (token && !isAuthUrl(config.url)) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Response interceptor: si 401, intenta renovar el token y reintenta la request
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    const status = error.response?.status;

    // No reintentar: endpoints de auth, requests ya reintentados, o sin refresh token
    if (status !== 401 || originalRequest._retry || isAuthUrl(originalRequest.url)) {
      return Promise.reject(error);
    }

    const refreshToken = tokenStore.getRefreshToken();
    if (!refreshToken) return Promise.reject(error);

    // Si ya hay un refresh en curso, encolar esta request
    if (_isRefreshing) {
      return new Promise((resolve, reject) => {
        _failedQueue.push({ resolve, reject });
      }).then((token) => {
        originalRequest.headers.Authorization = `Bearer ${token}`;
        return api(originalRequest);
      });
    }

    originalRequest._retry = true;
    _isRefreshing = true;

    try {
      // Usamos axios directo (no la instancia `api`) para evitar interceptors recursivos
      const { data } = await axios.post('http://localhost:3001/api/auth/refresh', {
        refreshToken,
      });

      tokenStore.setAccessToken(data.accessToken);
      processQueue(null, data.accessToken);

      originalRequest.headers.Authorization = `Bearer ${data.accessToken}`;
      return api(originalRequest);
    } catch (refreshError) {
      processQueue(refreshError, null);
      tokenStore.clear();
      localStorage.removeItem('vexio_user');
      localStorage.removeItem('vexio_tenant');
      // Redirige a login sin depender de React Router
      window.location.href = '/login';
      return Promise.reject(refreshError);
    } finally {
      _isRefreshing = false;
    }
  }
);

export default api;
