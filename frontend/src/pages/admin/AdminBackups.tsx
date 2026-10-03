import PanelModal from '@/components/ui/PanelModal';
import BackupDestinationForm, { BACKUP_SLOTS } from '@/components/admin/BackupDestinationForm';
import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  DatabaseBackup, CheckCircle2, AlertTriangle, Clock3, HardDrive, RefreshCw, PlayCircle,
  X, Loader2, ShieldCheck, XCircle, RotateCcw, Trash2,
} from 'lucide-react';
import apiClient from '@/api/apiClient';
import endpoints from '@/api/endpoints';

const DIAS = [
  { value: '*', label: 'Todos los días' },
  { value: '1', label: 'Lunes' },
  { value: '2', label: 'Martes' },
  { value: '3', label: 'Miércoles' },
  { value: '4', label: 'Jueves' },
  { value: '5', label: 'Viernes' },
  { value: '6', label: 'Sábado' },
  { value: '0', label: 'Domingo' },
];

const FRECUENCIAS = [
  { value: 'manual', label: 'Solo manual' },
  { value: 'daily', label: 'Diario' },
  { value: 'every_n_days', label: 'Cada N días' },
  { value: 'weekly', label: 'Semanal' },
  { value: 'monthly', label: 'Mensual' },
];

const apiErr = (err, fallback) => {
  const data = err?.response?.data;
  if (!data) return fallback;
  if (typeof data.detail === 'string' && data.detail) return data.detail;
  if (typeof data.error === 'string' && data.error) return data.error;
  const first = Object.values(data).find((v) => Array.isArray(v) || typeof v === 'string');
  if (Array.isArray(first) && first.length) return String(first[0]);
  if (typeof first === 'string' && first) return first;
  return fallback;
};

const formatBytes = (bytes) => {
  const n = Number(bytes) || 0;
  if (n >= 1024 * 1024 * 1024) return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
};

const parseBackupMeta = (item) => {
  const m = /^uasspain_(full|incremental)_(\d{8})_(\d{6})/.exec(item?.filename || '');
  if (m) {
    const iso = `${m[2].slice(0, 4)}-${m[2].slice(4, 6)}-${m[2].slice(6, 8)}T${m[3].slice(0, 2)}:${m[3].slice(2, 4)}:${m[3].slice(4, 6)}`;
    const d = new Date(iso);
    return {
      tipo: m[1] === 'full' ? 'Completo' : 'Incremental',
      fecha: Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('es-ES'),
    };
  }
  const d = item?.created_date ? new Date(item.created_date) : null;
  const tipo = item?.job_type === 'full' ? 'Completo'
    : item?.job_type === 'incremental' ? 'Incremental'
      : (item?.job_type || '—');
  return { tipo, fecha: d && !Number.isNaN(d.getTime()) ? d.toLocaleString('es-ES') : '—' };
};

const RESTORE_STEPS_HINT = [
  'Se comprueba que el archivo existe en el origen.',
  'Se valida checksum (SHA-256) e integridad estructural.',
  'Se genera automáticamente un backup de seguridad previo.',
  'Se restaura y se verifica la BD (migraciones, tablas, usuarios).',
  'Si algo falla, se hace rollback automático al backup de seguridad.',
];

export default function AdminBackups() {
  const [status, setStatus] = useState(null);
  const [history, setHistory] = useState([]);
  const [config, setConfig] = useState(null);
  const [servers, setServers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [connectionMsg, setConnectionMsg] = useState('');

  const [formFreq, setFormFreq] = useState('daily');
  const [formDay, setFormDay] = useState('*');
  const [formHour, setFormHour] = useState('03:00');
  const [formIntervalDays, setFormIntervalDays] = useState(3);
  const [formJobType, setFormJobType] = useState('incremental');
  const [formRetentionFull, setFormRetentionFull] = useState(4);
  const [formRetentionInc, setFormRetentionInc] = useState(30);


  // Modal de restauración por origen (§9): list → confirm → running → done | failed
  const [restore, setRestore] = useState(null);

  const ext1 = servers.find((server) => server.role === 'external_1') || null;
  const ext2 = servers.find((server) => server.role === 'external_2') || null;

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [statusRes, historyRes, configRes, serversRes] = await Promise.all([
        apiClient.get(endpoints.backups.status),
        apiClient.get(endpoints.backups.history),
        apiClient.get(endpoints.backups.config),
        apiClient.get(endpoints.backups.servers),
      ]);
      setStatus(statusRes.data || null);
      setHistory(historyRes.data || []);
      setConfig(configRes.data || null);
      const srvList = Array.isArray(serversRes.data) ? serversRes.data : [];
      setServers(srvList);

      const cfg = configRes.data?.value || {};
      setFormFreq(cfg.frequency || 'daily');
      setFormDay(cfg.day || '*');
      setFormHour(cfg.hour || '03:00');
      setFormIntervalDays(cfg.interval_days || 3);
      setFormJobType(cfg.job_type || 'incremental');
      setFormRetentionFull(cfg.retention_full || 4);
      setFormRetentionInc(cfg.retention_incremental || 30);
    } catch (err) {
      setError(apiErr(err, 'No se pudo cargar el estado de backups.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const saveConfig = async () => {
    setSaving(true);
    setError('');
    try {
      const payload = {
        key: 'backups',
        value: {
          ...config?.value,
          frequency: formFreq,
          day: ['weekly', 'monthly'].includes(formFreq) ? (formDay === '*' ? '1' : formDay) : '*',
          hour: formHour,
          interval_days: formIntervalDays,
          job_type: formJobType,
          retention_full: formRetentionFull,
          retention_incremental: formRetentionInc,
        },
      };
      const res = await apiClient.put(endpoints.backups.config, payload);
      setConfig(res.data);
    } catch (err) {
      setError(err?.response?.data?.detail || 'No se pudo guardar la configuración.');
    } finally {
      setSaving(false);
    }
  };

  const createBackup = async (type = 'incremental') => {
    try {
      const res = await apiClient.post(endpoints.backups.create, { type });
      setHistory((prev) => [res.data.job, ...prev]);
      await load();
    } catch (err) {
      setError(err?.response?.data?.detail || 'No se pudo iniciar el backup.');
    }
  };

  const verifyBackup = async (selectedJob = null) => {
    try {
      const job = selectedJob || history[0];
      if (!job) return;
      const res = await apiClient.post(endpoints.backups.verify, { job_id: job.id });
      setHistory((prev) => prev.map((item) => (item.id === job.id ? { ...item, verified: res.data.valid } : item)));
    } catch (err) {
      setError(err?.response?.data?.detail || 'No se pudo verificar el backup.');
    }
  };

  const deleteBackup = async (job) => {
    if (!window.confirm(`¿Eliminar el backup ${String(job.id).slice(0, 8)}? La operación se rechazará si tiene dependencias.`)) return;
    setError('');
    try {
      await apiClient.delete(endpoints.backups.detail(job.id), { data: { confirmed: true } });
      await load();
    } catch (err) {
      setError(apiErr(err, 'No se pudo eliminar el backup.'));
    }
  };

  const openRestore = async (origin, originLabel) => {
    setRestore({ origin, originLabel, step: 'list', available: [], selected: null, error: '', result: null });
    try {
      const res = await apiClient.get(endpoints.backups.origins, {
        params: { origin },
        timeout: 60000,
      });
      const data = res.data || {};
      if (!data.ok) {
        setRestore((s) => (s ? { ...s, step: 'error', error: data.error || 'No se pudo listar el origen.' } : s));
        return;
      }
      setRestore((s) => (s && s.origin === origin ? { ...s, available: data.available || [] } : s));
    } catch (err) {
      setRestore((s) => (s ? { ...s, step: 'error', error: apiErr(err, 'No se pudo listar los backups de ese origen.') } : s));
    }
  };

  const pollRestore = async (restoreId) => {
    for (let i = 0; i < 150; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => { setTimeout(r, 2000); });
      let data = null;
      try {
        // eslint-disable-next-line no-await-in-loop
        const res = await apiClient.get(endpoints.backups.restoreStatus, {
          params: { restore_id: restoreId },
          timeout: 30000,
        });
        data = res.data;
      } catch (err) {
        if (err?.response?.status === 404) {
          setRestore((cur) => (cur && cur.restoreId === restoreId
            ? { ...cur, step: 'failed', error: 'Restauración no encontrada (¿reinicio del servicio?).' }
            : cur));
          return;
        }
        continue; // error transitorio de red: se reintenta
      }
      if (data?.state === 'done') {
        setRestore((cur) => (cur && cur.restoreId === restoreId
          ? {
            ...cur,
            step: 'done',
            result: {
              ...data,
              detail: data.detail || 'Restauración completada y verificada correctamente.',
            },
          }
          : cur));
        await load();
        return;
      }
      if (data?.state === 'failed') {
        setRestore((cur) => (cur && cur.restoreId === restoreId
          ? { ...cur, step: 'failed', error: data.error || 'Restauración fallida.', result: data }
          : cur));
        return;
      }
    }
    setRestore((cur) => (cur && cur.restoreId === restoreId
      ? { ...cur, step: 'failed', error: 'Tiempo de espera agotado consultando la restauración.' }
      : cur));
  };

  const confirmRestore = async () => {
    const s = restore;
    if (!s || !s.selected) return;
    const payload: { origin: string; confirmed: boolean; job_id?: string; filename?: string } = { origin: s.origin, confirmed: true };
    if (s.origin === 'local') payload.job_id = s.selected.id;
    else payload.filename = s.selected.filename;
    setRestore({ ...s, step: 'running', error: '', restoreId: null });
    try {
      const res = await apiClient.post(endpoints.backups.restore, payload, { timeout: 60000 });
      const restoreId = res.data?.restore_id;
      if (!restoreId) {
        setRestore((cur) => (cur ? { ...cur, step: 'failed', error: 'No se recibió el identificador de la restauración.' } : cur));
        return;
      }
      setRestore((cur) => (cur ? { ...cur, restoreId } : cur));
      await pollRestore(restoreId);
    } catch (err) {
      const data = err?.response?.data;
      setRestore((cur) => (cur
        ? {
          ...cur,
          step: 'failed',
          error: (typeof data?.error === 'string' && data.error) || data?.detail || 'No se pudo iniciar la restauración.',
          result: data || null,
        }
        : cur));
    }
  };

  const restoreTest = async () => {
    const job = history[0];
    if (!job) return;
    try {
      const res = await apiClient.post(endpoints.backups.restoreTest, { job_id: job.id });
      const ok = res.data?.success || res.data?.status === 'success';
      setConnectionMsg(ok
        ? `Restore test OK: ${res.data?.tables ?? ''} tablas restauradas en BD temporal`
        : `Restore test falló: ${res.data?.error || 'error desconocido'}`);
      setError('');
    } catch (err) {
      setConnectionMsg('');
      setError(err?.response?.data?.detail || 'No se pudo ejecutar el restore de prueba.');
    }
  };

  const applyRetention = async () => {
    try {
      const res = await apiClient.post(endpoints.backups.retention, {});
      setConnectionMsg(res.data?.detail || 'Retención aplicada.');
      setError('');
      await load();
    } catch (err) {
      setConnectionMsg('');
      setError(err?.response?.data?.detail || 'No se pudo aplicar la retención.');
    }
  };

  const dayLabel = formDay === '*' ? 'Todos los días' : DIAS.find((d) => d.value === formDay)?.label || formDay;
  const proximoBackup = formFreq === 'weekly'
    ? `${dayLabel} a las ${formHour}`
    : `${formHour} (diario)`;

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-heading text-xl font-bold text-foreground flex items-center gap-2">
            <DatabaseBackup className="w-5 h-5 text-primary" /> Backups
          </h2>
          <p className="text-xs text-muted-foreground mt-1">Backups locales + 2 destinos externos SFTP con configuración independiente.</p>
        </div>
        <button onClick={() => load()} className="inline-flex items-center gap-2 rounded border border-primary/20 bg-primary/10 px-3 py-2 text-sm text-primary">
          <RefreshCw className="w-4 h-4" /> Actualizar
        </button>
      </div>

      {error ? <div className="rounded border border-danger-border bg-danger-soft p-3 text-sm text-danger/80">{error}</div> : null}

      {loading ? <div className="text-sm text-muted-foreground">Cargando estado de backups...</div> : null}

      {status ? (
        <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-4">
          {[
            { label: 'Estado del sistema', value: status.system_status === 'ok' ? 'Correcto' : 'Error', icon: CheckCircle2, tone: 'green' },
            { label: 'Último backup', value: status.last_backup_type || '—', icon: DatabaseBackup, tone: 'blue' },
            { label: 'Próximo backup', value: proximoBackup, icon: Clock3, tone: 'yellow' },
            { label: 'Servidor remoto', value: status.remote_available ? 'Conectado' : 'No disponible', icon: HardDrive, tone: status.remote_available ? 'green' : 'yellow' },
          ].map((item, index) => (
            <div key={index} className="glass-card p-4">
              <div className="flex items-center gap-2 mb-2">
                <item.icon className={`w-4 h-4 ${item.tone === 'green' ? 'text-success' : item.tone === 'yellow' ? 'text-warning' : 'text-primary'}`} />
                <span className="text-[10px] uppercase tracking-widest text-muted-foreground">{item.label}</span>
              </div>
              <p className="text-base font-semibold text-foreground">{item.value}</p>
            </div>
          ))}
        </div>
      ) : null}

      <div className="glass-card p-5">
        <div className="flex flex-wrap gap-3">
          <button onClick={() => createBackup('full')} className="inline-flex items-center gap-2 rounded border border-primary/20 bg-primary/10 px-3 py-2 text-sm text-primary">
            <PlayCircle className="w-4 h-4" /> Backup completo
          </button>
          <button onClick={() => createBackup('incremental')} className="inline-flex items-center gap-2 rounded border border-success-border bg-success-soft px-3 py-2 text-sm text-success">
            <PlayCircle className="w-4 h-4" /> Backup incremental
          </button>
          <button onClick={verifyBackup} className="inline-flex items-center gap-2 rounded border border-amber-500/20 bg-warning-soft px-3 py-2 text-sm text-warning">
            <CheckCircle2 className="w-4 h-4" /> Verificar integridad
          </button>
          <button onClick={() => openRestore('local', 'Local')} className="inline-flex items-center gap-2 rounded border border-danger-border bg-danger-soft px-3 py-2 text-sm text-danger">
            <AlertTriangle className="w-4 h-4" /> Restaurar backup local
          </button>
          <button
            onClick={() => ext1 && openRestore(ext1.id, 'Servidor externo 1')}
            disabled={!ext1}
            className="inline-flex items-center gap-2 rounded border border-danger-border bg-danger-soft px-3 py-2 text-sm text-danger disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <AlertTriangle className="w-4 h-4" /> Restaurar backup servidor externo 1
          </button>
          <button
            onClick={() => ext2 && openRestore(ext2.id, 'Servidor externo 2')}
            disabled={!ext2}
            className="inline-flex items-center gap-2 rounded border border-danger-border bg-danger-soft px-3 py-2 text-sm text-danger disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <AlertTriangle className="w-4 h-4" /> Restaurar backup servidor externo 2
          </button>
          <button onClick={restoreTest} className="inline-flex items-center gap-2 rounded border border-amber-500/20 bg-warning-soft px-3 py-2 text-sm text-warning">
            <PlayCircle className="w-4 h-4" /> Restore de prueba
          </button>
          <button onClick={applyRetention} className="inline-flex items-center gap-2 rounded border border-border-subtle bg-surface-subtle px-3 py-2 text-sm text-foreground">
            <HardDrive className="w-4 h-4" /> Aplicar retención
          </button>

        </div>
        {connectionMsg ? <div className="mt-3 rounded border border-success-border bg-success-soft p-3 text-sm text-success">{connectionMsg}</div> : null}
      </div>

      <div className="grid lg:grid-cols-3 gap-4" aria-label="Destinos de backup">
        {BACKUP_SLOTS.map((slot) => <BackupDestinationForm key={slot.role} {...slot} server={servers.find((server) => server.role === slot.role)} onSaved={load} />)}
      </div>

      <div className="glass-card p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-heading text-sm font-semibold text-foreground">Programación</h3>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Frecuencia</label>
              <select
                value={formFreq}
                onChange={(e) => { setFormFreq(e.target.value); if (e.target.value === 'daily') setFormDay('*'); }}
                className="w-full rounded border border-border-subtle bg-surface-muted px-3 py-2 text-sm text-foreground"
              >
                {FRECUENCIAS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
            </div>

            {formFreq === 'weekly' && (
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Día de la semana</label>
                <select
                  value={formDay}
                  onChange={(e) => setFormDay(e.target.value)}
                  className="w-full rounded border border-border-subtle bg-surface-muted px-3 py-2 text-sm text-foreground"
                >
                  {DIAS.filter((d) => d.value !== '*').map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
                </select>
              </div>
            )}

            {formFreq === 'monthly' && (
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Día del mes</label>
                <input type="number" min="1" max="31" value={formDay === '*' ? '1' : formDay}
                  onChange={(e) => setFormDay(e.target.value)}
                  className="w-full rounded border border-border-subtle bg-surface-muted px-3 py-2 text-sm text-foreground" />
              </div>
            )}

            {formFreq === 'every_n_days' && (
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Intervalo (días)</label>
                <input type="number" min="1" max="3650" value={formIntervalDays}
                  onChange={(e) => setFormIntervalDays(parseInt(e.target.value, 10) || 1)}
                  className="w-full rounded border border-border-subtle bg-surface-muted px-3 py-2 text-sm text-foreground" />
              </div>
            )}

            {formFreq !== 'manual' && <div>
              <label className="block text-xs text-muted-foreground mb-1">Hora</label>
              <input
                type="time"
                value={formHour}
                onChange={(e) => setFormHour(e.target.value)}
                className="w-full rounded border border-border-subtle bg-surface-muted px-3 py-2 text-sm text-foreground"
              />
            </div>}

            <div>
              <label className="block text-xs text-muted-foreground mb-1">Tipo programado</label>
              <select value={formJobType} onChange={(e) => setFormJobType(e.target.value)}
                className="w-full rounded border border-border-subtle bg-surface-muted px-3 py-2 text-sm text-foreground">
                <option value="full">Completo</option>
                <option value="incremental">Incremental encadenado</option>
              </select>
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Retención completa (días)</label>
              <input
                type="number"
                min="1"
                max="365"
                value={formRetentionFull}
                onChange={(e) => setFormRetentionFull(parseInt(e.target.value, 10) || 4)}
                className="w-full rounded border border-border-subtle bg-surface-muted px-3 py-2 text-sm text-foreground"
              />
            </div>

            <div>
              <label className="block text-xs text-muted-foreground mb-1">Retención incremental (días)</label>
              <input
                type="number"
                min="1"
                max="365"
                value={formRetentionInc}
                onChange={(e) => setFormRetentionInc(parseInt(e.target.value, 10) || 30)}
                className="w-full rounded border border-border-subtle bg-surface-muted px-3 py-2 text-sm text-foreground"
              />
            </div>

            <div className="rounded border border-border-subtle bg-surface-subtle p-3 text-xs text-muted-foreground">
              <p className="font-medium text-foreground mb-1">Vista previa</p>
              <p>Backup: {formFreq === 'manual' ? 'sin ejecución automática'
                : formFreq === 'weekly' ? `cada ${dayLabel} a las ${formHour}`
                  : formFreq === 'monthly' ? `día ${formDay === '*' ? '1' : formDay} a las ${formHour}`
                    : formFreq === 'every_n_days' ? `cada ${formIntervalDays} días a las ${formHour}`
                      : `diariamente a las ${formHour}`}</p>
              <p>Tipo: {formJobType === 'full' ? 'completo' : 'incremental encadenado'}</p>
              <p>Retención: {formRetentionFull} completos / {formRetentionInc} incrementales</p>
            </div>
          </div>
        </div>
      </div>

      <div className="glass-card p-5">
        <h3 className="font-heading text-sm font-semibold text-foreground">Historial</h3>
        <div className="mt-3 space-y-2">
          {history.length === 0 ? <div className="text-sm text-muted-foreground">No hay historial registrado todavía.</div> : history.map((job) => (
            <div key={job.id} className="rounded border border-border-subtle bg-surface-subtle p-3 text-sm text-muted-foreground">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-foreground">{job.job_type === 'full' ? 'Completo' : 'Incremental'}</span>
                <span className={`rounded px-2 py-0.5 text-[11px] uppercase ${job.status === 'completed' ? 'bg-success-soft text-success' : job.status === 'failed' ? 'bg-danger-soft text-danger' : 'bg-warning-soft text-warning'}`}>
                  {job.status}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-4 text-xs">
                <span>Tamaño: {formatBytes(job.size_bytes)}</span>
                <span>Duración: {job.duration_seconds || 0}s</span>
                <span className="break-all">Checksum: {job.checksum || '—'}</span>
                <span>Cadena: {job.chain_index || 0}</span>
                <span>Manifest: {job.manifest_checksum ? 'verificado' : 'no disponible'}</span>
                <span>Iniciado por: {job.initiated_by || '—'}</span>
                {job.restored_by ? <span className="text-success">Restaurado por: {job.restored_by}</span> : null}
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <button onClick={() => verifyBackup(job)} className="inline-flex items-center gap-1 rounded border border-success-border bg-success-soft px-2 py-1 text-[11px] text-success">
                  <CheckCircle2 className="h-3 w-3" /> Verificar
                </button>
                <button onClick={() => openRestore('local', 'Local')} className="inline-flex items-center gap-1 rounded border border-amber-500/20 bg-warning-soft px-2 py-1 text-[11px] text-warning">
                  <RotateCcw className="h-3 w-3" /> Restaurar
                </button>
                <button onClick={() => deleteBackup(job)} className="inline-flex items-center gap-1 rounded border border-danger-border bg-danger-soft px-2 py-1 text-[11px] text-danger">
                  <Trash2 className="h-3 w-3" /> Eliminar
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <AnimatePresence>
        {restore ? (
          <PanelModal label="Restaurar copia de seguridad" onClose={() => restore.step !== 'running' && setRestore(null)} className="glass-card max-w-2xl p-5">
              <div className="flex items-start justify-between gap-3 mb-4">
                <div>
                  <h3 className="font-heading text-sm font-semibold text-foreground flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-danger" /> Restaurar — {restore.originLabel}
                  </h3>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Cada botón actúa únicamente sobre su propio origen.
                  </p>
                </div>
                {restore.step !== 'running' ? (
                  <button onClick={() => setRestore(null)} aria-label="Cerrar" className="text-muted-foreground hover:text-foreground">
                    <X className="w-4 h-4" />
                  </button>
                ) : null}
              </div>

              {restore.step === 'list' ? (
                <div className="space-y-3">
                  <p className="text-xs text-muted-foreground">
                    Backups disponibles en este origen. Elige el punto de restauración (fecha/hora/tipo).
                  </p>
                  {restore.available.length === 0 ? (
                    <div className="rounded border border-border-subtle bg-surface-subtle p-3 text-sm text-muted-foreground">
                      Este origen no tiene backups disponibles.
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                      {restore.available.map((item) => {
                        const meta = parseBackupMeta(item);
                        const sel = Boolean(restore.selected)
                          && restore.selected.filename === item.filename
                          && restore.selected.id === item.id;
                        return (
                          <button
                            key={`${item.id || 'x'}-${item.filename || ''}`}
                            onClick={() => setRestore({ ...restore, selected: item })}
                            className={`w-full text-left rounded border p-3 ${sel ? 'border-primary/60 bg-primary/10' : 'border-border-subtle bg-surface-subtle'}`}
                          >
                            <div className="flex items-center justify-between gap-2 text-sm">
                              <span className="font-medium text-foreground">{meta.fecha}</span>
                              <span className={`rounded px-2 py-0.5 text-[10px] uppercase ${meta.tipo === 'Completo' ? 'bg-primary/10 text-primary' : 'bg-warning-soft text-warning'}`}>
                                {meta.tipo}
                              </span>
                            </div>
                            <div className="mt-1 flex flex-wrap gap-3 text-[11px] text-muted-foreground font-mono">
                              <span className="truncate max-w-[55%]">{item.filename || '—'}</span>
                              <span>{formatBytes(item.size_bytes)}</span>
                              <span>sha256: {item.checksum ? `${String(item.checksum).slice(0, 12)}…` : '—'}</span>
                              {item.verified || item.status === 'completed' ? (
                                <span className="text-success flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> verificado</span>
                              ) : null}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <div className="flex justify-end gap-2 pt-1">
                    <button onClick={() => setRestore(null)} className="rounded border border-border-subtle bg-surface-subtle px-3 py-1.5 text-xs text-foreground">
                      Cancelar
                    </button>
                    <button
                      onClick={() => setRestore({ ...restore, step: 'confirm', ack: false })}
                      disabled={!restore.selected}
                      className="inline-flex items-center gap-1.5 rounded border border-primary/20 bg-primary/10 px-3 py-1.5 text-xs text-primary disabled:opacity-40"
                    >
                      Continuar
                    </button>
                  </div>
                </div>
              ) : null}

              {restore.step === 'confirm' && restore.selected ? (
                <div className="space-y-3">
                  {(() => {
                    const meta = parseBackupMeta(restore.selected);
                    return (
                      <div className="rounded border border-border-subtle bg-surface-subtle p-3 text-sm">
                        <div className="flex flex-wrap justify-between gap-2">
                          <span className="font-medium text-foreground">{meta.fecha}</span>
                          <span className="text-xs text-muted-foreground">{meta.tipo}</span>
                        </div>
                        <div className="mt-1 flex flex-wrap gap-3 text-[11px] text-muted-foreground font-mono">
                          <span className="truncate">{restore.selected.filename || restore.selected.id}</span>
                          <span>{formatBytes(restore.selected.size_bytes)}</span>
                          <span>sha256: {restore.selected.checksum ? `${String(restore.selected.checksum).slice(0, 16)}…` : '—'}</span>
                        </div>
                      </div>
                    );
                  })()}
                  <ul className="text-xs text-muted-foreground space-y-1 list-disc pl-4">
                    {RESTORE_STEPS_HINT.map((hint) => <li key={hint}>{hint}</li>)}
                  </ul>
                  <label className="flex items-start gap-2 rounded border border-danger-border bg-danger-soft p-3 text-sm text-danger cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(restore.ack)}
                      onChange={(e) => setRestore({ ...restore, ack: e.target.checked })}
                      className="mt-0.5"
                    />
                    <span>Entiendo que esta acción sobrescribirá los datos actuales y quiero restaurar este punto de «{restore.originLabel}».</span>
                  </label>
                  <div className="flex justify-end gap-2">
                    <button onClick={() => setRestore({ ...restore, step: 'list' })} className="rounded border border-border-subtle bg-surface-subtle px-3 py-1.5 text-xs text-foreground">
                      Volver
                    </button>
                    <button
                      onClick={confirmRestore}
                      disabled={!restore.ack}
                      className="inline-flex items-center gap-1.5 rounded border border-danger-border bg-danger-soft px-3 py-1.5 text-xs text-danger disabled:opacity-40"
                    >
                      <AlertTriangle className="w-3.5 h-3.5" /> Restaurar definitivamente
                    </button>
                  </div>
                </div>
              ) : null}

              {restore.step === 'running' ? (
                <div className="flex flex-col items-center gap-3 py-8 text-sm text-muted-foreground">
                  <Loader2 className="w-6 h-6 animate-spin text-primary" />
                  <p>Creando backup de seguridad, restaurando y verificando...</p>
                  <p className="text-[11px]">Se ejecuta en segundo plano: mantén esta ventana abierta.</p>
                </div>
              ) : null}

              {restore.step === 'done' && restore.result ? (
                <div className="space-y-3">
                  <div className="rounded border border-success-border bg-success-soft p-3 text-sm text-success flex items-start gap-2">
                    <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0" />
                    <div>
                      <p>{restore.result.detail || 'Restauración completada y verificada correctamente.'}</p>
                      <div className="mt-1 flex flex-wrap gap-3 text-[11px] font-mono">
                        <span>origen: {restore.result.origin}</span>
                        <span>archivo: {restore.result.filename || '—'}</span>
                        <span className={restore.result.checksum_verified ? 'text-success' : 'text-warning'}>
                          checksum: {restore.result.checksum_verified ? 'verificado' : 'no verificado'}
                        </span>
                        {restore.result.safety_backup_id ? (
                          <span>backup de seguridad: {String(restore.result.safety_backup_id).slice(0, 8)}…</span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                  {(restore.result.warnings || []).map((w) => (
                    <div key={w} className="rounded border border-warning-border bg-warning-soft p-2 text-xs text-warning">{w}</div>
                  ))}
                  <div className="flex justify-end">
                    <button onClick={() => setRestore(null)} className="rounded border border-success-border bg-success-soft px-3 py-1.5 text-xs text-success">
                      Cerrar
                    </button>
                  </div>
                </div>
              ) : null}

              {restore.step === 'failed' ? (
                <div className="space-y-3">
                  <div className="rounded border border-danger-border bg-danger-soft p-3 text-sm text-danger flex items-start gap-2">
                    <XCircle className="w-4 h-4 mt-0.5 shrink-0" />
                    <div>
                      <p className="font-medium">Restauración fallida</p>
                      <p className="mt-1 text-xs break-words">{restore.error}</p>
                    </div>
                  </div>
                  {restore.result?.rolled_back === true ? (
                    <div className="rounded border border-warning-border bg-warning-soft p-2 text-xs text-warning flex items-start gap-2">
                      <RotateCcw className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                      <span>
                        Rollback automático ejecutado: la BD fue devuelta al backup de seguridad
                        {restore.result.safety_backup_id ? ` (${String(restore.result.safety_backup_id).slice(0, 8)}…)` : ''}.
                        No queda un estado parcial.
                      </span>
                    </div>
                  ) : null}
                  {restore.result?.rolled_back === false ? (
                    <div className="rounded border border-danger-border bg-danger-soft p-2 text-xs text-danger">
                      No se pudo ejecutar el rollback automático: revisa el estado manualmente.
                    </div>
                  ) : null}
                  {(restore.result?.verify_errors || []).map((e) => (
                    <div key={e} className="rounded border border-border-subtle bg-surface-subtle p-2 text-[11px] font-mono text-muted-foreground">{e}</div>
                  ))}
                  <div className="flex justify-end gap-2">
                    <button onClick={() => openRestore(restore.origin, restore.originLabel)} className="inline-flex items-center gap-1.5 rounded border border-border-subtle bg-surface-subtle px-3 py-1.5 text-xs text-foreground">
                      <RotateCcw className="w-3.5 h-3.5" /> Volver a intentar
                    </button>
                    <button onClick={() => setRestore(null)} className="rounded border border-danger-border bg-danger-soft px-3 py-1.5 text-xs text-danger">
                      Cerrar
                    </button>
                  </div>
                </div>
              ) : null}

              {restore.step === 'error' ? (
                <div className="space-y-3">
                  <div className="rounded border border-danger-border bg-danger-soft p-3 text-sm text-danger">
                    {restore.error}
                  </div>
                  <div className="flex justify-end">
                    <button onClick={() => setRestore(null)} className="rounded border border-border-subtle bg-surface-subtle px-3 py-1.5 text-xs text-foreground">
                      Cerrar
                    </button>
                  </div>
                </div>
              ) : null}
            </PanelModal>
        ) : null}
      </AnimatePresence>
    </motion.div>
  );
}
