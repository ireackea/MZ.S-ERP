// ENTERPRISE FIX: Exact Legacy UI Restoration - 2026-02-27
// ENTERPRISE FIX: Vite Proxy for Backend API - 2026-02-26

import axios from 'axios';

const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '',
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true,
});

const toPath = (url: string) => (url.startsWith('/') ? url : `/${url}`);
const hasApiPrefix = (path: string) => /^\/api(\/|$)/.test(path);
const baseIncludesApiPrefix = (baseURL: string) => {
  const normalized = baseURL.trim().replace(/\/+$/, '');
  return /\/api$/i.test(normalized);
};

apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('feed_factory_jwt_token');
  const headers = (config.headers ?? {}) as Record<string, string>;
  const url = String(config.url || '');
  const baseURL = String(config.baseURL ?? apiClient.defaults.baseURL ?? '');

  if (url && !/^https?:\/\//i.test(url)) {
    const path = toPath(url);
    config.url = hasApiPrefix(path) || baseIncludesApiPrefix(baseURL) ? path : `/api${path}`;
  }

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  } else {
    delete headers.Authorization;
  }

  config.headers = headers as any;
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error?.response?.status === 401) {
      localStorage.removeItem('feed_factory_jwt_token');
      localStorage.removeItem('feed_factory_jwt_user');
    }
    return Promise.reject(error);
  },
);

export default apiClient;
