import { useEffect, useState } from 'react';
import apiClient from '@/api/apiClient';

const smtpDefaults = { enabled: false, provider: '', host: '', port: 587, security: 'STARTTLS', username: '', password: '', password_configured: false, from_email: '', from_name: '', contact_recipient: '', timeout_seconds: 30, configured: false };
const googleDefaults = { enabled: false, client_id: '', configured: false, origins: [] as string[] };
type Props = { kind: 'smtp' | 'google'; onSaved: () => void };

export default function RuntimeIntegrationForm({ kind, onSaved }: Props) {
  const [smtp, setSmtp] = useState(smtpDefaults);
  const [google, setGoogle] = useState(googleDefaults);
  const [recipient, setRecipient] = useState('');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [notice, setNotice] = useState('');
  const path = kind === 'smtp' ? '/api/system/smtp/' : '/api/system/google-oauth/';
  useEffect(() => {
    let active = true;
    setLoaded(false);
    setNotice('');
    apiClient.get(path).then(({ data }) => {
      if (!active) return;
      if (kind === 'smtp') setSmtp({ ...smtpDefaults, ...data, password: '' });
      else setGoogle({ ...googleDefaults, ...data });
      setLoaded(true);
    }).catch(() => { if (active) setNotice('No se pudo cargar la configuración. Vuelve a abrir esta sección.'); });
    return () => { active = false; };
  }, [kind, path]);

  const save = async (event) => {
    event.preventDefault(); setBusy(true); setNotice('');
    try {
      const { data } = await apiClient.put(path, kind === 'smtp' ? smtp : { enabled: google.enabled, client_id: google.client_id });
      if (kind === 'smtp') setSmtp({ ...smtpDefaults, ...data, password: '' });
      else { setGoogle({ ...googleDefaults, ...data }); window.dispatchEvent(new Event('uasspain.google-config-updated')); }
      setNotice('Configuración guardada.'); onSaved();
    } catch (error) { setNotice(error?.response?.data?.detail || 'No se pudo guardar la configuración.'); }
    finally { setBusy(false); }
  };
  const test = async () => {
    setBusy(true); setNotice('');
    try {
      const { data } = await apiClient.post(kind === 'smtp' ? '/api/system/smtp/test/' : '/api/auth/google/challenge/', kind === 'smtp' ? { recipient } : {});
      setNotice(kind === 'smtp' ? data.detail : 'Challenge OAuth generado correctamente.');
    } catch (error) { setNotice(error?.response?.data?.detail || 'No se pudo completar la comprobación.'); }
    finally { setBusy(false); }
  };
  const inputClass = 'w-full rounded border border-border-subtle bg-surface-muted px-3 py-2 text-sm text-foreground';
  const smtpField = (key: keyof typeof smtpDefaults, label: string, type = 'text') => (
    <label className="block space-y-1" key={key}>
      <span className="text-sm text-muted-foreground">{label}</span>
      <input className={inputClass} type={type} value={String(smtp[key])} autoComplete={key === 'password' ? 'new-password' : 'off'}
        min={type === 'number' ? 1 : undefined} max={key === 'port' ? 65535 : key === 'timeout_seconds' ? 60 : undefined}
        onChange={(e) => setSmtp((current) => ({ ...current, [key]: type === 'number' ? Number(e.target.value) : e.target.value }))} />
    </label>
  );
  const config = kind === 'smtp' ? smtp : google;
  return (
    <form onSubmit={save} className="mt-6 space-y-4 border-t border-border-subtle pt-5" aria-label={kind === 'smtp' ? 'Configuración SMTP' : 'Configuración Google OAuth'}>
      <h3 className="font-semibold">{kind === 'smtp' ? 'SMTP / Correo' : 'Google OAuth'}</h3>
      <p className="text-sm text-muted-foreground">{config.configured ? 'Configurado' : config.enabled ? 'No configurado' : 'Deshabilitado · No configurado'}</p>
      <label className="flex gap-2 items-center"><input type="checkbox" checked={config.enabled} onChange={(e) => kind === 'smtp' ? setSmtp({ ...smtp, enabled: e.target.checked }) : setGoogle({ ...google, enabled: e.target.checked })} /> Habilitado</label>
      {kind === 'smtp' ? <>
        <div className="grid sm:grid-cols-2 gap-4">
          {smtpField('provider', 'Proveedor (opcional)')}{smtpField('host', 'Servidor SMTP')}{smtpField('port', 'Puerto', 'number')}
          <label className="block space-y-1"><span className="text-sm text-muted-foreground">Seguridad</span><select className={inputClass} value={smtp.security} onChange={(e) => setSmtp({ ...smtp, security: e.target.value })}><option>STARTTLS</option><option>TLS</option></select></label>
          {smtpField('username', 'Usuario SMTP')}{smtpField('password', 'Contraseña SMTP', 'password')}
          {smtpField('from_email', 'Email remitente', 'email')}{smtpField('from_name', 'Nombre remitente')}
          {smtpField('contact_recipient', 'Email recepción contacto', 'email')}{smtpField('timeout_seconds', 'Timeout (segundos)', 'number')}
        </div>
        <p className="text-xs text-muted-foreground">{smtp.password_configured ? 'Contraseña guardada. Dejar el campo vacío conserva la existente.' : 'No hay contraseña guardada.'}</p>
      </> : <>
        <label className="block space-y-1"><span className="text-sm text-muted-foreground">Google OAuth Client ID</span><input className={inputClass} value={google.client_id} onChange={(e) => setGoogle({ ...google, client_id: e.target.value })} placeholder="…apps.googleusercontent.com" /></label>
        <p className="text-xs text-muted-foreground">Autoriza estos orígenes en Google Cloud: {google.origins.join(', ') || 'No disponibles'}</p>
      </>}
      <div className="flex flex-wrap gap-3 items-end">
        <button type="submit" disabled={!loaded || busy} className="rounded border border-primary/30 px-3 py-2 text-sm text-primary disabled:opacity-50">Guardar configuración</button>
        {kind === 'smtp' && <label className="block space-y-1"><span className="text-sm text-muted-foreground">Destinatario de prueba</span><input className={inputClass} type="email" value={recipient} onChange={(e) => setRecipient(e.target.value)} /></label>}
        <button type="button" onClick={test} disabled={!loaded || busy || !config.configured || (kind === 'smtp' && !recipient)} className="rounded border border-border-subtle px-3 py-2 text-sm disabled:opacity-50">{kind === 'smtp' ? 'Enviar correo de prueba' : 'Generar challenge OAuth'}</button>
      </div>
      <p role="status" className="text-sm text-muted-foreground">{notice}</p>
    </form>
  );
}
