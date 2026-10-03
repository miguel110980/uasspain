import axios from 'axios';
import { ensureWindowSession } from '@/lib/windowSession';
import { encodeFormBody, urlEncodedParamsSerializer } from '@/lib/urls';
import { getEncodedClientMeta } from '@/lib/clientMeta';

const SESSION_REPLACED_MESSAGE = 'Su sesión ha caducado porque se ha iniciado sesión en otro dispositivo.';

/** URL base del API. Vacío = rutas relativas (proxy Vite en dev). */
export const API_BASE_URL = import.meta.env.VITE_API_URL ?? '';

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
  timeout: 30000,
  withCredentials: true,
  paramsSerializer: urlEncodedParamsSerializer,
});

apiClient.interceptors.request.use(async (config) => {
  config.headers['X-UASSpain-Window-Id'] = await ensureWindowSession();
  if (config.data instanceof FormData) {
    delete config.headers['Content-Type'];
  }
  if (config.url?.includes('/auth/me')) {
    try {
      config.headers['X-Client-Meta'] = await getEncodedClientMeta();
    } catch {
      // metadatos opcionales
    }
  }
  return config;
});

let refreshPromise = null;

function refreshUrl() {
  return API_BASE_URL ? `${API_BASE_URL}/api/auth/refresh/` : '/api/auth/refresh/';
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    const status = error.response?.status;

    if (status !== 401 || !originalRequest || originalRequest._retry) {
      return Promise.reject(error);
    }

    if (originalRequest.url?.includes('/auth/refresh/') || originalRequest.url?.includes('/auth/login/') || originalRequest.url?.includes('/auth/google/')) {
      return Promise.reject(error);
    }

    if (error.response?.data?.code === 'session_window_mismatch') return Promise.reject(error);
    if (!refreshPromise) {
      refreshPromise = axios
        .post(
          refreshUrl(),
          encodeFormBody({}),
          {
            withCredentials: true,
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-UASSpain-Window-Id': await ensureWindowSession() },
          },
        )
        .then((res) => res.data)
        .catch((refreshError) => {
          throw refreshError;
        })
        .finally(() => {
          refreshPromise = null;
        });
    }

    try {
      await refreshPromise;
      originalRequest._retry = true;
      return apiClient(originalRequest);
    } catch (refreshError) {
      const detail = refreshError?.response?.data?.detail;
      if (typeof window !== 'undefined' && detail === SESSION_REPLACED_MESSAGE) {
        window.sessionStorage.setItem('uasspain.auth_notice', detail);
        const nextUrl = window.location.pathname + window.location.search;
        window.location.href = `/?auth=login&from=${encodeURIComponent(nextUrl)}`;
      }
      return Promise.reject(refreshError);
    }
  }
);

export default apiClient;
