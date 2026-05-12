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

const api = axios.create({
  baseURL: 'https://vexio-production-75d5.up.railway.app/api',
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
      const { data } = await axios.post('https://vexio-production-75d5.up.railway.app/api/auth/refresh', {
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