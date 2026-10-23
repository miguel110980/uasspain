import { useCallback, useEffect, useState } from 'react';
import apiClient from '@/api/apiClient';
import RuntimeIntegrationForm from './RuntimeIntegrationForm';

const defaults = { provider: 'postmark', from_email: 'no-reply@uasspain.com', from_name: 'UASSpain', contact_recipient: 'info@uasspain.com', sender_panel_confirmed: false };
type Message = { id: string; message_type: string; provider: string; state: string; attempts: number; created_at: string; last_error: string; provider_latency_ms: number | null };
type Monitor = { channel: string; counts: Record<string, number>; alerts: string[]; queue_age_seconds: number | null; circuits: { provider: string; state: string; failures: number }[]; migration: { state: string; last_passed: string } | null; transitions: { id: string; previous_state: string; new_state: string; created_at: string }[]; messages: Message[] };

export default function MailIntegrationForm({ onSaved }: { onSaved: () => void }) {
  const [config, setConfig] = useState(defaults);
  const [savedConfig, setSavedConfig] = useState(defaults);
  const [exclusive, setExclusive] = useState(false);
  const [activeExclusive, setActiveExclusive] = useState(false);
  const [channelReady, setChannelReady] = useState(false);
  const [key, setKey] = useState('');
  const [keyConfigured, setKeyConfigured] = useState(false);
  const [senderStatus, setSenderStatus] = useState('UNCONFIRMED');
  const [recipient, setRecipient] = useState('');
  const [authorized, setAuthorized] = useState(false);
  const [rollback, setRollback] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [notice, setNotice] = useState('');
  const [monitor, setMonitor] = useState<Monitor | null>(null);
  const load = useCallback(async (selection?: boolean) => {
    const [{ data }, { data: status }] = await Promise.all([apiClient.get('/api/system/mail/'), apiClient.get('/api/system/mail/monitor/')]);
    const saved = { ...data.config, ...defaults, sender_panel_confirmed: data.config.sender_panel_confirmed };
    setConfig(saved); setSavedConfig(saved); setExclusive(selection ?? data.api_exclusive); setActiveExclusive(data.api_exclusive);
    setKeyConfigured(data.key_configured); setSenderStatus(data.sender_status); setChannelReady(data.channel_ready === true); setMonitor(status); setLoaded(true);
  }, []);
  useEffect(() => { let mounted = true; void load().catch(() => { if (mounted) setNotice('No se pudo cargar la configuración de correo.'); }); return () => { mounted = false; }; }, [load]);
  const refreshMonitor = async () => { const { data } = await apiClient.get('/api/system/mail/monitor/'); setMonitor(data); };
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setNotice('');
    try { await action(); } catch (error) {
      setNotice(error?.response?.data?.detail || 'No se pudo completar la operación.');
      try { await refreshMonitor(); } catch { /* Preserve the original operation error. */ }
    }
    finally { setBusy(false); }
  };
  const save = (event: React.FormEvent) => { event.preventDefault(); void run(async () => {
    const draftOnly = exclusive && !activeExclusive && (!!key || senderStatus !== 'VERIFIED');
    try {
      await apiClient.put('/api/system/mail/', { api_exclusive: draftOnly ? activeExclusive : exclusive, config: exclusive ? config : savedConfig, api_key: exclusive ? key : '', confirm_rollback: rollback });
    } catch (error) {
      setExclusive(activeExclusive);
      throw error;
    }
    if (exclusive) setKey(''); setRollback(false); await load(draftOnly ? exclusive : undefined); setNotice(draftOnly ? 'Configuración API guardada sin activar. SMTP sigue vigente; verifique las credenciales y el remitente mediante una prueba autorizada y vuelva a guardar para cambiar de canal.' : 'Configuración guardada. Una clave nueva queda pendiente de prueba antes de sustituir la activa.'); onSaved();
  }); };
  const test = () => void run(async () => {
    const { data } = await apiClient.post('/api/system/mail/test/', { recipient, confirm_authorized_recipient: authorized });
    await load(exclusive); setNotice(data.detail);
  });
  const validatePayload = () => void run(async () => {
    const { data } = await apiClient.post('/api/system/mail/test/', { recipient: 'info@uasspain.com', dry_run: true });
    await load(exclusive); setNotice(data.detail);
  });
  const reconcile = (id: string) => void run(async () => { const { data } = await apiClient.post(`/api/system/mail/messages/${id}/reconcile/`, {}); setNotice(data.detail); await refreshMonitor(); });
  const testRollback = () => void run(async () => {
    const { data } = await apiClient.post('/api/system/smtp/test/', { recipient, confirm_rollback: rollback }); setNotice(data.detail); await refreshMonitor();
  });
  const inputClass = 'w-full min-w-0 rounded border border-border-subtle bg-surface-muted px-3 py-2 text-sm text-foreground disabled:opacity-50';
  const field = (name: 'from_email' | 'from_name' | 'contact_recipient', label: string, type = 'text') => <label className="block space-y-1"><span className="text-sm text-muted-foreground">{label}</span><input className={inputClass} type={type} value={defaults[name]} readOnly /></label>;
  return <div className="mt-6 space-y-5 border-t border-border-subtle pt-5 min-w-0">
    <form aria-label="Configuración API de correo" className="space-y-4" onSubmit={save}>
      <h3 className="font-semibold">API / SMTP</h3>
      <p className="text-sm text-muted-foreground">Canal guardado: {activeExclusive ? 'Postmark API' : 'SMTP'}{channelReady ? '' : ' (no disponible)'}. Remitente API: {senderStatus === 'VERIFIED' ? 'Verificado por el proveedor' : senderStatus === 'PENDING_VERIFICATION' ? 'Pendiente de prueba con el proveedor' : 'Sin confirmar'}.</p>
      {exclusive !== activeExclusive && <p role="status" className="text-sm text-warning">Cambio de canal sin guardar. Sigue vigente {activeExclusive ? 'Postmark API' : 'SMTP'}. Activar API requiere credenciales y remitente verificados.</p>}
      <fieldset disabled={!loaded || busy} className="flex flex-wrap gap-4">
        <legend className="mb-2 text-sm font-medium">Canal de correo</legend>
        <label className="flex gap-2 items-center"><input type="radio" name="mail-channel" value="api" checked={loaded && exclusive} onChange={() => setExclusive(true)} /> API — Postmark</label>
        <label className="flex gap-2 items-center"><input type="radio" name="mail-channel" value="smtp" checked={loaded && !exclusive} onChange={() => setExclusive(false)} /> SMTP</label>
      </fieldset>
      <fieldset disabled={!loaded || busy || !exclusive} aria-label="Configuración API" className="min-w-0 space-y-4">
      <div className="grid sm:grid-cols-2 gap-4">
        <label className="block space-y-1"><span className="text-sm text-muted-foreground">Proveedor API</span><select className={inputClass} value={config.provider} disabled={busy} onChange={event => setConfig(value => ({ ...value, provider: event.target.value }))}><option value="postmark">Postmark</option></select></label>
        <label className="block space-y-1"><span className="text-sm text-muted-foreground">API Key</span><input className={inputClass} type="password" autoComplete="new-password" value={key} disabled={busy} onChange={event => setKey(event.target.value)} /></label>
        {field('from_email', 'Email remitente API', 'email')}{field('from_name', 'Nombre remitente API')}{field('contact_recipient', 'Email recepción contacto API', 'email')}
      </div>
      <p className="text-xs text-muted-foreground">{keyConfigured ? 'Secreto disponible. Dejar la API Key vacía conserva la existente.' : 'No hay API Key configurada.'} Guardar prepara la configuración; la activación requiere una prueba real autorizada. Validar sin entrega sólo comprueba el formato del mensaje.</p>
      <p className="text-xs text-muted-foreground">Las consultas llegan a info@uasspain.com con el correo del visitante en Reply-To. El personal responde desde ese buzón mediante su servicio corporativo de correo.</p>
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={config.sender_panel_confirmed} disabled={busy} onChange={event => setConfig(value => ({ ...value, sender_panel_confirmed: event.target.checked }))} /> He comprobado en el panel de Postmark que este remitente está autorizado.</label>
      <div className="grid sm:grid-cols-2 gap-4">
        <label className="block space-y-1"><span className="text-sm text-muted-foreground">Destinatario de prueba API</span><input type="email" className={inputClass} value={recipient} disabled={busy} onChange={event => setRecipient(event.target.value)} /></label>
        <label className="flex gap-2 items-center text-sm"><input type="checkbox" checked={authorized} disabled={busy} onChange={event => setAuthorized(event.target.checked)} /> Autorizo enviar una prueba a este destinatario.</label>
      </div>
      <div className="flex flex-wrap gap-3">
        <button className="rounded border border-border-subtle px-3 py-2 text-sm disabled:opacity-50" disabled={!loaded || busy} type="button" onClick={validatePayload}>Validar formato sin enviar</button>
        <button className="rounded border border-border-subtle px-3 py-2 text-sm disabled:opacity-50" disabled={!loaded || busy || !keyConfigured || !recipient || !authorized || !config.sender_panel_confirmed} type="button" onClick={test}>Enviar correo de prueba API</button>
      </div>
      </fieldset>
      {activeExclusive && <fieldset disabled={!loaded || busy || exclusive} aria-label="Reversión SMTP" className="space-y-3">
        <label className="flex gap-2 text-sm"><input type="checkbox" checked={rollback} onChange={event => setRollback(event.target.checked)} /> Autorizo comprobar SMTP y realizar una reversión sin borrar mensajes ni credenciales.</label>
        <label className="block space-y-1"><span className="text-sm text-muted-foreground">Destinatario de prueba SMTP para reversión</span><input type="email" className={inputClass} value={recipient} onChange={event => setRecipient(event.target.value)} /></label>
        <label className="flex gap-2 items-center text-sm"><input type="checkbox" checked={authorized} onChange={event => setAuthorized(event.target.checked)} /> Autorizo enviar una prueba SMTP a este destinatario.</label>
        <button type="button" className="rounded border border-border-subtle px-3 py-2 text-sm disabled:opacity-50" disabled={!rollback || !authorized || !recipient} onClick={testRollback}>Comprobar SMTP para reversión</button>
      </fieldset>}
      <button className="rounded border border-primary/30 px-3 py-2 text-sm text-primary disabled:opacity-50" disabled={!loaded || busy} type="submit">Guardar canal y configuración</button>
      <p role="status" className="text-sm text-muted-foreground">{notice}</p>
    </form>
    <fieldset disabled={!loaded || exclusive || busy} className="min-w-0">
      <legend className="text-sm text-muted-foreground">{exclusive ? 'Configuración SMTP conservada; edición bloqueada mientras se selecciona API.' : 'Configuración SMTP'}</legend>
      <RuntimeIntegrationForm kind="smtp" managedChannel onSaved={() => { void load().catch(() => setNotice('No se pudo actualizar el estado del correo.')); onSaved(); }} />
    </fieldset>
    <section aria-label="Monitorización de correo" className="space-y-3 min-w-0">
      <div className="flex flex-wrap justify-between gap-2"><h3 className="font-semibold">Monitorización de correo</h3><button type="button" className="text-sm text-primary" disabled={busy} onClick={() => void run(refreshMonitor)}>Actualizar correo</button></div>
      <p className="text-sm">Migración: {monitor?.migration?.state || 'NOT_STARTED'} · Última fase superada: {monitor?.migration?.last_passed || 'NOT_STARTED'}</p>
      <p className="text-sm text-muted-foreground">Pendientes: {(monitor?.counts.PENDING || 0) + (monitor?.counts.RETRY_SCHEDULED || 0)} · Aceptados: {monitor?.counts.ACCEPTED || 0} · Entregados según proveedor: {monitor?.counts.DELIVERED || 0} · Fallidos: {monitor?.counts.FAILED || 0} · Inciertos: {monitor?.counts.UNKNOWN || 0}</p>
      <p className="text-xs text-muted-foreground">{monitor?.circuits.map(circuit => `${circuit.provider}: ${circuit.state} (${circuit.failures} fallos)`).join(' · ')}</p>
      <p className="text-xs text-muted-foreground">La aceptación de Postmark y la entrega al servidor receptor no acreditan lectura en el buzón. La recepción corporativa y el destinatario al pulsar Responder siguen pendientes de validación externa.</p>
      {monitor?.alerts.length ? <ul className="space-y-1 text-sm text-warning" aria-label="Alertas de correo">{monitor.alerts.map(alert => <li key={alert}>{alert}</li>)}</ul> : null}
      <div className="max-w-full overflow-x-auto"><table className="w-full min-w-[1040px] text-xs"><caption className="text-left text-sm pb-2">Últimos envíos</caption><thead><tr>{['ID', 'Tipo', 'Canal', 'Estado', 'Intentos', 'Fecha', 'Resultado', 'Acción'].map(label => <th key={label} className="text-left p-2">{label}</th>)}</tr></thead><tbody>{monitor?.messages.map(message => <tr key={message.id} className="border-t border-border-subtle"><td className="p-2 font-mono whitespace-nowrap">{message.id}</td><td className="p-2">{message.message_type}</td><td className="p-2">{message.provider}</td><td className="p-2">{message.state}</td><td className="p-2">{message.attempts}</td><td className="p-2 whitespace-nowrap">{new Date(message.created_at).toLocaleString('es-ES')}</td><td className="p-2">{message.last_error || (message.provider_latency_ms == null ? 'Pendiente' : `${message.provider_latency_ms} ms`)}</td><td className="p-2">{message.provider === 'postmark' && ['ACCEPTED', 'UNKNOWN', 'DELIVERED'].includes(message.state) && <button type="button" className="text-primary whitespace-nowrap" disabled={busy} onClick={() => reconcile(message.id)}>Comprobar resultado</button>}</td></tr>)}</tbody></table></div>
      <details><summary className="cursor-pointer text-sm">Historial de migración</summary><ol className="mt-2 space-y-1 text-xs">{monitor?.transitions.map(transition => <li key={transition.id}>{new Date(transition.created_at).toLocaleString('es-ES')} · {transition.previous_state} → {transition.new_state}</li>)}</ol></details>
    </section>
  </div>;
}
