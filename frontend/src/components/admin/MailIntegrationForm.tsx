import { useCallback, useEffect, useRef, useState } from 'react';
import apiClient from '@/api/apiClient';
import { usePanelAuthContext } from '@/context/PanelAuthContext';
import { clearMailHistory, mailHistoryKey, parseMailHistoryMarker, visibleMailMessages, type MailHistoryMarker } from '@/lib/mailSettings';
import RuntimeIntegrationForm from './RuntimeIntegrationForm';
import SmtpServiceForm from './SmtpServiceForm';

type Message = { id: string; message_type: string; provider: string; state: string; attempts: number; created_at: string; last_error: string; provider_latency_ms: number | null };
type Monitor = { counts: Record<string, number>; alerts: string[]; circuits: { provider: string; state: string; failures: number }[]; messages: Message[]; observed_at?: string };

export default function MailIntegrationForm({ onSaved }: { onSaved: () => void }) {
  const { profile } = usePanelAuthContext();
  const storageKey = mailHistoryKey(profile.id);
  const [marker, setMarker] = useState<MailHistoryMarker | null>(() => {
    try { return parseMailHistoryMarker(localStorage.getItem(storageKey)); } catch { return null; }
  });
  const [monitor, setMonitor] = useState<Monitor | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [transportRevision, setTransportRevision] = useState(0);
  const requestId = useRef(0);
  const observedAt = useRef(0);
  const refreshMonitor = useCallback(async () => {
    const id = ++requestId.current;
    setBusy(true);
    try {
      const { data } = await apiClient.get('/api/system/mail/monitor/');
      if (id !== requestId.current) return;
      observedAt.current = performance.now();
      setMonitor(data); setNotice('');
    } catch (error) {
      if (id === requestId.current) setNotice(error?.response?.data?.detail || 'No se pudo actualizar el historial de correo.');
    } finally { if (id === requestId.current) setBusy(false); }
  }, []);
  useEffect(() => {
    void refreshMonitor();
    return () => { requestId.current++; };
  }, [refreshMonitor]);
  useEffect(() => {
    try { setMarker(parseMailHistoryMarker(localStorage.getItem(storageKey))); } catch { setNotice('El navegador no permite guardar la visibilidad del historial.'); }
    const sync = (event: StorageEvent) => {
      if (event.key !== storageKey) return;
      const incoming = parseMailHistoryMarker(event.newValue);
      if (incoming) setMarker(current => !current || incoming.through >= current.through ? incoming : current);
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, [storageKey]);
  const messages = visibleMailMessages(monitor?.messages || [], marker);
  const clearHistory = () => {
    if (!monitor || !window.confirm('¿Ocultar el historial anterior en este navegador para tu usuario? Los registros operativos, estadísticas y auditoría se conservan. Los nuevos eventos seguirán apareciendo.')) return;
    try {
      const persisted = parseMailHistoryMarker(localStorage.getItem(storageKey));
      const previous = persisted && (!marker || persisted.through > marker.through) ? persisted : marker;
      const next = clearMailHistory(monitor.messages, monitor.observed_at, performance.now() - observedAt.current, previous);
      localStorage.setItem(storageKey, JSON.stringify(next));
      setMarker(next); setNotice('Historial anterior ocultado para tu usuario en este navegador. Los registros del servidor se conservan.');
    } catch { setNotice('No se pudo guardar la limpieza del historial. Comprueba el almacenamiento del navegador.'); }
  };
  return <div className="min-w-0">
    <RuntimeIntegrationForm kind="smtp" managedChannel sharedTransport onSaved={() => { setTransportRevision(value => value + 1); onSaved(); }} />
    <SmtpServiceForm service="contact" refresh={transportRevision} onSaved={onSaved} />
    <SmtpServiceForm service="automatic" refresh={transportRevision} onSaved={onSaved} />
    <section aria-label="Monitorización de correo" className="mt-6 space-y-3 min-w-0 border-t border-border-subtle pt-5">
      <div className="flex flex-wrap justify-between gap-2"><h3 className="font-semibold">Monitorización de correo</h3><button type="button" className="text-sm text-primary" disabled={busy} onClick={() => void refreshMonitor()}>Actualizar correo</button></div>
      <button type="button" className="rounded border border-border-subtle px-3 py-2 text-sm disabled:opacity-50" disabled={!messages.length} onClick={clearHistory}>Limpiar historial</button>
      <p role="status" className="text-sm text-muted-foreground">{notice}</p>
      <p className="text-xs text-muted-foreground">La limpieza se conserva en este navegador para tu usuario, también al volver a iniciar sesión. No elimina mensajes ni estadísticas del servidor.</p>
      <p className="text-sm">Pendientes: {(monitor?.counts.PENDING || 0) + (monitor?.counts.RETRY_SCHEDULED || 0)} · Aceptados: {monitor?.counts.ACCEPTED || 0} · Entregados según proveedor: {monitor?.counts.DELIVERED || 0} · Fallidos: {monitor?.counts.FAILED || 0} · Inciertos: {monitor?.counts.UNKNOWN || 0}</p>
      <p className="text-xs text-muted-foreground">{monitor?.circuits.filter(circuit => circuit.provider.startsWith('smtp')).map(circuit => `${circuit.provider === 'smtp_automatic' ? 'SMTP automático' : circuit.provider === 'smtp_contact' ? 'SMTP bidireccional' : 'SMTP compartido'}: ${circuit.state} (${circuit.failures} fallos)`).join(' · ')}</p>
      <p className="text-xs text-muted-foreground">La aceptación SMTP no acredita recepción ni lectura en el buzón. Los registros de otros canales se conservan únicamente como historial.</p>
      {monitor?.alerts.length ? <ul className="space-y-1 text-sm text-warning" aria-label="Alertas de correo">{monitor.alerts.map(alert => <li key={alert}>{alert}</li>)}</ul> : null}
      <div className="max-w-full overflow-x-auto"><table className="w-full min-w-[960px] text-xs"><caption className="text-left text-sm pb-2">Últimos envíos</caption><thead><tr>{['ID', 'Tipo', 'Canal', 'Estado', 'Intentos', 'Fecha', 'Resultado'].map(label => <th key={label} className="text-left p-2">{label}</th>)}</tr></thead><tbody>{messages.map(message => <tr key={message.id} className="border-t border-border-subtle"><td className="p-2 font-mono whitespace-nowrap">{message.id}</td><td className="p-2">{message.message_type}</td><td className="p-2">{message.provider}</td><td className="p-2">{message.state}</td><td className="p-2">{message.attempts}</td><td className="p-2 whitespace-nowrap">{new Date(message.created_at).toLocaleString('es-ES')}</td><td className="p-2">{message.last_error || (message.provider_latency_ms == null ? 'Pendiente' : `${message.provider_latency_ms} ms`)}</td></tr>)}</tbody></table></div>
    </section>
  </div>;
}
