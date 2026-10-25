import { useEffect, useState } from 'react';
import apiClient from '@/api/apiClient';
import { canTestSmtp, smtpDefaults, smtpDirty } from '@/lib/mailSettings';

const googleDefaults = { enabled: false, client_id: '', configured: false, origins: [] as string[] };
type Props = { kind: 'smtp' | 'google'; onSaved: () => void; managedChannel?: boolean; sharedTransport?: boolean };

export default function RuntimeIntegrationForm({ kind, onSaved, managedChannel = false, sharedTransport = false }: Props) {
  const [smtp, setSmtp] = useState(smtpDefaults);
  const [savedSmtp, setSavedSmtp] = useState(smtpDefaults);
  const [google, setGoogle] = useState(googleDefaults);
  const [recipient, setRecipient] = useState('');
  const [authorized, setAuthorized] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [smtpBlocked, setSmtpBlocked] = useState(false);
  const [notice, setNotice] = useState('');
  const path = kind === 'smtp' ? '/api/system/smtp/' : '/api/system/google-oauth/';
  useEffect(() => {
    let active = true;
    setLoaded(false);
    setNotice('');
    apiClient.get(path).then(({ data }) => {
      if (!active) return;
      if (kind === 'smtp') { const saved = { ...smtpDefaults, ...data, password: '' }; setSmtp(saved); setSavedSmtp(saved); setSmtpBlocked(data.api_mode_blocked === true); }
      else setGoogle({ ...googleDefaults, ...data });
      setLoaded(true);
    }).catch(() => { if (active) setNotice('No se pudo cargar la configuración. Vuelve a abrir esta sección.'); });
    return () => { active = false; };
  }, [kind, path]);

  const save = async (event) => {
    event.preventDefault(); if (kind === 'smtp' && smtpBlocked) { setNotice('La conmutación desde el modo API requiere autorización explícita.'); return; } setBusy(true); setNotice('');
    try {
      const { data } = await apiClient.put(path, kind === 'smtp' ? smtpPayload() : { enabled: google.enabled, client_id: google.client_id });
      if (kind === 'smtp') { const saved = { ...smtpDefaults, ...data, password: '' }; setSmtp(saved); setSavedSmtp(saved); setAuthorized(false); }
      else { setGoogle({ ...googleDefaults, ...data }); window.dispatchEvent(new Event('uasspain.google-config-updated')); }
      setNotice(kind === 'smtp' && data.pending_verification ? 'Borrador SMTP guardado. El canal operativo y el 2FA se conservan; compruebe el borrador mediante una prueba autorizada y vuelva a guardar para aplicarlo.' : 'Configuración guardada.'); onSaved();
    } catch (error) { setNotice(error?.response?.data?.detail || 'No se pudo guardar la configuración.'); }
    finally { setBusy(false); }
  };
  const dirty = smtpDirty(smtp, savedSmtp);
  const smtpPayload = () => ({ ...smtp, enabled: managedChannel ? true : smtp.enabled, ...(sharedTransport ? { from_email: smtp.from_email || 'info@uasspain.com', from_name: smtp.from_name || 'UASSpain', contact_recipient: smtp.contact_recipient || 'info@uasspain.com' } : {}) });
  const testAllowed = canTestSmtp({ loaded, busy, dirty, configured: smtp.configured, authorized, recipient });
  const validate = async () => {
    setBusy(true); setNotice('');
    try {
      const { data } = await apiClient.post('/api/system/smtp/validate/', { ...smtpPayload(), enabled: true });
      setNotice(data.detail);
    } catch (error) { setNotice(error?.response?.data?.detail || 'No se pudo validar la configuración SMTP.'); }
    finally { setBusy(false); }
  };
  const test = async () => {
    if (kind === 'smtp' && !testAllowed) return;
    setBusy(true); setNotice('');
    if (kind === 'smtp') setAuthorized(false);
    try {
      const { data } = await apiClient.post(kind === 'smtp' ? '/api/system/smtp/test/' : '/api/auth/google/challenge/', kind === 'smtp' ? { recipient, confirm_authorized_recipient: true } : {});
      if (kind === 'smtp') { const refreshed = await apiClient.get(path); setSmtp(current => ({ ...current, pending_verification: refreshed.data.pending_verification === true, ready_to_activate: refreshed.data.ready_to_activate === true })); }
      setNotice(kind === 'smtp' ? data.detail : 'Challenge OAuth generado correctamente.');
    } catch (error) { setNotice(error?.response?.data?.detail || 'No se pudo completar la comprobación.'); }
    finally { setBusy(false); }
  };
  const inputClass = 'w-full rounded border border-border-subtle bg-surface-muted px-3 py-2 text-sm text-foreground';
  const smtpField = (key: keyof typeof smtpDefaults, label: string, type = 'text') => (
    <label className="block space-y-1" key={key}>
      <span className="text-sm text-muted-foreground">{label}</span>
      <input className={inputClass} type={type} value={String(smtp[key])} disabled={!loaded || busy} autoComplete={key === 'password' ? 'new-password' : 'off'}
        min={type === 'number' ? 1 : undefined} max={key === 'port' ? 65535 : key === 'timeout_seconds' ? 60 : undefined}
        onChange={(e) => { setAuthorized(false); setSmtp((current) => ({ ...current, [key]: type === 'number' ? Number(e.target.value) : e.target.value })); }} />
    </label>
  );
  const config = kind === 'smtp' ? smtp : google;
  return (
    <form onSubmit={save} className="mt-6 space-y-4 border-t border-border-subtle pt-5" aria-label={kind === 'smtp' ? 'Configuración SMTP' : 'Configuración Google OAuth'}>
      <h3 className="font-semibold">{kind === 'smtp' ? sharedTransport ? 'Transporte SMTP compartido' : 'SMTP / Correo' : 'Google OAuth'}</h3>
      {sharedTransport && <p className="text-sm text-muted-foreground">Parámetros comunes para los servicios que elijan compartir transporte. Guardar estos parámetros no acredita que el proveedor autorice ambos remitentes; cada identidad se verifica por separado.</p>}
      <p className="text-sm text-muted-foreground">{kind === 'smtp' ? (config.configured ? 'Configuración SMTP completa. La entrega requiere una comprobación autorizada.' : 'SMTP no disponible: configuración incompleta.') : config.configured ? 'Configurado' : config.enabled ? 'No configurado' : 'Deshabilitado · No configurado'}</p>
      {kind === 'smtp' && smtp.pending_verification && <p className="text-sm text-warning">Borrador SMTP: {smtp.ready_to_activate ? 'Prueba vigente; vuelva a guardar para aplicar.' : 'Pendiente de prueba autorizada.'} La configuración operativa y el 2FA no se han sustituido.</p>}
      {kind === 'google' && !managedChannel && <label className="flex gap-2 items-center"><input type="checkbox" checked={config.enabled} onChange={(e) => setGoogle({ ...google, enabled: e.target.checked })} /> Habilitado</label>}
      {kind === 'smtp' ? <>
        {dirty && <p className="text-sm text-warning">Cambios SMTP sin guardar. Guarde antes de autorizar una prueba; el envío utiliza únicamente la configuración persistida.</p>}
        <div className="grid sm:grid-cols-2 gap-4">
          {smtpField('host', 'Servidor SMTP')}{smtpField('port', 'Puerto', 'number')}
          <label className="block space-y-1"><span className="text-sm text-muted-foreground">Seguridad</span><select className={inputClass} value={smtp.security} disabled={!loaded || busy} onChange={(e) => { setAuthorized(false); setSmtp({ ...smtp, security: e.target.value }); }}><option>STARTTLS</option><option>TLS</option></select></label>
          {smtpField('username', 'Usuario SMTP')}{smtpField('password', 'Contraseña SMTP', 'password')}
          {!sharedTransport && <>{smtpField('from_email', 'Email remitente', 'email')}{smtpField('from_name', 'Nombre remitente')}{smtpField('contact_recipient', 'Email recepción contacto', 'email')}</>}{smtpField('timeout_seconds', 'Timeout (segundos)', 'number')}
        </div>
        <p className="text-xs text-muted-foreground">{smtp.password_configured ? 'Contraseña guardada. Dejar el campo vacío conserva la existente.' : 'No hay contraseña guardada.'}</p>
        <p className="text-xs text-muted-foreground">Validar sin enviar comprueba el formato y la disponibilidad de credenciales, sin conectar con el servidor. Las consultas usan el email del visitante en Reply-To.</p>
      </> : <>
        <label className="block space-y-1"><span className="text-sm text-muted-foreground">Google OAuth Client ID</span><input className={inputClass} value={google.client_id} onChange={(e) => setGoogle({ ...google, client_id: e.target.value })} placeholder="…apps.googleusercontent.com" /></label>
        <p className="text-xs text-muted-foreground">Autoriza estos orígenes en Google Cloud: {google.origins.join(', ') || 'No disponibles'}</p>
        <p className="text-xs text-muted-foreground">
          En el cliente web correspondiente a este Client ID, añade a «Orígenes autorizados de JavaScript» de Google Cloud la dirección actual: <code className="break-all">{window.location.origin}</code>.
          {' '}Incluye el protocolo y el puerto, sin rutas. HTTP y HTTPS son orígenes distintos. Guardar aquí el Client ID o generar el challenge no autoriza esta dirección en Google Cloud.
        </p>
      </>}
      <div className="flex flex-wrap gap-3 items-end">
        <button type="submit" disabled={!loaded || busy || (kind === 'smtp' && smtpBlocked)} className="rounded border border-primary/30 px-3 py-2 text-sm text-primary disabled:opacity-50">Guardar configuración</button>
        {kind === 'smtp' && <>
          <button type="button" onClick={validate} disabled={!loaded || busy} className="rounded border border-border-subtle px-3 py-2 text-sm disabled:opacity-50">Validar configuración sin enviar</button>
          {!sharedTransport && <><label className="block space-y-1"><span className="text-sm text-muted-foreground">Destinatario de prueba</span><input className={inputClass} type="email" value={recipient} disabled={!loaded || busy} onChange={(e) => { setRecipient(e.target.value); setAuthorized(false); }} /></label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={authorized} disabled={!loaded || busy || dirty} onChange={(e) => setAuthorized(e.target.checked)} /> Autorizo expresamente enviar una prueba a este destinatario.</label></>}
        </>}
        {!sharedTransport && <button type="button" onClick={test} disabled={kind === 'smtp' ? !testAllowed : !loaded || busy || !config.configured} className="rounded border border-border-subtle px-3 py-2 text-sm disabled:opacity-50">{kind === 'smtp' ? 'Enviar correo de prueba' : 'Generar challenge OAuth'}</button>}
      </div>
      <p role="status" className="text-sm text-muted-foreground">{notice}</p>
    </form>
  );
}
