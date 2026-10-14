type Callback = { code: string; state: string; purpose: 'login' | 'verify' | 'link' };
let pending: Callback | Error | undefined;
let consumed = false;
export function prepareGoogleCallback() {
  if (pending || consumed) return;
  const query = new URLSearchParams(window.location.search);
  const code = query.get('code'), state = query.get('state'), canceled = query.has('error');
  const raw = window.sessionStorage.getItem('uasspain.google_code_flow');
  window.sessionStorage.removeItem('uasspain.google_code_flow');
  window.history.replaceState(null, '', '/auth/google/callback');
  try {
    if (canceled) throw new Error('Autorización con Google cancelada. El acceso convencional sigue disponible.');
    const flow = raw ? JSON.parse(raw) : null;
    if (!code || !state || !flow || state !== flow.state || !['login', 'verify', 'link'].includes(flow.purpose) || !/^[a-f0-9-]{36}$/.test(flow.windowId) || !/^[a-f0-9-]{36}$/.test(flow.owner)) throw new Error('La autorización no pertenece a esta ventana o ha caducado. Reinicie el proceso.');
    window.name = `uasspain.tab:${flow.owner}`;
    window.sessionStorage.setItem('uasspain.window_session_id', flow.windowId);
    window.sessionStorage.setItem('uasspain.window_session_handoff', flow.windowId);
    pending = { code, state, purpose: flow.purpose };
  } catch (error) { pending = error instanceof Error ? error : new Error('Autorización no válida.'); }
}
export function takeGoogleCallback(): Callback {
  prepareGoogleCallback();
  const result = pending;
  consumed = true; pending = undefined;
  if (result instanceof Error) throw result;
  if (!result) throw new Error('La autorización ya se ha utilizado. Reinicie el proceso.');
  return result;
}
