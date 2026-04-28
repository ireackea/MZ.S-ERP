// ENTERPRISE FIX: Exact Legacy UI Restoration - 2026-02-27
// ENTERPRISE FIX: Vite Proxy for Backend API - 2026-02-26

import axios from 'axios';
import { markBootstrapRequest } from '@utils/bootstrapMetrics';
import { clearAllAuthData } from '@services/authSession';

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
  const headers = (config.headers ?? {}) as Record<string, string>;
  const url = String(config.url || '');
  const baseURL = String(config.baseURL ?? apiClient.defaults.baseURL ?? '');

  if (url && !/^https?:\/\//i.test(url)) {
    const path = toPath(url);
    config.url = hasApiPrefix(path) || baseIncludesApiPrefix(baseURL) ? path : `/api${path}`;
  }

  markBootstrapRequest(String(config.method || 'GET').toUpperCase(), String(config.url || ''));

  config.headers = headers as any;
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error?.response?.status === 401) {
      clearAllAuthData();
    }
    return Promise.reject(error);
  },
);

export default apiClient;
