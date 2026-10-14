import { useCallback, useEffect, useState } from 'react';
import apiClient from '@/api/apiClient';
import { startGoogleAuthorization } from '@/lib/googleAuthorization';

type Config = { enabled: boolean; client_id: string; corporate_email: string; revision: number; client_secret_configured: boolean; verified_at: string | null; status: string; linked: boolean; public_origin: string | null; redirect_uri: string | null };
const defaults: Config = { enabled: false, client_id: '', corporate_email: 'info@uasspain.com', revision: 0, client_secret_configured: false, verified_at: null, status: 'NOT_CONFIGURED', linked: false, public_origin: null, redirect_uri: null };
export default function GoogleOAuthForm({ onSaved }: { onSaved: () => void }) {
  const [config, setConfig] = useState(defaults), [saved, setSaved] = useState(defaults);
  const [secret, setSecret] = useState(''), [password, setPassword] = useState(''), [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false), [loaded, setLoaded] = useState(false), [notice, setNotice] = useState('');
  const load = useCallback(async () => { const { data } = await apiClient.get('/api/system/google-oauth/'); setConfig(data); setSaved(data); setLoaded(true); }, []);
  useEffect(() => { void load().catch(() => setNotice('No se pudo cargar Google OAuth.')); const message = sessionStorage.getItem('uasspain.google_notice'); if (message) { setNotice(message); sessionStorage.removeItem('uasspain.google_notice'); } }, [load]);
  const changed = config.client_id !== saved.client_id || config.corporate_email !== saved.corporate_email || !!secret;
  const run = async (action: () => Promise<void>) => { setBusy(true); setNotice(''); try { await action(); } catch (e) { setNotice(e?.response?.data?.detail || e?.message || 'No se pudo completar Google OAuth.'); } finally { setBusy(false); } };
  const save = (event: React.FormEvent) => { event.preventDefault(); void run(async () => {
    await apiClient.put('/api/system/google-oauth/', { client_id: config.client_id, corporate_email: config.corporate_email, client_secret: secret, enabled: changed ? false : config.enabled, expected_revision: saved.revision });
    setSecret(''); await load(); onSaved(); window.dispatchEvent(new Event('uasspain.google-config-updated')); setNotice('Configuración guardada. Complete la verificación real con Google antes de activar.');
  }); };
  const begin = (purpose: 'verify' | 'link') => void run(async () => { const current = password; setPassword(''); await startGoogleAuthorization(purpose, current); });
  const unlink = () => void run(async () => {
    const current = password; setPassword('');
    await apiClient.post('/api/system/google-oauth/unlink/', { current_password: current, confirmation });
    window.location.replace('/?auth=login');
  });
  const copy = (value: string | null) => void run(async () => { if (!value) throw new Error('Falta configurar el origen público confiable.'); await navigator.clipboard.writeText(value); setNotice('Dirección copiada.'); });
  const input = 'w-full min-w-0 rounded border border-border-subtle bg-surface-muted px-3 py-2 text-sm text-foreground disabled:opacity-50';
  return <section aria-label="Google OAuth administrativo" className="mt-6 space-y-5 border-t border-border-subtle pt-5 min-w-0">
    <form aria-label="Configuración Google OAuth" onSubmit={save} className="space-y-4">
      <h3 className="font-semibold">Google OAuth 2.0</h3>
      <p className="text-sm">Estado: {saved.status} · Cuenta Google: {saved.linked ? 'Vinculada a su cuenta UASSpain' : 'Sin vincular'}</p>
      <p className="text-sm text-muted-foreground">El acceso con correo y contraseña se conserva. Este módulo no cambia el proveedor corporativo SMTP/API.</p>
      <div className="grid sm:grid-cols-2 gap-4">
        <label className="space-y-1"><span className="text-sm">Correo corporativo Google OAuth</span><input type="email" required className={input} value={config.corporate_email} disabled={busy || !loaded} onChange={e => setConfig(c => ({ ...c, corporate_email: e.target.value }))} /></label>
        <label className="space-y-1"><span className="text-sm">Google OAuth Client ID</span><input required className={input} value={config.client_id} disabled={busy || !loaded} onChange={e => setConfig(c => ({ ...c, client_id: e.target.value }))} /></label>
        <label className="space-y-1"><span className="text-sm">Google OAuth Client Secret</span><input type="password" autoComplete="new-password" className={input} value={secret} disabled={busy || !loaded} onChange={e => setSecret(e.target.value)} /></label>
      </div>
      <p className="text-xs text-muted-foreground">{saved.client_secret_configured ? 'Secreto cifrado disponible. Deje el campo vacío para conservarlo.' : 'Falta guardar un Client Secret.'} Nunca se devuelve el secreto guardado al navegador.</p>
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={config.enabled && !changed} disabled={busy || !loaded || !saved.verified_at || changed} onChange={e => setConfig(c => ({ ...c, enabled: e.target.checked }))} /> Habilitar acceso Google verificado</label>
      <button type="submit" disabled={busy || !loaded} className="rounded border border-primary/30 px-3 py-2 text-primary disabled:opacity-50">Guardar configuración Google</button>
    </form>
    <div className="space-y-3">
      <label className="block space-y-1"><span className="text-sm">Contraseña actual para verificar, vincular o desvincular</span><input type="password" autoComplete="current-password" className={input} value={password} disabled={busy} onChange={e => setPassword(e.target.value)} /></label>
      <div className="flex flex-wrap gap-3">
        <button type="button" disabled={busy || !loaded || changed || !saved.client_secret_configured || !password} onClick={() => begin('verify')} className="rounded border border-border-subtle px-3 py-2 text-sm disabled:opacity-50">Verificar con Google</button>
        <button type="button" disabled={busy || !loaded || changed || !saved.client_secret_configured || !password || saved.linked} onClick={() => begin('link')} className="rounded border border-border-subtle px-3 py-2 text-sm disabled:opacity-50">Vincular cuenta Google</button>
      </div>
      <p className="text-xs text-muted-foreground">Se abrirá la autenticación real de Google en esta ventana. Ninguna coincidencia de email concede permisos ni crea vínculos.</p>
      {saved.linked && <div className="border-t border-warning/30 pt-4 space-y-2"><p className="text-sm">Desvincular cerrará sus sesiones. Podrá entrar nuevamente con correo y contraseña.</p><label className="block space-y-1"><span className="text-sm">Escriba DESVINCULAR</span><input className={input} value={confirmation} disabled={busy} onChange={e => setConfirmation(e.target.value)} /></label><button type="button" disabled={busy || !password || confirmation !== 'DESVINCULAR'} onClick={unlink} className="rounded border border-warning/40 px-3 py-2 text-warning disabled:opacity-50">Desvincular cuenta Google</button></div>}
    </div>
    <details className="space-y-3"><summary className="cursor-pointer font-medium">Configurar Google Cloud Console</summary>
      <ol className="list-decimal pl-5 space-y-2 text-sm"><li>Seleccione el proyecto de la empresa en Google Cloud Console y abra Google Auth Platform.</li><li>Complete Branding y Audience. Si la aplicación es externa y está en Testing, añada los usuarios de prueba autorizados.</li><li>En Data Access limite los permisos a OpenID, email y perfil básico.</li><li>En Clients cree una aplicación web y registre exactamente los valores siguientes.</li><li>Guarde Client ID y Client Secret aquí con Google desactivado. Verifique, vincule su identidad explícitamente y habilite sólo después de completar la verificación.</li></ol>
      {[['Origen autorizado de JavaScript', saved.public_origin], ['URL de redirección autorizada', saved.redirect_uri]].map(([label, value]) => <div key={label} className="space-y-1"><p className="text-sm">{label}</p><code className="block break-all text-xs">{value || 'Origen público no disponible'}</code><button type="button" disabled={busy || !value} onClick={() => copy(value)} className="text-sm text-primary">Copiar {label?.toLowerCase()}</button></div>)}
      <p className="text-xs text-muted-foreground">El origen procede de FRONTEND_URL, configurado por el operador. HTTP, HTTPS y puertos son diferentes; Google exige coincidencia exacta. No se generan direcciones desde cabeceras del navegador.</p>
    </details>
    <p role="status" className="text-sm text-muted-foreground">{notice}</p>
  </section>;
}
