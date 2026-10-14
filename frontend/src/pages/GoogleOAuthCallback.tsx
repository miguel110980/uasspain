import { useEffect, useRef, useState } from 'react';
import apiClient from '@/api/apiClient';
import { takeGoogleCallback } from '@/lib/googleCallbackHandoff';
import authService from '@/services/authService';
import { ensureWindowSession } from '@/lib/windowSession';

export default function GoogleOAuthCallback() {
  const started = useRef(false);
  const [notice, setNotice] = useState('Comprobando la autenticación con Google…');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      const flow = takeGoogleCallback();
      await ensureWindowSession();
      const path = flow.purpose === 'login' ? '/api/auth/google/oauth/complete/' : '/api/system/google-oauth/complete/';
      await apiClient.post(path, { code: flow.code, state: flow.state });
      if (flow.purpose === 'login') {
        await authService.redirectAfterLogin();
      } else {
        window.sessionStorage.setItem('uasspain.google_notice', 'Autenticación real completada. Revise el vínculo y active Google sólo cuando corresponda.');
        window.location.replace('/admin?section=configuracion&tab=integraciones');
      }
    })().catch(error => { setFailed(true); setNotice(error?.response?.data?.detail || error?.message || 'No se pudo completar Google. Puede acceder con correo y contraseña.'); });
  }, []);
  return <main className="min-h-screen bg-background text-foreground flex items-center justify-center p-4"><section className="w-full max-w-lg rounded-xl border border-border-subtle bg-surface p-6 space-y-4">
    <h1 className="text-xl font-semibold">Autenticación Google</h1>
    <p role={failed ? 'alert' : 'status'}>{notice}</p>
    {failed && <a className="text-primary underline" href="/?auth=login">Acceder con correo y contraseña</a>}
  </section></main>;
}
