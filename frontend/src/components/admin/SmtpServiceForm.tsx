import { useCallback, useEffect, useRef, useState } from 'react';
import apiClient from '@/api/apiClient';
import { canTestSmtp, smtpDefaults } from '@/lib/mailSettings';

type Transport = Omit<typeof smtpDefaults, 'password' | 'password_configured' | 'configured' | 'active_configured' | 'pending_verification' | 'ready_to_activate'>;
type Settings = { enabled: boolean; shared_transport: boolean; authorized_sender: boolean; independent_auth_required: boolean; config: Transport | null };
type View = { address: string; settings: Settings; config: Transport; revision: string; configured: boolean; validated: boolean; password_configured: boolean; verification_status: string; pending_verification: boolean; active_ready: boolean; ready_to_activate: boolean; api_mode_blocked: boolean };
const initial: Settings = { enabled: false, shared_transport: true, authorized_sender: false, independent_auth_required: false, config: null };
const inputClass = 'w-full min-w-0 rounded border border-border-subtle bg-surface-muted px-3 py-2 text-sm text-foreground disabled:opacity-50';
function transport(address: string): Transport {
  return { enabled: true, provider: '', host: '', port: 587, security: 'STARTTLS', username: '', from_email: address, from_name: 'UASSpain', contact_recipient: 'info@uasspain.com', timeout_seconds: 30 };
}
export default function SmtpServiceForm({ service, refresh, onSaved }: { service: 'contact' | 'automatic'; refresh: number; onSaved: () => void }) {
  const title = service === 'contact' ? 'Correo bidireccional' : 'Correo automático';
  const address = service === 'contact' ? 'info@uasspain.com' : 'no-reply@uasspain.com';
  const path = `/api/system/smtp/services/${service}/`;
  const [view, setView] = useState<View | null>(null);
  const [settings, setSettings] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [password, setPassword] = useState('');
  const [recipient, setRecipient] = useState('');
  const [authorized, setAuthorized] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const request = useRef(0), dirtyRef = useRef(false);
  const testRequest = useRef<{ revision: string; recipient: string; id: string } | null>(null);
  const dirty = password.length > 0 || JSON.stringify(settings) !== JSON.stringify(saved);
  dirtyRef.current = dirty;
  const accept = (data: View) => { setView(data); setSettings(data.settings); setSaved(data.settings); setPassword(''); setAuthorized(false); };
  const load = useCallback(async () => {
    const id = ++request.current;
    try { const { data } = await apiClient.get(path); if (id !== request.current) return; setView(data); if (!dirtyRef.current) { setSettings(data.settings); setSaved(data.settings); } setAuthorized(false); }
    catch (error) { if (id === request.current) setNotice(error?.response?.data?.detail || 'No se pudo cargar el servicio SMTP.'); }
  }, [path]);
  useEffect(() => { void load(); return () => { request.current++; }; }, [load, refresh]);
  const run = async (action: () => Promise<void>) => { setBusy(true); setNotice(''); setAuthorized(false); try { await action(); } catch (error) { setNotice(error?.response?.data?.detail || 'No se pudo completar la operación SMTP.'); } finally { setBusy(false); } };
  const change = (next: Settings) => { setSettings(next); setAuthorized(false); };
  const save = (event: React.FormEvent) => { event.preventDefault(); void run(async () => { const { data } = await apiClient.put(path, { settings, password }); accept(data); setNotice(data.pending_verification ? 'Borrador guardado. El servicio activo se conserva; compruebe el borrador y vuelva a guardar para aplicarlo.' : 'Configuración guardada. La autorización de este remitente requiere su propia prueba.'); onSaved(); }); };
  const validate = () => void run(async () => { const { data } = await apiClient.post(`${path}validate/`, { settings, password }); setNotice(data.detail); });
  const sendAllowed = canTestSmtp({ loaded: !!view, busy, dirty, configured: view?.configured === true && !view.api_mode_blocked && view.verification_status !== 'UNKNOWN', authorized, recipient });
  const test = () => { if (!sendAllowed || !view) return; if (!testRequest.current || testRequest.current.revision !== view.revision || testRequest.current.recipient !== recipient) testRequest.current = { revision: view.revision, recipient, id: crypto.randomUUID() }; const requestId = testRequest.current.id; void run(async () => { let data; try { ({ data } = await apiClient.post(`${path}test/`, { recipient, revision: view.revision, request_id: requestId, confirm_authorized_recipient: true })); } catch (error) { try { const refreshed = await apiClient.get(path); accept(refreshed.data); if (refreshed.data.verification_status === 'FAILED') testRequest.current = null; if (refreshed.data.verification_status === 'UNKNOWN') error.response = { data: { detail: 'Resultado incierto: no se repetirá esta prueba. Revise el registro antes de continuar.' } }; } catch { /* Preserve the original operation error. */ } throw error; } const refreshed = await apiClient.get(path); accept(refreshed.data); testRequest.current = null; setNotice(data.detail); onSaved(); }); };
  const independent = settings.config || transport(address);
  const field = (key: 'host' | 'port' | 'username' | 'timeout_seconds', label: string, type = 'text') => <label className="block space-y-1"><span className="text-sm text-muted-foreground">{label}</span><input className={inputClass} type={type} value={independent[key]} min={type === 'number' ? 1 : undefined} max={key === 'port' ? 65535 : key === 'timeout_seconds' ? 60 : undefined} onChange={e => change({ ...settings, config: { ...independent, [key]: type === 'number' ? Number(e.target.value) : e.target.value } })} /></label>;
  return <form aria-label={title} onSubmit={save} className="mt-6 min-w-0 space-y-4 rounded border border-border-subtle p-4">
    <h3 className="font-semibold">{title}</h3><p className="font-medium break-all">{address}</p>
    <p className="text-sm text-muted-foreground">{service === 'contact' ? 'Recibe consultas de la web en info@uasspain.com. Reply-To conserva la dirección validada del visitante para responder desde el buzón corporativo. No envía OTP ni recuperaciones.' : 'Envía recuperación de contraseñas, registro, OTP/2FA y notificaciones. Sin Reply-To del visitante. La política de respuestas del buzón no está verificada.'}</p>
    <p className="text-xs text-muted-foreground">Configuración: {view?.configured ? 'CONFIGURED' : 'Pendiente'} · Formato: {view?.validated ? 'VALIDATED' : 'Pendiente'} · Verificación: {view?.verification_status || 'Cargando'} · Servicio activo: {view?.active_ready ? 'Disponible' : 'No disponible'}</p>
    <p className="text-xs text-muted-foreground">La aceptación SMTP no acredita recepción ni lectura. La recepción de info@uasspain.com y la respuesta desde el buzón dependen del proveedor entrante y siguen pendientes de validación externa.</p>
    {view?.api_mode_blocked && <p role="alert" className="text-sm text-warning">El modo API continúa guardado. Se requiere autorización para conmutar; no se ha modificado su configuración.</p>}
    {view?.pending_verification && <p className="text-sm text-warning">Borrador pendiente: {view.ready_to_activate ? 'Prueba vigente; vuelva a guardar para aplicar.' : 'Requiere prueba autorizada.'} El servicio activo se conserva.</p>}
    <fieldset disabled={!view || busy || view.api_mode_blocked} className="space-y-4 min-w-0">
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={settings.enabled} onChange={e => change({ ...settings, enabled: e.target.checked })} /> Habilitar este servicio</label>
      <label className="block space-y-1"><span className="text-sm text-muted-foreground">Transporte</span><select className={inputClass} value={settings.shared_transport ? 'shared' : 'independent'} onChange={e => { if (e.target.value === 'shared') setPassword(''); change({ ...settings, shared_transport: e.target.value === 'shared', config: e.target.value === 'shared' ? null : independent }); }}><option value="shared">SMTP compartido</option><option value="independent">SMTP independiente, si lo exige el proveedor</option></select></label>
      {settings.shared_transport ? <p className="text-sm text-muted-foreground">Utiliza los parámetros y la contraseña del transporte compartido, mostrados una sola vez arriba. Cada remitente necesita autorización y prueba propias.</p> : <>
        <label className="flex gap-2 text-sm"><input type="checkbox" checked={settings.independent_auth_required} onChange={e => change({ ...settings, independent_auth_required: e.target.checked })} /> El proveedor exige autenticación independiente para este servicio.</label>
        <div className="grid gap-4 sm:grid-cols-2">{field('host', 'Servidor SMTP')}{field('port', 'Puerto', 'number')}
          <label className="block space-y-1"><span className="text-sm text-muted-foreground">Seguridad</span><select className={inputClass} value={independent.security} onChange={e => change({ ...settings, config: { ...independent, security: e.target.value } })}><option>STARTTLS</option><option>TLS</option></select></label>
          {field('username', 'Usuario SMTP')}<label className="block space-y-1"><span className="text-sm text-muted-foreground">Contraseña SMTP</span><input className={inputClass} type="password" autoComplete="new-password" value={password} onChange={e => { setPassword(e.target.value); setAuthorized(false); }} /></label>{field('timeout_seconds', 'Timeout (segundos)', 'number')}
        </div><p className="text-xs text-muted-foreground">{view?.password_configured && !view.settings.shared_transport ? 'Credencial cifrada disponible.' : 'Sin credencial guardada.'} Dejar la contraseña vacía conserva la existente; nunca se devuelve al navegador.</p>
      </>}
      <div className="grid gap-4 sm:grid-cols-2"><label className="block space-y-1"><span className="text-sm text-muted-foreground">Remitente</span><input className={inputClass} value={address} readOnly /></label>{service === 'contact' && <label className="block space-y-1"><span className="text-sm text-muted-foreground">Buzón destinatario</span><input className={inputClass} value="info@uasspain.com" readOnly /></label>}</div>
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={settings.authorized_sender} onChange={e => change({ ...settings, authorized_sender: e.target.checked })} /> He confirmado en el proveedor que este remitente exacto está autorizado.</label>
      {dirty && <p role="status" className="text-sm text-warning">Cambios sin guardar. La prueba utiliza exclusivamente la configuración guardada.</p>}
      <div className="flex flex-wrap gap-3"><button type="submit" className="rounded border border-primary/30 px-3 py-2 text-sm text-primary">Guardar configuración</button><button type="button" className="rounded border border-border-subtle px-3 py-2 text-sm" onClick={validate}>Validar sin enviar</button></div>
      <label className="block space-y-1"><span className="text-sm text-muted-foreground">Destinatario de prueba</span><input className={inputClass} type="email" value={recipient} onChange={e => { setRecipient(e.target.value); setAuthorized(false); }} /></label>
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={authorized} disabled={dirty} onChange={e => setAuthorized(e.target.checked)} /> Autorizo expresamente una prueba de este servicio a este destinatario.</label>
      <button type="button" className="rounded border border-border-subtle px-3 py-2 text-sm disabled:opacity-50" disabled={!sendAllowed} onClick={test}>Enviar correo de prueba</button>
    </fieldset><p role="status" className="text-sm text-muted-foreground">{notice}</p>
  </form>;
}
