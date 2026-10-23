import apiClient from '@/api/apiClient';
import { ensureBrowserContext, ensureWindowSession } from './windowSession';

const FLOW_KEY = 'uasspain.google_code_flow';
export async function startGoogleAuthorization(purpose: 'login' | 'verify' | 'link', currentPassword = '') {
  if (purpose === 'login') await ensureBrowserContext();
  const windowId = await ensureWindowSession();
  const path = purpose === 'login' ? '/api/auth/google/oauth/start/' : `/api/system/google-oauth/${purpose}/`;
  const { data } = await apiClient.post(path, { current_password: currentPassword });
  const url = new URL(data.authorization_url);
  if (url.origin !== 'https://accounts.google.com' || url.pathname !== '/o/oauth2/v2/auth' || url.searchParams.get('response_type') !== 'code') {
    throw new Error('Google devolvió un destino de autorización no válido.');
  }
  const redirect = new URL(url.searchParams.get('redirect_uri') || '');
  if (redirect.pathname !== '/auth/google/callback' || redirect.search || redirect.hash || redirect.username || redirect.password) {
    throw new Error('Google devolvió una ruta de callback no válida.');
  }
  if (redirect.origin !== window.location.origin) {
    throw new Error('El origen público configurado no coincide con esta ventana. Abra la dirección indicada en la configuración.');
  }
  window.sessionStorage.setItem(FLOW_KEY, JSON.stringify({ purpose, state: url.searchParams.get('state'), windowId, owner: window.sessionStorage.getItem('uasspain.window_owner') }));
  window.location.assign(url.toString());
}
