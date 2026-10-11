import axios from 'axios';
import { ensureWindowSession } from '@/lib/windowSession';
import { encodeFormBody, urlEncodedParamsSerializer } from '@/lib/urls';
import { getEncodedClientMeta } from '@/lib/clientMeta';

const SESSION_REPLACED_MESSAGE = 'Su sesión ha caducado porque se ha iniciado sesión en otro dispositivo.';
const WINDOW_SESSION_MESSAGE = 'Esta ventana no tiene una sesión válida. Inicia sesión aquí para continuar.';
let redirectingToLogin = false;
let sessionRequests = new AbortController();

export function requestLogin(message: string, returnTo?: string) {
  if (typeof window === 'undefined' || redirectingToLogin) return;
  // A foreign window's cookies may still be valid there. Never log it out or
  // clear shared cookies to recover this document's expired window binding.
  if (window.location.pathname === '/' && new URLSearchParams(window.location.search).get('auth') === 'login') return;
  redirectingToLogin = true;
  sessionRequests.abort();
  if (message) window.sessionStorage.setItem('uasspain.auth_notice', message);
  const nextUrl = returnTo ?? window.location.pathname + window.location.search;
  window.location.replace(`/?auth=login&from=${encodeURIComponent(nextUrl)}`);
}

function optionalPublicSessionLookup(request) {
  if (typeof window === 'undefined') return false;
  const url = new URL(request.url || '', window.location.origin || 'http://localhost');
  const optional = request.params?.optional === true || request.params?.optional === 'true' || url.searchParams.get('optional') === 'true';
  return optional && url.pathname === '/api/auth/me/' && !/^\/(admin|instructor|alumno)(\/|$)/.test(window.location.pathname);
}

/** URL base del API. Vacío = rutas relativas (proxy Vite en dev). */
export const API_BASE_URL = import.meta.env.VITE_API_URL ?? '';

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
  timeout: 30000,
  withCredentials: true,
  paramsSerializer: urlEncodedParamsSerializer,
});

let refreshGeneration = 0;
apiClient.interceptors.request.use(async (config) => {
  config.signal = config.signal ? AbortSignal.any([config.signal as AbortSignal, sessionRequests.signal]) : sessionRequests.signal;
  (config as typeof config & { _authGeneration?: number })._authGeneration = refreshGeneration;
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

let refreshPromise: Promise<unknown> | null = null;

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

    if (error.response?.data?.code === 'session_window_mismatch') {
      if (!optionalPublicSessionLookup(originalRequest)) requestLogin(WINDOW_SESSION_MESSAGE);
      return Promise.reject(error);
    }
    if (error.response?.data?.code === 'session_idle_expired') {
      if (!optionalPublicSessionLookup(originalRequest)) requestLogin('Tu sesión ha caducado por inactividad');
      return Promise.reject(error);
    }
    // A response issued before a successful renewal may arrive after the shared
    // promise has settled. Retry it using the new cookie instead of rotating again.
    if (originalRequest._authGeneration < refreshGeneration) {
      originalRequest._retry = true;
      return apiClient(originalRequest);
    }
    if (!refreshPromise) {
      // Assign the shared promise before yielding. Concurrent 401 responses
      // must not rotate the same refresh cookie more than once.
      refreshPromise = (async () => {
        const windowId = await ensureWindowSession();
        const response = await axios.post(
          refreshUrl(),
          encodeFormBody({}),
          {
            withCredentials: true,
            timeout: 30000,
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-UASSpain-Window-Id': windowId },
          },
        );
        ++refreshGeneration;
        return response.data;
      })()
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
      if (!optionalPublicSessionLookup(originalRequest)) {
        if (refreshError?.response?.data?.code === 'session_window_mismatch') requestLogin(WINDOW_SESSION_MESSAGE);
        else if (refreshError?.response?.status === 401) requestLogin(detail === SESSION_REPLACED_MESSAGE ? detail : 'La sesión ha caducado. Vuelve a iniciar sesión.');
      }
      return Promise.reject(refreshError);
    }
  }
);

export default apiClient;
