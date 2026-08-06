import axios from 'axios';

let _accessToken = null;
let _isRefreshing = false;
let _failedQueue = [];

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

const processQueue = (error, token = null) => {
  _failedQueue.forEach((p) => (error ? p.reject(error) : p.resolve(token)));
  _failedQueue = [];
};

const isAuthUrl = (url = '') => url.includes('/auth/');

// Si VITE_API_URL está seteada (ej. en Vercel), manda esa. Si no, el
// fallback depende de si es un build de dev o de producción: en dev
// (`vite`) pega al backend local, en build de producción (`vite build`)
// mantiene el comportamiento actual hardcodeado a Railway — así este
// cambio no puede romper producción aunque VITE_API_URL no esté seteada
// ahí. import.meta.env.DEV lo pone Vite automáticamente, no depende de
// ninguna variable propia.
const PROD_API_URL = 'https://vexio-production-75d5.up.railway.app/api';
const API_BASE_URL =
  import.meta.env.VITE_API_URL ??
  (import.meta.env.DEV ? 'http://localhost:3001/api' : PROD_API_URL);

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  const token = tokenStore.getAccessToken();
  if (token && !isAuthUrl(config.url)) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    const status = error.response?.status;

    if (status !== 401 || originalRequest._retry || isAuthUrl(originalRequest.url)) {
      return Promise.reject(error);
    }

    const refreshToken = tokenStore.getRefreshToken();
    if (!refreshToken) return Promise.reject(error);

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
      const { data } = await axios.post(`${API_BASE_URL}/auth/refresh`, {
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
      window.location.href = '/login';
      return Promise.reject(refreshError);
    } finally {
      _isRefreshing = false;
    }
  }
);

export default api;