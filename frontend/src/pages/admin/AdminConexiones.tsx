import DataLoadNotice from '@/components/ui/DataLoadNotice';
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { motion } from 'framer-motion';
import {
  Search, Download, ChevronUp, ChevronDown, ChevronLeft, ChevronRight,
  SlidersHorizontal, Eye, Loader2, FileText, FileSpreadsheet, FileType, Trash2,
} from 'lucide-react';
import conexionesService from '@/services/conexionesService';
import { exportCSV, exportExcel, exportPDF } from '@/lib/conexionesExport';
import { badgeClassFromMap, rolBadgeClass } from '@/lib/adminActivity';
import ConexionesDetailModal from '@/components/admin/ConexionesDetailModal';
import { matchesRoleFilter } from '@/lib/roles';
import { useRefreshableLoad } from '@/hooks/useRefreshableLoad';

const COLUMNS = [
  { key: 'id', label: 'ID', accessor: (r) => r.id, sortable: true, minW: '120px' },
  { key: 'fecha_hora', label: 'Fecha y hora', accessor: (r) => r.fecha_hora, sortable: true, minW: '140px' },
  { key: 'usuario', label: 'Usuario', accessor: (r) => r.usuario, sortable: true, minW: '120px' },
  { key: 'nombre_completo', label: 'Nombre completo', accessor: (r) => r.nombre_completo, sortable: true, minW: '160px' },
  { key: 'email', label: 'Email', accessor: (r) => r.email, sortable: true, minW: '200px' },
  { key: 'rol', label: 'Rol', accessor: (r) => r.rol, sortable: true, minW: '100px' },
  { key: 'direccion_ip', label: 'Dirección IP', accessor: (r) => r.direccion_ip, sortable: true, minW: '130px' },
  { key: 'pais', label: 'País', accessor: (r) => r.pais, sortable: true, minW: '100px' },
  { key: 'ciudad', label: 'Ciudad', accessor: (r) => r.ciudad, sortable: true, minW: '110px' },
  { key: 'region', label: 'Región', accessor: (r) => r.region, sortable: true, minW: '110px' },
  { key: 'isp', label: 'ISP', accessor: (r) => r.isp, sortable: true, minW: '150px' },
  { key: 'hostname', label: 'Hostname', accessor: (r) => r.hostname, sortable: true, minW: '150px' },
  { key: 'navegador', label: 'Navegador', accessor: (r) => r.navegador, sortable: true, minW: '100px' },
  { key: 'version_navegador', label: 'Versión', accessor: (r) => r.version_navegador, sortable: true, minW: '90px' },
  { key: 'sistema_operativo', label: 'Sistema operativo', accessor: (r) => r.sistema_operativo, sortable: true, minW: '130px' },
  { key: 'tipo_dispositivo', label: 'Dispositivo', accessor: (r) => r.tipo_dispositivo, sortable: true, minW: '110px' },
  { key: 'zona_horaria', label: 'Zona horaria', accessor: (r) => r.zona_horaria, sortable: true, minW: '120px' },
  { key: 'metodo_autenticacion', label: 'Método', accessor: (r) => r.metodo_autenticacion, sortable: true, minW: '110px' },
  { key: 'estado_acceso', label: 'Estado acceso', accessor: (r) => r.estado_acceso, sortable: true, minW: '120px' },
  { key: 'motivo_fallo', label: 'Motivo fallo', accessor: (r) => r.motivo_fallo, sortable: true, minW: '160px' },
  { key: 'tiempo_sesion', label: 'Tiempo sesión', accessor: (r) => r.tiempo_sesion, sortable: true, minW: '110px' },
  { key: 'fecha_cierre', label: 'Cierre sesión', accessor: (r) => r.fecha_cierre, sortable: true, minW: '140px' },
  { key: 'estado_sesion', label: 'Estado sesión', accessor: (r) => r.estado_sesion, sortable: true, minW: '120px' },
  { key: 'session_id', label: 'ID sesión', accessor: (r) => r.session_id, sortable: true, minW: '140px' },
  { key: 'ultima_actividad', label: 'Última actividad', accessor: (r) => r.ultima_actividad, sortable: true, minW: '140px' },
];

const ACCESS_BADGE = {
  correcto: 'border-success-border bg-success-soft text-success',
  fallido: 'border-danger-border bg-danger-soft text-danger',
  bloqueado: 'border-warning-border bg-warning-soft text-warning',
  expirado: 'border-info-border bg-info-soft text-info',
};
const SESSION_BADGE = {
  activa: 'border-success-border bg-success-soft text-success',
  finalizada: 'border-info-border bg-info-soft text-info',
  expirada: 'border-warning-border bg-warning-soft text-warning',
};

const fmtDuration = (seconds) => {
  if (seconds == null || seconds === '') return '—';
  const total = Number(seconds);
  if (Number.isNaN(total) || total < 0) return '—';
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
};

const fmtDate = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};
const maskSession = (id) => {
  if (!id) return '—';
  if (id.length <= 8) return id;
  return `${id.slice(0, 4)}••••${id.slice(-4)}`;
};
const titleCase = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;

const renderCell = (col, r) => {
  const val = col.accessor(r);
  if (col.key === 'fecha_hora' || col.key === 'fecha_cierre' || col.key === 'ultima_actividad') return fmtDate(val);
  if (col.key === 'tiempo_sesion') return fmtDuration(val);
  if (col.key === 'estado_acceso') return <span className={`inline-flex px-2 py-0.5 text-[10px] font-mono uppercase tracking-widest border ${badgeClassFromMap(ACCESS_BADGE, val)}`}>{val}</span>;
  if (col.key === 'estado_sesion') return <span className={`inline-flex px-2 py-0.5 text-[10px] font-mono uppercase tracking-widest border ${badgeClassFromMap(SESSION_BADGE, val)}`}>{val}</span>;
  if (col.key === 'rol') return <span className={`inline-flex px-2 py-0.5 text-[10px] font-mono uppercase tracking-widest border ${rolBadgeClass(val)}`}>{val}</span>;
  if (col.key === 'session_id') return <span className="font-mono text-xs text-muted-foreground">{maskSession(val)}</span>;
  if (col.key === 'metodo_autenticacion' || col.key === 'tipo_dispositivo') return titleCase(val);
  if (val == null || val === '') return '—';
  return String(val);
};

const EMPTY_FILTERS = { usuario: '', email: '', rol: '', direccion_ip: '', pais: '', ciudad: '', estado_acceso: '', estado_sesion: '', fechaDesde: '', fechaHasta: '' };

const emptyFiltersForScope = (alumnoOnly) =>
  alumnoOnly ? { ...EMPTY_FILTERS, rol: 'alumno' } : { ...EMPTY_FILTERS };

const ROL_FILTER_OPTIONS = [
  ['', 'Todos'],
  ['admin', 'Administrador'],
  ['instructor', 'Instructor'],
  ['alumno', 'Alumno'],
];

const initialFilters = (alumnoOnly, activeSessionsOnly) => {
  const base = emptyFiltersForScope(alumnoOnly);
  return activeSessionsOnly ? { ...base, estado_sesion: 'activa' } : base;
};

/** @param {{ alumnoOnly?: boolean, allowClear?: boolean, activeSessionsOnly?: boolean }} props */
export default function AdminConexiones({ alumnoOnly = false, allowClear = true, activeSessionsOnly = false } = {}) {
  const [records, setRecords] = useState([]);
  const { loading, lastUpdate, runLoad, error: loadError } = useRefreshableLoad();
  const hasData = useRef(false);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState({ key: 'fecha_hora', dir: 'desc' });
  const [filters, setFilters] = useState(() => initialFilters(alumnoOnly, activeSessionsOnly));
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [modalRecord, setModalRecord] = useState(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [clearing, setClearing] = useState(false);

  const loadRecords = (manual = false) => runLoad(async () => {
    const apiFilters = activeSessionsOnly ? { estado_sesion: 'activa' } : {};
    const data = await conexionesService.registros.list('-fecha_hora', 1000, apiFilters);
    setRecords(data);
    hasData.current = true;
  }, { manual, silent: manual ? false : hasData.current });

  useEffect(() => {
    loadRecords();
    if (!activeSessionsOnly) {
      const timer = setInterval(() => loadRecords(false), 30000);
      return () => clearInterval(timer);
    }
    const unsubscribe = conexionesService.subscribeConexiones((event) => {
      const payload = conexionesService.parseWsPayload(event);
      if (payload?.type === 'conexion' || event.type === 'poll') loadRecords(false);
    });
    return () => unsubscribe();
  }, [activeSessionsOnly]);

  const filtered = useMemo(() => {
    let out = records;
    // global search
    if (search.trim()) {
      const q = search.toLowerCase();
      out = out.filter((r) =>
        COLUMNS.some((c) => String(c.accessor(r) ?? '').toLowerCase().includes(q))
      );
    }
    // field filters
    const f = filters;
    out = out.filter((r) => {
      if (f.usuario && !String(r.usuario ?? '').toLowerCase().includes(f.usuario.toLowerCase())) return false;
      if (f.email && !String(r.email ?? '').toLowerCase().includes(f.email.toLowerCase())) return false;
      if (f.rol && !matchesRoleFilter(r.rol, f.rol)) return false;
      if (f.direccion_ip && !String(r.direccion_ip ?? '').toLowerCase().includes(f.direccion_ip.toLowerCase())) return false;
      if (f.pais && !String(r.pais ?? '').toLowerCase().includes(f.pais.toLowerCase())) return false;
      if (f.ciudad && !String(r.ciudad ?? '').toLowerCase().includes(f.ciudad.toLowerCase())) return false;
      if (f.estado_acceso && r.estado_acceso !== f.estado_acceso) return false;
      if (f.estado_sesion && r.estado_sesion !== f.estado_sesion) return false;
      if (f.fechaDesde && r.fecha_hora && new Date(r.fecha_hora) < new Date(f.fechaDesde)) return false;
      if (f.fechaHasta && r.fecha_hora && new Date(r.fecha_hora) > new Date(f.fechaHasta + 'T23:59:59')) return false;
      return true;
    });
    // sort
    const col = COLUMNS.find((c) => c.key === sort.key);
    if (col) {
      out = [...out].sort((a, b) => {
        const av = col.accessor(a) ?? '';
        const bv = col.accessor(b) ?? '';
        let cmp = 0;
        if (sort.key === 'fecha_hora' || sort.key === 'fecha_cierre' || sort.key === 'ultima_actividad') {
          cmp = new Date(av).getTime() - new Date(bv).getTime();
        } else if (!isNaN(Number(av)) && !isNaN(Number(bv))) {
          cmp = Number(av) - Number(bv);
        } else {
          cmp = String(av).localeCompare(String(bv));
        }
        return sort.dir === 'asc' ? cmp : -cmp;
      });
    }
    return out;
  }, [records, search, filters, sort]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paginated = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const activeFilterCount = Object.entries(filters).filter(([k, v]) => {
    if (activeSessionsOnly && k === 'estado_sesion') return false;
    return Boolean(v);
  }).length;

  const handleSort = (key) => {
    setSort((prev) => prev.key === key
      ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: 'asc' });
  };

  const resetFilters = () => {
    setFilters(initialFilters(alumnoOnly, activeSessionsOnly));
    setSearch('');
    setPage(1);
  };

  const doExport = (type) => {
    setExportOpen(false);
    const cols = COLUMNS.map((c) => ({ label: c.label, accessor: (r) => {
      if (c.key === 'fecha_hora' || c.key === 'fecha_cierre' || c.key === 'ultima_actividad') return fmtDate(c.accessor(r));
      return c.accessor(r);
    }}));
    if (type === 'csv') exportCSV(filtered, cols);
    if (type === 'excel') exportExcel(filtered, cols);
    if (type === 'pdf') exportPDF(filtered, cols);
  };

  const handleClearTable = async () => {
    if (filtered.length === 0) return;
    if (!window.confirm(`¿Eliminar ${filtered.length} registros de la tabla? Esta acción no se puede deshacer.`)) return;
    setClearing(true);
    try {
      await conexionesService.registros.deleteMany({ ids: filtered.map((r) => r.id) });
      await loadRecords(true);
    } catch {
      window.alert('No se pudo limpiar la tabla.');
    } finally {
      setClearing(false);
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="space-y-4">
      <DataLoadNotice error={loadError} retry={() => loadRecords(true)} />
      {/* Toolbar */}
      <div className="flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
        <p className="text-xs text-muted-foreground md:order-first w-full md:w-auto">
          {activeSessionsOnly
            ? `${filtered.length} conexiones activas`
            : `${filtered.length} registros`}
          {' · Actualizado '}
          {lastUpdate.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </p>
        <div className="flex items-center gap-2 flex-1">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input aria-label="Búsqueda global..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder="Búsqueda global..."
              className="w-full pl-9 pr-3 py-2 bg-input border border-border-subtle text-sm text-foreground placeholder:text-muted-foreground/50 rounded focus:outline-none focus:border-transparent"
            />
          </div>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`relative flex items-center gap-1.5 px-3 py-2 border text-xs font-mono uppercase tracking-widest rounded transition-all ${showFilters ? 'border-primary/50 bg-primary/10 text-primary' : 'border-border-subtle text-muted-foreground hover:border-primary/30 hover:text-primary'}`}
          >
            <SlidersHorizontal className="w-4 h-4" />
            Filtros
            {activeFilterCount > 0 && <span className="ml-1 px-1.5 py-0.5 bg-primary/20 text-primary text-[9px] rounded-full">{activeFilterCount}</span>}
          </button>
        </div>

        <div className="flex items-center gap-2">
          {allowClear && (
            <button
              type="button"
              onClick={handleClearTable}
              disabled={clearing || filtered.length === 0}
              className="flex items-center gap-1.5 px-3 py-2 border border-danger-border text-xs font-mono uppercase tracking-widest text-danger hover:bg-danger-soft rounded transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {clearing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
              Limpiar
            </button>
          )}
          <div className="relative">
            <button onClick={() => setExportOpen(!exportOpen)} className="flex items-center gap-1.5 px-3 py-2 border border-primary/40 bg-primary/10 text-xs font-mono uppercase tracking-widest text-primary hover:bg-primary/20 rounded transition-all">
              <Download className="w-3.5 h-3.5" />
              Exportar
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

      {/* Filters panel */}
      {showFilters && (
        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="glass-card p-4 rounded">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            <FilterInput label="Usuario" value={filters.usuario} onChange={(v) => { setFilters({ ...filters, usuario: v }); setPage(1); }} />
            <FilterInput label="Email" value={filters.email} onChange={(v) => { setFilters({ ...filters, email: v }); setPage(1); }} />
            <FilterSelect label="Rol" value={filters.rol} onChange={(v) => { setFilters({ ...filters, rol: v }); setPage(1); }} options={alumnoOnly ? [['', 'Todos'], ['alumno', 'Alumno']] : ROL_FILTER_OPTIONS} />
            <FilterInput label="IP" value={filters.direccion_ip} onChange={(v) => { setFilters({ ...filters, direccion_ip: v }); setPage(1); }} />
            <FilterInput label="País" value={filters.pais} onChange={(v) => { setFilters({ ...filters, pais: v }); setPage(1); }} />
            <FilterInput label="Ciudad" value={filters.ciudad} onChange={(v) => { setFilters({ ...filters, ciudad: v }); setPage(1); }} />
            <FilterSelect label="Estado acceso" value={filters.estado_acceso} onChange={(v) => { setFilters({ ...filters, estado_acceso: v }); setPage(1); }} options={[['', 'Todos'], ['correcto', 'Correcto'], ['fallido', 'Fallido'], ['bloqueado', 'Bloqueado'], ['expirado', 'Expirado']]} />
            <FilterSelect label="Estado sesión" value={filters.estado_sesion} onChange={(v) => { setFilters({ ...filters, estado_sesion: v }); setPage(1); }} options={[['', 'Todos'], ['activa', 'Activa'], ['finalizada', 'Finalizada'], ['expirada', 'Expirada']]} disabled={activeSessionsOnly} />
            <FilterInput label="Desde" type="date" value={filters.fechaDesde} onChange={(v) => { setFilters({ ...filters, fechaDesde: v }); setPage(1); }} />
            <FilterInput label="Hasta" type="date" value={filters.fechaHasta} onChange={(v) => { setFilters({ ...filters, fechaHasta: v }); setPage(1); }} />
          </div>
          <div className="flex justify-end mt-3">
            <button onClick={resetFilters} className="text-xs font-mono uppercase tracking-widest text-muted-foreground hover:text-primary transition-colors">Limpiar filtros</button>
          </div>
        </motion.div>
      )}

      {/* Table */}
      <div className="glass-card rounded overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-subtle bg-surface-subtle">
                {COLUMNS.map((col) => (
                  <th
                    key={col.key}
                    aria-sort={col.sortable && sort.key === col.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                    style={{ minWidth: col.minW }}
                    className={`px-3 py-3 text-left text-[10px] font-mono uppercase tracking-widest text-muted-foreground whitespace-nowrap ${col.sortable ? 'cursor-pointer hover:text-primary select-none' : ''}`}
                  >
                    {col.sortable ? (<button type="button" onClick={() => handleSort(col.key)} className="inline-flex items-center gap-1 text-left">
                      {col.label}
                      {col.sortable && sort.key === col.key && (
                        sort.dir === 'asc' ? <ChevronUp className="w-3 h-3 text-primary" /> : <ChevronDown className="w-3 h-3 text-primary" />
                      )}
                    </button>) : col.label}
                  </th>
                ))}
                <th className="px-3 py-3 text-left text-[10px] font-mono uppercase tracking-widest text-muted-foreground whitespace-nowrap" style={{ minWidth: '80px' }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {loading && records.length === 0 ? (
                <tr><td colSpan={COLUMNS.length + 1} className="py-16 text-center"><Loader2 className="w-7 h-7 text-primary animate-spin mx-auto" /></td></tr>
              ) : paginated.length === 0 ? (
                <tr><td colSpan={COLUMNS.length + 1} className="py-16 text-center text-sm text-muted-foreground">
                  {activeSessionsOnly ? 'No hay conexiones activas en este momento.' : 'No se encontraron registros de conexión.'}
                </td></tr>
              ) : paginated.map((r) => (
                <tr key={r.id} className="border-b border-border-subtle hover:bg-primary/[0.03] transition-colors">
                  {COLUMNS.map((col) => (
                    <td key={col.key} className="px-3 py-2.5 text-xs text-foreground/90 whitespace-nowrap align-middle">
                      {renderCell(col, r)}
                    </td>
                  ))}
                  <td className="px-3 py-2.5 whitespace-nowrap align-middle">
                    <button aria-label="Ver detalle" onClick={() => setModalRecord(r)} className="inline-flex items-center justify-center w-7 h-7 border border-border-subtle text-muted-foreground hover:border-primary/40 hover:text-primary rounded transition-all" title="Ver detalle">
                      <Eye className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t border-border-subtle">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Mostrando</span>
            <select aria-label="Registros por página"
              value={pageSize}
              onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
              className="bg-input border border-border-subtle text-foreground rounded px-2 py-1 focus:outline-none focus:border-transparent"
            >
              {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            <span>de {filtered.length} registros</span>
          </div>
          <div className="flex items-center gap-1">
            <button aria-label="Página anterior" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)} className="w-7 h-7 flex items-center justify-center border border-border-subtle text-muted-foreground hover:border-primary/40 hover:text-primary rounded disabled:opacity-30 disabled:cursor-not-allowed transition-all">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-xs font-mono text-muted-foreground px-2">{currentPage} / {totalPages}</span>
            <button aria-label="Página siguiente" disabled={currentPage >= totalPages} onClick={() => setPage(currentPage + 1)} className="w-7 h-7 flex items-center justify-center border border-border-subtle text-muted-foreground hover:border-primary/40 hover:text-primary rounded disabled:opacity-30 disabled:cursor-not-allowed transition-all">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      <ConexionesDetailModal record={modalRecord} onClose={() => setModalRecord(null)} />
    </motion.div>
  );
}

function FilterInput({ label, value, onChange, type = 'text' }) {
  return (
    <div>
      <label htmlFor={`adminconexiones-${String(label).replace(/\s+/g, '-')}`} className="block text-[10px] font-mono uppercase tracking-widest text-muted-foreground/60 mb-1">{label}</label>
      <input id={`adminconexiones-${String(label).replace(/\s+/g, '-')}`}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-2 py-1.5 bg-input border border-border-subtle text-xs text-foreground rounded focus:outline-none focus:border-transparent"
      />
    </div>
  );
}

function FilterSelect({ label, value, onChange, options, disabled = false }) {
  return (
    <div>
      <label htmlFor={`adminconexiones-${String(label).replace(/\s+/g, '-')}`} className="block text-[10px] font-mono uppercase tracking-widest text-muted-foreground/60 mb-1">{label}</label>
      <select id={`adminconexiones-${String(label).replace(/\s+/g, '-')}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w-full px-2 py-1.5 bg-input border border-border-subtle text-xs text-foreground rounded focus:outline-none focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {options.map(([val, lbl]) => <option key={val} value={val}>{lbl}</option>)}
      </select>
    </div>
  );
}
