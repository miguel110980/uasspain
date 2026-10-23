import DataLoadNotice from '@/components/ui/DataLoadNotice';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Loader2, Search,
} from 'lucide-react';
import authService from '@/services/authService';
import examenesService from '@/services/examenesService';
import materialesService from '@/services/materialesService';
import conexionesService from '@/services/conexionesService';
import {
  ACTIVITY_TIPO_FILTERS,
  activityTipoStyle,
  buildActivityFeed,
  formatActivityDateTime,
  labelForActivityFilter,
  matchesActivityFilter,
  rolBadgeClass,
} from '@/lib/adminActivity';
import { getActivityIcon } from '@/lib/adminActivityIcons';
import { useRefreshableLoad } from '@/hooks/useRefreshableLoad';

/** @typedef {import('@/lib/adminActivity').ActivityFeedData} ActivityFeedData */
/** @typedef {import('@/lib/adminActivity').ActivityFiltroTipo} ActivityFiltroTipo */

export default function AdminActividad() {
  const [data, setData] = useState(/** @type {ActivityFeedData | null} */ (null));
  const [search, setSearch] = useState('');
  const [filtroTipo, setFiltroTipo] = useState(/** @type {ActivityFiltroTipo} */ ('todos'));
  const { loading, lastUpdate, runLoad, error: loadError } = useRefreshableLoad();
  /** @type {React.MutableRefObject<ReturnType<typeof setInterval> | null>} */
  const timer = useRef(null);
  const hasData = useRef(false);

  const load = (manual = false, silent = false) => runLoad(async () => {
    const [profiles, resultados, examenes, material, , registroConexion] = await Promise.all([
      authService.listProfiles('-created_date', 500),
      examenesService.resultados.list('-created_date', 500),
      examenesService.examenes.list(),
      materialesService.materiales.list('-created_date', 500),
      conexionesService.conexiones.list('-created_date', 100),
      conexionesService.registros.list('-fecha_hora', 1000),
    ]);
    setData({ profiles, resultados, examenes, material, registroConexion });
    hasData.current = true;
  }, { manual, silent: manual ? false : (silent || hasData.current) });

  useEffect(() => {
    load();
    timer.current = setInterval(() => load(false, true), 30000);
    const unsubscribe = conexionesService.subscribeConexiones((event) => {
      const payload = conexionesService.parseWsPayload(event);
      if (payload?.type === 'conexion' || event.type === 'poll') load(false, true);
    });
    return () => {
      if (timer.current != null) clearInterval(timer.current);
      unsubscribe();
    };
  }, []);

  const feed = data ? buildActivityFeed(data) : [];

  const filtered = useMemo(() => feed.filter((e) => {
    if (!matchesActivityFilter(e, filtroTipo)) return false;
    if (search) {
      const q = search.toLowerCase();
      const blob = `${e.accion} ${e.usuario} ${e.rol} ${e.ip} ${e.detalle || ''}`.toLowerCase();
      if (!blob.includes(q)) return false;
    }
    return true;
  }), [feed, search, filtroTipo]);

  const sesionesActivas = useMemo(
    () => feed.filter((e) => e.tipo === 'login' && e.sesionActiva).length,
    [feed],
  );

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
      <DataLoadNotice error={loadError} retry={() => load(true)} />
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h2 className="font-heading text-xl font-bold text-foreground">Actividad en tiempo real</h2>
          <p className="text-xs text-muted-foreground mt-1">
            {filtroTipo === 'login'
              ? `${filtered.length} sesiones abiertas · ${sesionesActivas} activas ahora`
              : `${filtered.length} eventos mostrados · ${feed.length} en total`}
            {' · Actualizado '}
            {lastUpdate.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </p>
        </div>
      </div>

      <div className="flex flex-col md:flex-row gap-3">
        <div className="flex items-center gap-2 px-3 h-10 flex-1 border border-border-subtle rounded-md bg-surface-subtle focus-within:border-primary/30">
          <Search className="w-4 h-4 text-muted-foreground/60" />
          <input aria-label="Buscar por usuario, acción, rol, IP…"
            value={search}
            onChange={(ev) => setSearch(ev.target.value)}
            placeholder="Buscar por usuario, acción, rol, IP…"
            className="bg-transparent text-sm text-foreground placeholder:text-muted-foreground/40 outline-none w-full"
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          {ACTIVITY_TIPO_FILTERS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setFiltroTipo(t)}
              className={`px-3 py-2 text-[10px] font-mono uppercase tracking-widest border rounded transition-all ${
                filtroTipo === t
                  ? 'border-primary/50 bg-primary/10 text-primary'
                  : 'border-border-subtle text-muted-foreground hover:border-primary/30 hover:text-brand-cyan-text'
              }`}
            >
              {labelForActivityFilter(t)}
            </button>
          ))}
        </div>
      </div>

      <div tabIndex={0} role="region" aria-label="Eventos de actividad" className="glass-card p-4 space-y-2 max-h-[70vh] overflow-y-auto">
        {loading && !data ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="w-6 h-6 text-primary animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-10">
            {filtroTipo === 'login'
              ? 'No hay sesiones abiertas en este momento.'
              : 'No hay eventos que coincidan con los filtros.'}
          </p>
        ) : (
          filtered.map((e, i) => {
            const Icon = getActivityIcon(e.tipo);
            const dt = formatActivityDateTime(e.fecha);
            return (
              <motion.div
                key={e.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: Math.min(i * 0.02, 0.3) }}
                className="flex items-center gap-3 px-3 py-3 border border-border-subtle rounded hover:bg-surface-subtle transition-colors"
              >
                <span className={`w-9 h-9 shrink-0 flex items-center justify-center rounded border ${activityTipoStyle(e.tipo)}`}>
                  <Icon className="w-4 h-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-foreground">
                    <span className="font-medium">{e.accion}</span>
                    {e.detalle ? <span className="text-muted-foreground"> · {e.detalle}</span> : null}
                  </p>
                  <p className="text-[10px] text-muted-foreground/70 mt-0.5">
                    {e.usuario !== '—' ? <span>{e.usuario} · </span> : null}
                    <span className={`inline-block px-1 border rounded ${rolBadgeClass(e.rol)}`}>{e.rol}</span>
                    {' · IP '}
                    <span className="font-mono">{e.ip}</span>
                    {e.pais && e.pais !== '—' ? <span> · {e.ciudad}, {e.pais}</span> : null}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-[10px] font-mono text-foreground/80">{dt.date}</p>
                  <p className="text-[10px] font-mono text-muted-foreground/60">{dt.time}</p>
                </div>
              </motion.div>
            );
          })
        )}
      </div>
    </motion.div>
  );
}
