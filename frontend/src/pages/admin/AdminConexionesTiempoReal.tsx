import React, { useEffect, useState, useRef } from 'react';
import { motion } from 'framer-motion';
import { Radio, Eye, LogOut, Ban, History, Loader2, Wifi } from 'lucide-react';
import authService from '@/services/authService';
import conexionesService from '@/services/conexionesService';
import ConexionesDetailModal from '@/components/admin/ConexionesDetailModal';
import { rolBadgeClass } from '@/lib/adminActivity';
import { useRefreshableLoad } from '@/hooks/useRefreshableLoad';

const fmt = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
};

const duracion = (inicio) => {
  if (!inicio) return '—';
  const ms = Date.now() - new Date(inicio).getTime();
  if (isNaN(ms) || ms < 0) return '—';
  const min = Math.floor(ms / 60000);
  const h = Math.floor(min / 60);
  if (h > 0) return `${h}h ${min % 60}m`;
  return `${min}m`;
};

/** @param {{ readOnly?: boolean, title?: string }} props */
export default function AdminConexionesTiempoReal({ readOnly = false, title = 'Conexiones en vivo' } = {}) {
  const [records, setRecords] = useState([]);
  const [modalRecord, setModalRecord] = useState(null);
  const [actionLoading, setActionLoading] = useState({});
  const [, setDurationTick] = useState(0);
  const { loading, isBusy, lastUpdate, runLoad } = useRefreshableLoad();
  const hasData = useRef(false);

  const load = (manual = false, silent = false) => runLoad(async () => {
    const data = await conexionesService.registros.list('-fecha_hora', 500, { estado_sesion: 'activa' });
    setRecords(data);
    hasData.current = true;
  }, { manual, silent: manual ? false : (silent || hasData.current) });

  useEffect(() => {
    load();
    const unsubscribe = conexionesService.subscribeConexiones((event) => {
      const payload = conexionesService.parseWsPayload(event);
      if (payload?.type === 'conexion' || event.type === 'poll') load(false, true);
    });
    const durationTimer = setInterval(() => setDurationTick((t) => t + 1), 30000);
    return () => {
      unsubscribe();
      clearInterval(durationTimer);
    };
  }, []);

  const activas = records.filter((r) => r.estado_sesion === 'activa');

  const finalizarSesion = async (id) => {
    if (!window.confirm('¿Finalizar esta sesión del usuario?')) return;
    setActionLoading((p) => ({ ...p, [id]: true }));
    try {
      await conexionesService.registros.update(id, {
        estado_sesion: 'finalizada',
        fecha_cierre: new Date().toISOString(),
        ultima_actividad: new Date().toISOString(),
      });
      setRecords((prev) => prev.filter((r) => r.id !== id));
    } finally {
      setActionLoading((p) => ({ ...p, [id]: false }));
    }
  };

  const finalizarTodas = async (usuario) => {
    if (!window.confirm(`¿Finalizar TODAS las sesiones activas de "${usuario}"?`)) return;
    const sesiones = activas.filter((r) => (r.usuario || r.email) === usuario);
    setActionLoading((p) => ({ ...p, [`all-${usuario}`]: true }));
    try {
      await conexionesService.registros.bulkUpdate(
        sesiones.map((s) => ({ id: s.id, estado_sesion: 'finalizada', fecha_cierre: new Date().toISOString() }))
      );
      setRecords((prev) => prev.filter((r) => !sesiones.some((s) => s.id === r.id)));
    } finally {
      setActionLoading((p) => ({ ...p, [`all-${usuario}`]: false }));
    }
  };

  const bloquearUsuario = async (record) => {
    if (!window.confirm(`¿Bloquear al usuario "${record.nombre_completo || record.usuario}"?`)) return;
    setActionLoading((p) => ({ ...p, [`blk-${record.id}`]: true }));
    try {
      const profiles = await authService.filterProfiles({ email: record.email });
      if (profiles.length > 0) {
        await authService.updateProfile(profiles[0].id, { status: 'bloqueado' });
      }
      window.alert('Usuario bloqueado correctamente.');
    } catch {
      window.alert('No se pudo bloquear al usuario.');
    } finally {
      setActionLoading((p) => ({ ...p, [`blk-${record.id}`]: false }));
    }
  };

  const usuariosUnicos = new Set(activas.map((r) => r.usuario || r.email).filter(Boolean)).size;

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h2 className="font-heading text-xl font-bold text-foreground flex items-center gap-2">
            <Radio className="w-5 h-5 text-primary" /> {title}
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            {activas.length} sesiones activas · {usuariosUnicos} usuarios conectados
            {readOnly ? ' · Tiempo real' : ''}
            {' · Actualizado '}
            {lastUpdate.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </p>
        </div>
      </div>

      {/* Tabla */}
      <div className="glass-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-subtle bg-surface-subtle text-left">
                <th className="px-3 py-3 text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Usuario</th>
                <th className="px-3 py-3 text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Rol</th>
                <th className="px-3 py-3 text-[10px] font-mono uppercase tracking-widest text-muted-foreground">IP</th>
                <th className="px-3 py-3 text-[10px] font-mono uppercase tracking-widest text-muted-foreground hidden md:table-cell">Ubicación</th>
                <th className="px-3 py-3 text-[10px] font-mono uppercase tracking-widest text-muted-foreground hidden lg:table-cell">Dispositivo</th>
                <th className="px-3 py-3 text-[10px] font-mono uppercase tracking-widest text-muted-foreground hidden lg:table-cell">Sistema</th>
                <th className="px-3 py-3 text-[10px] font-mono uppercase tracking-widest text-muted-foreground hidden md:table-cell">Navegador</th>
                <th className="px-3 py-3 text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Inicio</th>
                <th className="px-3 py-3 text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Tiempo</th>
                <th className="px-3 py-3 text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Estado</th>
                <th className="px-3 py-3 text-[10px] font-mono uppercase tracking-widest text-muted-foreground text-right">{readOnly ? 'Detalle' : 'Acciones'}</th>
              </tr>
            </thead>
            <tbody>
              {loading && records.length === 0 ? (
                <tr><td colSpan={11} className="py-16 text-center"><Loader2 className="w-7 h-7 text-primary animate-spin mx-auto" /></td></tr>
              ) : activas.length === 0 ? (
                <tr><td colSpan={11} className="py-16 text-center text-sm text-muted-foreground">
                  <Wifi className="w-8 h-8 mx-auto mb-2 text-muted-foreground/40" />
                  No hay sesiones activas en este momento.
                </td></tr>
              ) : activas.map((r) => (
                <tr key={r.id} className="border-b border-border-subtle hover:bg-primary/[0.03] transition-colors">
                  <td className="px-3 py-2.5">
                    <p className="text-xs text-foreground truncate max-w-[180px]">{r.nombre_completo || r.usuario}</p>
                    <p className="text-[10px] text-muted-foreground/60 truncate max-w-[180px]">{r.email}</p>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={`inline-block px-2 py-0.5 text-[10px] font-mono uppercase border rounded ${rolBadgeClass(r.rol)}`}>{r.rol}</span>
                  </td>
                  <td className="px-3 py-2.5 text-xs font-mono text-foreground/80">{r.direccion_ip || '—'}</td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground hidden md:table-cell">{r.ciudad ? `${r.ciudad}, ${r.pais}` : '—'}</td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground hidden lg:table-cell">{r.tipo_dispositivo || '—'}</td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground hidden lg:table-cell">{r.sistema_operativo || '—'}</td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground hidden md:table-cell">{r.navegador || '—'}</td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground">{fmt(r.fecha_hora)}</td>
                  <td className="px-3 py-2.5 text-xs font-mono text-primary">{duracion(r.fecha_hora)}</td>
                  <td className="px-3 py-2.5">
                    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-mono uppercase border border-success-border bg-success-soft text-success rounded">
                      <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" /> Activa
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center justify-end gap-1">
                      {actionLoading[r.id] ? (
                        <Loader2 className="w-3.5 h-3.5 text-muted-foreground animate-spin" />
                      ) : (
                        <>
                          <button onClick={() => setModalRecord(r)} title="Ver detalles" className="w-7 h-7 flex items-center justify-center border border-border-subtle text-muted-foreground hover:border-primary/40 hover:text-primary rounded transition-all">
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                          {!readOnly && (
                            <>
                              <button onClick={() => finalizarSesion(r.id)} title="Finalizar sesión" className="w-7 h-7 flex items-center justify-center border border-border-subtle text-warning hover:border-warning-border hover:bg-warning-soft rounded transition-all">
                                <LogOut className="w-3.5 h-3.5" />
                              </button>
                              <button onClick={() => finalizarTodas(r.usuario || r.email)} title="Finalizar todas" className="w-7 h-7 flex items-center justify-center border border-border-subtle text-warning hover:border-warning-border hover:bg-warning-soft rounded transition-all">
                                <History className="w-3.5 h-3.5" />
                              </button>
                              <button onClick={() => bloquearUsuario(r)} title="Bloquear usuario" className="w-7 h-7 flex items-center justify-center border border-border-subtle text-danger hover:border-danger-border hover:bg-danger-soft rounded transition-all">
                                <Ban className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <ConexionesDetailModal record={modalRecord} onClose={() => setModalRecord(null)} />
    </motion.div>
  );
}
