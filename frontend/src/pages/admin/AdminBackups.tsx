import { useCallback, useEffect, useRef, useState } from 'react';
import { DatabaseBackup, RefreshCw, X } from 'lucide-react';
import PanelModal from '@/components/ui/PanelModal';
import BackupDestinationForm, { BACKUP_SLOTS } from '@/components/admin/BackupDestinationForm';
import apiClient from '@/api/apiClient';
import endpoints from '@/api/endpoints';
import { extractErrorMessage } from '@/lib/errors';
import { backupReplicas } from '@/lib/backups';
import BackupHistory from '@/components/admin/BackupHistory';
import BackupInventory from '@/components/admin/BackupInventory';

const DAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const KINDS = { automatic: 'Automática recomendada', full: 'Completa', incremental: 'Incremental' };
const STATES = { ok: 'Correcto', attention: 'Atención', error: 'Error', not_configured: 'No configurado' };
const PAGE_SIZE = 10;
const bytes = (value) => { const n = Number(value) || 0; return n >= 1073741824 ? `${(n / 1073741824).toFixed(2)} GB` : n >= 1048576 ? `${(n / 1048576).toFixed(2)} MB` : `${(n / 1024).toFixed(1)} KB`; };


export default function AdminBackups() {
  const [status, setStatus] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [inventory, setInventory] = useState<any[]>([]);
  const [inventoryPage, setInventoryPage] = useState(0);
  const [origins, setOrigins] = useState<Record<string, string>>({});
  const [clearIds, setClearIds] = useState<string[] | null>(null);
  const [servers, setServers] = useState<any[]>([]);
  const [config, setConfig] = useState<any>(null);
  const [schedule, setSchedule] = useState({ frequency: 'manual', day: '1', hour: '03:00', job_type: 'automatic', retention_days: 30 });
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState(false);
  const [createKind, setCreateKind] = useState('automatic');
  const [pendingJob, setPendingJob] = useState<string | null>(null);
  const [restore, setRestore] = useState<any>(null);
  const [confirmationText, setConfirmationText] = useState('');
  const [restoreAck, setRestoreAck] = useState(false);
  const [retentionChoice, setRetentionChoice] = useState('30');
  const initialized = useRef(false);
  const inFlight = useRef(false);
  const loadVersion = useRef(0);
  const date = (value) => value ? new Date(value).toLocaleString('es-ES', { timeZone: status?.timezone || 'Europe/Madrid' }) : 'Sin registro';
  const load = useCallback(async () => {
    const version = ++loadVersion.current;
    try {
      const [s, h, c, targets, copies] = await Promise.all([apiClient.get(endpoints.backups.status), apiClient.get(endpoints.backups.history, { params: { limit: PAGE_SIZE, offset: page * PAGE_SIZE } }), apiClient.get(endpoints.backups.config), apiClient.get(endpoints.backups.servers), apiClient.get(endpoints.backups.inventory, { params: { limit: PAGE_SIZE, offset: inventoryPage * PAGE_SIZE } })]);
      if (version !== loadVersion.current) return;
      setStatus(s.data); setHistory(h.data); setInventory(copies.data); setConfig(c.data?.value); setServers(targets.data);
      if (!initialized.current) {
        const cfg = c.data?.value || {};
        const retention = cfg.retention_days || cfg.retention_incremental || 30;
        setSchedule({ frequency: cfg.frequency || 'manual', day: cfg.day === '*' ? '1' : cfg.day || '1', hour: cfg.hour || '03:00', job_type: cfg.job_type || 'automatic', retention_days: retention });
        setRetentionChoice([7, 15, 30, 60, 90].includes(retention) ? String(retention) : 'custom'); initialized.current = true;
      }
      setError('');
    } catch (err) { if (version === loadVersion.current) setError(extractErrorMessage(err, 'No se pudo actualizar el estado de las copias.')); }
    finally { if (version === loadVersion.current) setLoading(false); }
  }, [page, inventoryPage]);
  useEffect(() => {
    void load(); const timer = setInterval(() => { void load(); }, 5000);
    return () => { clearInterval(timer); loadVersion.current++; };
  }, [load]);
  useEffect(() => {
    const job = inventory.find(item => item.id === pendingJob);
    if (!job || job.status === 'creating') return;
    setPendingJob(null);
    if (job.status === 'completed' && job.verified) {
      setNotice('Copia creada e integridad verificada. Comprueba su recuperación antes de considerarla utilizable.');
    } else if (job.status === 'partial' && job.verified) {
      setNotice('Solo algunos destinos recibieron y verificaron la copia. Consulta sus resultados.');
    } else {
      setNotice(''); setError(job.error || 'No se pudo crear la copia.');
    }
  }, [inventory, pendingJob]);
  useEffect(() => {
    if (!restore?.restoreId || restore.step !== 'running') return;
    let stopped = false; let polling = false;
    const poll = async () => {
      if (polling) return; polling = true;
      try {
        const { data } = await apiClient.get(endpoints.backups.restoreStatus, { params: { restore_id: restore.restoreId } });
        if (!stopped && ['done', 'failed'].includes(data.state)) { setRestore(current => current?.restoreId === restore.restoreId ? { ...current, step: data.state, result: data } : current); void load(); }
      } catch { /* Keep the operation visible across transient network failures. */ }
      finally { polling = false; }
    };
    void poll(); const timer = setInterval(() => { void poll(); }, 2000);
    return () => { stopped = true; clearInterval(timer); };
  }, [restore?.restoreId, restore?.step, load]);
  const operationBusy = busy || Boolean(status?.operation || status?.restore_in_progress);
  const active = servers.filter(server => server.is_active);
  const run = async (action) => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(''); setNotice('');
    try { await action(); await load(); }
    catch (err) { setError(extractErrorMessage(err, 'No se pudo completar la operación.')); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const saveSchedule = async (event) => {
    event.preventDefault(); setSaving(true); setError(''); setNotice('');
    try {
      const { data } = await apiClient.put(endpoints.backups.config, { key: 'backups', value: { ...schedule, day: schedule.frequency === 'weekly' ? schedule.day : '*', encrypt: true } });
      setConfig(data.value); setNotice('Programación guardada.'); await load();
    } catch (err) { setError(extractErrorMessage(err, 'No se pudo guardar la programación.')); }
    finally { setSaving(false); }
  };
  const create = () => run(async () => {
    setConfirmation(false);
    const { data } = await apiClient.post(endpoints.backups.create, { type: createKind, background: true, encrypt: true });
    setPendingJob(data.job_id);
    setNotice('Copia en curso. Puedes seguir consultando esta pantalla.'); setPage(0); setInventoryPage(0);
  });
  const verify = (job) => run(async () => {
    const { data } = await apiClient.post(endpoints.backups.verify, { job_id: job.id, origin: origins[job.id] || backupReplicas(job)[0]?.id || 'auto' }, { timeout: 90000 });
    if (!data.valid) throw new Error('La copia no supera la comprobación de integridad.');
    setNotice('Integridad, descifrado y formato comprobados.');
  });
  const drill = (job) => run(async () => {
    await apiClient.post(endpoints.backups.restoreTest, { job_id: job.id, origin: origins[job.id] || backupReplicas(job)[0]?.id || 'auto' }, { timeout: 660000 });
    setNotice('Recuperación comprobada en una base de prueba.');
  });
  const openRestore = (job) => {
    setConfirmationText(''); setRestoreAck(false);
    const origin = origins[job.id] || backupReplicas(job)[0]?.id || 'local';
    setRestore({ job, origin, step: 'confirm', error: '', filename: job.manifest?.files?.database?.name || '', loading: false });
  };
  const changeOrigin = async (origin) => {
    const selectedId = restore.job.id;
    setRestore(current => ({ ...current, origin, filename: '', loading: origin !== 'local', error: '' }));
    if (origin === 'local') return;
    try {
      const { data } = await apiClient.get(endpoints.backups.origins, { params: { origin, job_id: selectedId }, timeout: 60000 });
      const selected = data.available?.find(item => item.id === selectedId);
      setRestore(current => current?.job.id === selectedId && current.origin === origin ? { ...current, loading: false, filename: selected?.filename || '', error: selected ? '' : 'Esta copia no está disponible en el destino seleccionado.' } : current);
    } catch { setRestore(current => ({ ...current, loading: false, error: 'No se pudo consultar el destino.' })); }
  };
  const restoreNow = async () => {
    if (operationBusy || restore?.step !== 'confirm' || confirmationText !== 'RESTAURAR' || !restoreAck) return;
    const selected = restore; setRestore(current => ({ ...current, step: 'running', error: '' }));
    try {
      const { data } = await apiClient.post(endpoints.backups.restore, { origin: selected.origin, confirmed: true, confirmation_text: confirmationText, job_id: selected.job.id, ...(selected.origin === 'local' ? {} : { filename: selected.filename }) }, { timeout: 60000 });
      setRestore(current => ({ ...current, restoreId: data.restore_id })); void load();
    } catch (err) { setRestore(current => ({ ...current, step: 'confirm', error: extractErrorMessage(err, 'No se pudo iniciar la restauración.') })); }
  };
  const control = 'w-full min-w-0 rounded-md border border-border-subtle bg-card px-3 py-2 text-sm text-foreground focus-visible:outline-primary';
  const button = 'rounded-md border border-border-subtle px-3 py-2 text-sm focus-visible:outline-primary disabled:opacity-50';
  const freq = schedule.frequency === 'manual' ? 'Manual' : schedule.frequency === 'weekly' ? `Cada ${DAYS[Number(schedule.day)]}` : schedule.frequency === 'daily' ? 'Diaria' : 'Programación anterior';
  return <div className="space-y-5 min-w-0">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-heading text-xl flex items-center gap-2"><DatabaseBackup className="w-5 h-5 text-primary" />Backups</h2><p className="text-sm text-muted-foreground mt-1">Configura, crea y recupera tus copias de seguridad.</p></div><button className={button} onClick={() => void load()}><RefreshCw className="inline w-4 h-4 mr-1" />Actualizar</button></div>
    <nav aria-label="Secciones de copias de seguridad" className="flex flex-wrap gap-2">{[['backup-state', 'Estado de las copias'], ['backup-targets', 'Destinos de backup'], ['backup-schedule', 'Programación'], ['backup-history', 'Historial de copias'], ['backup-inventory', 'Copias almacenadas']].map(([id, label]) => <a key={id} className={button} href={`#${id}`}>{label}</a>)}</nav>
    {loading && <p role="status">Cargando copias…</p>}{error && <p role="alert" className="rounded-md bg-danger-soft text-danger p-3">{error}</p>}{notice && <p role="status" className="rounded-md bg-success-soft text-success p-3">{notice}</p>}
    <section id="backup-state" aria-label="Estado de las copias" className="space-y-4 scroll-mt-4">
      <h3 className="font-heading font-semibold">Estado de las copias</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">{[['Última copia correcta', date(status?.last_successful_backup)], ['Próxima copia programada', status?.next_backup ? date(status.next_backup) : 'Sin programación activa'], ['Estado general', STATES[status?.system_status] || 'No configurado'], ['Espacio utilizado', bytes(status?.storage_used_bytes)], ['Destinos activos', String(active.length)]].map(([label, value]) => <div key={label} className="glass-card p-4 min-w-0"><p className="text-xs text-muted-foreground">{label}</p><p className={`mt-2 font-semibold break-words ${label === 'Estado general' && status?.system_status === 'error' ? 'text-danger' : label === 'Estado general' && status?.system_status === 'attention' ? 'text-warning' : 'text-foreground'}`}>{value}</p></div>)}</div>
      <button className={`${button} bg-primary/10 text-primary`} disabled={loading || operationBusy || !active.length} onClick={() => { setCreateKind(config?.job_type || 'automatic'); setConfirmation(true); }}>Crear copia ahora</button>
      {!active.length && !loading && <p className="text-sm text-muted-foreground">Configura, prueba y activa un destino para crear copias.</p>}
      {status?.operation && <div role="status" className="rounded-md bg-primary/10 p-3 text-sm space-y-1"><p>En curso</p><p>Inicio: {date(status.operation.started_at)}</p><p>Tipo: {KINDS[status.operation.job_type]}</p><p>Destinos: {active.map(server => server.name).join(', ')}</p></div>}
      {status?.restore_in_progress && <p role="status" className="text-sm text-warning">Restauración en curso.</p>}
    </section>
    <section id="backup-targets" aria-label="Destinos de backup" className="space-y-3 scroll-mt-4"><h3 className="font-heading font-semibold">Destinos de backup</h3><div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">{BACKUP_SLOTS.map(slot => <BackupDestinationForm key={slot.role} {...slot} server={servers.find(server => server.role === slot.role)} onSaved={load} operationBusy={operationBusy} />)}</div></section>
    <section id="backup-schedule" aria-label="Programación" className="glass-card p-4 space-y-4 scroll-mt-4">
      <h3 className="font-heading font-semibold">Programación</h3>
      {config?.retention_policy === 'legacy' && <p className="text-sm text-muted-foreground">La conservación anterior se mantiene hasta que guardes una nueva programación.</p>}
      {!['daily', 'weekly', 'manual'].includes(schedule.frequency) && <p className="text-sm text-muted-foreground">La programación anterior sigue vigente. Elige una frecuencia para sustituirla.</p>}
      {status && !status.scheduler_enabled && <p className="text-sm text-warning">Las copias automáticas están deshabilitadas por la configuración del sistema.</p>}
      <form aria-label="Programación de copias" onSubmit={saveSchedule} className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-4">
          <label className="space-y-1"><span className="text-sm">Frecuencia</span><select className={control} value={schedule.frequency} onChange={event => setSchedule({ ...schedule, frequency: event.target.value })}>{!['daily', 'weekly', 'manual'].includes(schedule.frequency) && <option value={schedule.frequency} disabled>Programación anterior</option>}<option value="daily">Diaria</option><option value="weekly">Semanal</option><option value="manual">Manual</option></select></label>
          {schedule.frequency === 'weekly' && <label className="space-y-1"><span className="text-sm">Día de la semana</span><select className={control} value={schedule.day} onChange={event => setSchedule({ ...schedule, day: event.target.value })}>{DAYS.map((day, index) => <option key={day} value={index}>{day}</option>)}</select></label>}
          {schedule.frequency !== 'manual' && <label className="space-y-1"><span className="text-sm">Hora</span><input required className={control} type="time" value={schedule.hour} onChange={event => setSchedule({ ...schedule, hour: event.target.value })} /><span className="block text-xs text-muted-foreground">{status?.timezone || 'Europe/Madrid'}</span></label>}
          <label className="space-y-1"><span className="text-sm">Tipo de copia</span><select className={control} value={schedule.job_type} onChange={event => setSchedule({ ...schedule, job_type: event.target.value })}>{Object.entries(KINDS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="space-y-1"><span className="text-sm">Conservar copias durante</span><select className={control} value={retentionChoice} onChange={event => { setRetentionChoice(event.target.value); if (event.target.value !== 'custom') setSchedule({ ...schedule, retention_days: Number(event.target.value) }); }}>{[7, 15, 30, 60, 90].map(day => <option key={day} value={day}>{day} días</option>)}<option value="custom">Personalizado</option></select></label>
          {retentionChoice === 'custom' && <label className="space-y-1"><span className="text-sm">Días de conservación</span><input required className={control} type="number" min={1} max={3650} value={schedule.retention_days} onChange={event => setSchedule({ ...schedule, retention_days: Number(event.target.value) })} /></label>}
        </div>
        <p className="text-sm text-muted-foreground" aria-live="polite">{freq}{schedule.frequency !== 'manual' ? ` a las ${schedule.hour}` : ''} · {KINDS[schedule.job_type]} · Conservación: {schedule.retention_days} días · Destinos activos: {active.map(server => server.name).join(', ') || 'ninguno'}.</p>
        <button className={`${button} text-primary bg-primary/10`} disabled={saving || loading || !['daily', 'weekly', 'manual'].includes(schedule.frequency)} type="submit">{saving ? 'Guardando…' : 'Guardar programación'}</button>
      </form>
    </section>
    <BackupHistory history={history} total={status?.history_total} page={page} setPage={setPage} date={date} button={button} loading={loading} busy={busy} clear={setClearIds} servers={servers} />
    <BackupInventory inventory={inventory} total={status?.inventory_total} page={inventoryPage} setPage={setInventoryPage} origins={origins} setOrigins={setOrigins} date={date} button={button} control={control} loading={loading} busy={operationBusy} restoreEnabled={status?.restore_enabled} verify={verify} drill={drill} restore={openRestore} />
    {clearIds && <PanelModal label="Limpiar historial de copias" onClose={() => setClearIds(null)}><h3 className="font-heading text-lg">Limpiar historial</h3><p className="my-4 text-sm">Se eliminarán {clearIds.length} operaciones finalizadas de esta página. Las copias, dependencias, configuraciones y auditoría administrativa se conservarán.</p><div className="flex flex-wrap justify-end gap-2"><button className={button} onClick={() => setClearIds(null)}>Cancelar</button><button className={button} disabled={busy} onClick={() => void run(async () => { const ids = clearIds; setClearIds(null); await apiClient.post(endpoints.backups.clearHistory, { confirmed: true, ids }); setPage(0); setNotice('Historial visible limpiado. Las copias se conservan.'); })}>Confirmar limpieza</button></div></PanelModal>}
    {confirmation && <PanelModal label="Crear copia ahora" onClose={() => setConfirmation(false)}><h3 className="font-heading text-lg">Crear copia ahora</h3><p className="my-4 text-sm">Se creará una copia cifrada de los datos y archivos en {active.map(server => server.name).join(', ')}.</p><label className="block space-y-1 mb-4"><span className="text-sm">Tipo de esta copia</span><select className={control} value={createKind} onChange={event => setCreateKind(event.target.value)}>{Object.entries(KINDS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>{createKind === 'incremental' && <p className="mb-4 text-sm text-muted-foreground">Guarda los cambios respecto a la copia anterior. Si falta una base válida, se creará primero una completa.</p>}<div className="flex flex-wrap justify-end gap-2"><button className={button} onClick={() => setConfirmation(false)}>Cancelar</button><button className={`${button} text-primary`} disabled={operationBusy} onClick={() => void create()}>Confirmar creación</button></div></PanelModal>}
    {restore && <PanelModal label="Restaurar copia de seguridad" onClose={() => restore.step !== 'running' && setRestore(null)}><div className="flex items-start justify-between gap-3"><h3 className="font-heading text-lg">Restaurar copia de seguridad</h3><button aria-label="Cerrar" className={button} disabled={restore.step === 'running'} onClick={() => setRestore(null)}><X className="w-4 h-4" /></button></div>
      {restore.step === 'confirm' && <div className="space-y-4 mt-4"><p className="text-sm">Copia: {date(restore.job.created_date)} · {KINDS[restore.job.job_type]} · {restore.job.id}</p><label className="block space-y-1"><span className="text-sm">Recuperar desde</span><select className={control} value={restore.origin} onChange={event => void changeOrigin(event.target.value)}>{backupReplicas(restore.job).map(replica => <option key={replica.id} value={replica.id}>{replica.name}</option>)}</select></label><p className="text-sm text-warning">Se sustituirán los datos actuales. El sistema comprobará la copia, creará una copia de seguridad previa y verificará la recuperación.</p><label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={restoreAck} onChange={event => setRestoreAck(event.target.checked)} />Entiendo que se sustituirán los datos actuales.</label><label className="block space-y-1"><span className="text-sm">Escribe RESTAURAR para confirmar</span><input className={control} autoComplete="off" value={confirmationText} onChange={event => setConfirmationText(event.target.value)} /></label>{restore.error && <p role="alert" className="text-sm text-danger">{restore.error}</p>}<button className={`${button} text-danger`} disabled={operationBusy || restore.loading || Boolean(restore.error) || !restoreAck || confirmationText !== 'RESTAURAR' || (restore.origin !== 'local' && !restore.filename)} onClick={() => void restoreNow()}>Restaurar definitivamente</button></div>}
      {restore.step === 'running' && <p role="status" className="my-4 text-sm">Restauración en curso. Se comprobará la recuperación antes de finalizar.</p>}
      {restore.step === 'done' && <p role="status" className="my-4 text-sm text-success">Restauración completada y verificada.</p>}
      {restore.step === 'failed' && <div role="alert" className="my-4 text-sm text-danger"><p>{restore.result?.error || 'No se pudo completar la restauración.'}</p><p>{restore.result?.rolled_back ? 'Se recuperaron los datos con la copia de seguridad previa.' : 'Consulta el estado del sistema antes de reintentar.'}</p></div>}
    </PanelModal>}
  </div>;
}
