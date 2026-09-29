import React, { useEffect, useState, useMemo, useRef } from 'react';
import { motion } from 'framer-motion';
import {
  ScrollText, RefreshCw, Search, Download, FileText, FileSpreadsheet, FileType, Trash2, Loader2,
} from 'lucide-react';
import authService from '@/services/authService';
import examenesService from '@/services/examenesService';
import materialesService from '@/services/materialesService';
import conexionesService from '@/services/conexionesService';
import {
  buildActivityFeed,
  formatActivityDateTime,
  activityTipoLabel,
  rolBadgeClass,
  TIPO_LABEL,
} from '@/lib/adminActivity';
import { matchesRoleFilter } from '@/lib/roles';
import { getActivityIcon } from '@/lib/adminActivityIcons';
import { exportCSV, exportExcel, exportPDF } from '@/lib/conexionesExport';
import { useRefreshableLoad } from '@/hooks/useRefreshableLoad';

/** @typedef {import('@/lib/adminActivity').ActivityFeedData} ActivityFeedData */

export default function AdminAuditoria() {
  /** @type {[ActivityFeedData | null, React.Dispatch<React.SetStateAction<ActivityFeedData | null>>]} */
  const [data, setData] = useState(null);
  const [search, setSearch] = useState('');
  const [fRol, setFRol] = useState('todos');
  const [fTipo, setFTipo] = useState('todos');
  const [fDesde, setFDesde] = useState('');
  const [fHasta, setFHasta] = useState('');
  const [exportOpen, setExportOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const { loading, isBusy, lastUpdate, runLoad } = useRefreshableLoad();
  /** @type {React.MutableRefObject<ReturnType<typeof setInterval> | null>} */
  const timer = useRef(null);
  const hasData = useRef(false);

  const load = (manual = false, silent = false) => runLoad(async () => {
    const [profiles, resultados, examenes, material, , registroConexion] = await Promise.all([
      authService.listProfiles('-created_date', 500),
      examenesService.resultados.list('-created_date', 500),
      examenesService.examenes.list(),
      materialesService.materiales.list(),
      conexionesService.conexiones.list('-created_date', 100),
      conexionesService.registros.list('-created_date', 1000),
    ]);
    setData({ profiles, resultados, examenes, material, registroConexion });
    hasData.current = true;
  }, { manual, silent: silent || (!manual && hasData.current) });

  useEffect(() => {
    load();
    timer.current = setInterval(() => load(false, true), 30000);
    const unsubscribe = conexionesService.subscribeConexiones((event) => {
      const payload = conexionesService.parseWsPayload(event);
      if (
        payload?.type === 'conexion'
        || event.type === 'poll'
      ) {
        load(false, true);
      }
    });
    return () => {
      if (timer.current != null) clearInterval(timer.current);
      unsubscribe();
    };
  }, []);

  const feed = data ? buildActivityFeed(data) : [];

  const filtered = useMemo(() => {
    return feed.filter((e) => {
      if (fRol !== 'todos' && !matchesRoleFilter(e.rol, fRol)) return false;
      if (fTipo !== 'todos' && e.tipo !== fTipo) return false;
      if (fDesde && e.fecha && new Date(e.fecha) < new Date(fDesde)) return false;
      if (fHasta && e.fecha && new Date(e.fecha) > new Date(fHasta + 'T23:59:59')) return false;
      if (search) {
        const q = search.toLowerCase();
        const blob = `${e.accion} ${e.usuario} ${e.ip} ${e.detalle || ''}`.toLowerCase();
        if (!blob.includes(q)) return false;
      }
      return true;
    });
  }, [feed, search, fRol, fTipo, fDesde, fHasta]);

  const doExport = (type) => {
    setExportOpen(false);
    const cols = [
      { label: 'Fecha', accessor: (e) => formatActivityDateTime(e.fecha).date },
      { label: 'Hora', accessor: (e) => formatActivityDateTime(e.fecha).time },
      { label: 'Usuario', accessor: (e) => e.usuario },
      { label: 'Rol', accessor: (e) => e.rol },
      { label: 'Acción', accessor: (e) => e.accion },
      { label: 'Detalle', accessor: (e) => e.detalle || '' },
      { label: 'IP', accessor: (e) => e.ip },
    ];
    if (type === 'csv') exportCSV(filtered, cols);
    if (type === 'excel') exportExcel(filtered, cols);
    if (type === 'pdf') exportPDF(filtered, cols);
  };

  const handleClear = async () => {
    if (!data?.registroConexion?.length) return;
    const n = filtered.length;
    if (!window.confirm(
      `¿Eliminar ${data.registroConexion.length} registros de conexión del sistema?\n\n`
      + `La tabla de auditoría se actualizará (quedan eventos de usuarios, exámenes y material). `
      + `Mostrando ahora ${n} filas filtradas.`,
    )) return;
    setClearing(true);
    try {
      await conexionesService.registros.deleteMany({
        ids: data.registroConexion.map((r) => r.id),
      });
      await load(true);
    } catch {
      window.alert('No se pudieron eliminar los registros.');
    } finally {
      setClearing(false);
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h2 className="font-heading text-xl font-bold text-foreground flex items-center gap-2">
            <ScrollText className="w-5 h-5 text-primary" /> Registro de Auditoría
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            {filtered.length} registros · Actualizado {lastUpdate.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleClear}
            disabled={clearing || !data?.registroConexion?.length}
            className="flex items-center gap-1.5 px-3 py-2 border border-danger-border text-xs font-mono uppercase tracking-widest text-danger hover:border-danger-border hover:bg-danger-soft rounded transition-all disabled:opacity-40"
          >
            {clearing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
            Limpiar
          </button>
          <div className="relative">
            <button onClick={() => setExportOpen(!exportOpen)} className="flex items-center gap-1.5 px-3 py-2 border border-primary/40 bg-primary/10 text-xs font-mono uppercase tracking-widest text-primary hover:bg-primary/20 rounded transition-all">
              <Download className="w-3.5 h-3.5" /> Exportar
            </button>
            {exportOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setExportOpen(false)} />
                <div className="absolute right-0 mt-1 w-44 glass-card p-1.5 z-20 rounded shadow-2xl">
                  {[
                    { type: 'pdf', label: 'PDF', icon: FileText },
                    { type: 'excel', label: 'Excel', icon: FileSpreadsheet },
                    { type: 'csv', label: 'CSV', icon: FileType },
                  ].map((opt) => (
                    <button key={opt.type} onClick={() => doExport(opt.type)} className="flex items-center gap-2 w-full px-3 py-2 text-xs text-muted-foreground hover:text-primary hover:bg-primary/5 rounded transition-colors">
                      <opt.icon className="w-3.5 h-3.5" /> Exportar a {opt.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Filtros */}
      <div className="glass-card p-4">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          <div className="col-span-2 md:col-span-1 lg:col-span-1">
            <label className="block text-[10px] font-mono uppercase tracking-widest text-muted-foreground/60 mb-1">Búsqueda</label>
            <div className="flex items-center gap-2 px-2 h-9 border border-border-subtle rounded bg-surface-subtle">
              <Search className="w-3.5 h-3.5 text-muted-foreground/60" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Usuario, acción…" className="bg-transparent text-xs text-foreground outline-none w-full" />
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-mono uppercase tracking-widest text-muted-foreground/60 mb-1">Rol</label>
            <select value={fRol} onChange={(e) => setFRol(e.target.value)} className="w-full h-9 px-2 bg-input border border-border-subtle text-xs text-foreground rounded focus:outline-none focus:border-transparent">
              <option value="todos">Todos</option>
              <option value="admin">Admin</option>
              <option value="instructor">Instructor</option>
              <option value="alumno">Alumno</option>
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-mono uppercase tracking-widest text-muted-foreground/60 mb-1">Tipo</label>
            <select value={fTipo} onChange={(e) => setFTipo(e.target.value)} className="w-full h-9 px-2 bg-input border border-border-subtle text-xs text-foreground rounded focus:outline-none focus:border-transparent">
              <option value="todos">Todos</option>
              {Object.entries(TIPO_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-mono uppercase tracking-widest text-muted-foreground/60 mb-1">Desde</label>
            <input type="date" value={fDesde} onChange={(e) => setFDesde(e.target.value)} className="w-full h-9 px-2 bg-input border border-border-subtle text-xs text-foreground rounded focus:outline-none focus:border-transparent" />
          </div>
          <div>
            <label className="block text-[10px] font-mono uppercase tracking-widest text-muted-foreground/60 mb-1">Hasta</label>
            <input type="date" value={fHasta} onChange={(e) => setFHasta(e.target.value)} className="w-full h-9 px-2 bg-input border border-border-subtle text-xs text-foreground rounded focus:outline-none focus:border-transparent" />
          </div>
        </div>
      </div>

      {/* Tabla */}
      <div className="glass-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-subtle bg-surface-subtle text-left">
                <th className="px-3 py-3 text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Fecha</th>
                <th className="px-3 py-3 text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Hora</th>
                <th className="px-3 py-3 text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Usuario</th>
                <th className="px-3 py-3 text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Rol</th>
                <th className="px-3 py-3 text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Acción</th>
                <th className="px-3 py-3 text-[10px] font-mono uppercase tracking-widest text-muted-foreground">IP</th>
                <th className="px-3 py-3 text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Tipo</th>
              </tr>
            </thead>
            <tbody>
              {loading && !data ? (
                <tr><td colSpan={7} className="py-16 text-center"><RefreshCw className="w-7 h-7 text-primary animate-spin mx-auto" /></td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={7} className="py-16 text-center text-sm text-muted-foreground">No se encontraron registros de auditoría.</td></tr>
              ) : filtered.slice(0, 200).map((e) => {
                const Icon = getActivityIcon(e.tipo);
                const dt = formatActivityDateTime(e.fecha);
                return (
                  <tr key={e.id} className="border-b border-border-subtle hover:bg-primary/[0.03] transition-colors">
                    <td className="px-3 py-2.5 text-xs font-mono text-foreground/80">{dt.date}</td>
                    <td className="px-3 py-2.5 text-xs font-mono text-muted-foreground">{dt.time}</td>
                    <td className="px-3 py-2.5 text-xs text-foreground truncate max-w-[180px]">{e.usuario}</td>
                    <td className="px-3 py-2.5">
                      <span className={`inline-block px-2 py-0.5 text-[10px] font-mono uppercase border rounded ${rolBadgeClass(e.rol)}`}>{e.rol}</span>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-foreground">
                      <span className="inline-flex items-center gap-1.5">
                        <Icon className="w-3.5 h-3.5 text-muted-foreground/70 shrink-0" />
                        <span>{e.accion}</span>
                        {e.detalle ? <span className="text-muted-foreground"> · {e.detalle}</span> : null}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-xs font-mono text-muted-foreground">{e.ip}</td>
                    <td className="px-3 py-2.5 text-[10px] font-mono uppercase tracking-widest text-muted-foreground/70">{activityTipoLabel(e.tipo)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3 border-t border-border-subtle text-xs text-muted-foreground">
          Mostrando {Math.min(filtered.length, 200)} de {filtered.length} registros
        </div>
      </div>
    </motion.div>
  );
}