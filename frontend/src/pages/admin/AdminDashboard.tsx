import React, { useEffect, useState, useRef } from 'react';
import { motion } from 'framer-motion';
import {
  Users, Shield, GraduationCap, UserCheck, Radio, BookOpen, ClipboardList,
  Award, HardDrive, Activity, Server, Loader2,
} from 'lucide-react';
import authService from '@/services/authService';
import examenesService from '@/services/examenesService';
import materialesService from '@/services/materialesService';
import conexionesService from '@/services/conexionesService';
import { loadResources } from '@/lib/loadResources';
import KpiCard from '@/components/admin/KpiCard';
import { buildActivityFeed, formatActivityTimestamp, rolBadgeClass } from '@/lib/adminActivity';
import { getActivityIcon } from '@/lib/adminActivityIcons';
import { databaseConnected, statusUiFor, websocketServiceStatus } from '@/lib/systemStatus';

function buildServices(status) {
  if (!status) return [];
  const dbOk = databaseConnected(status) && status.backend?.status === 'ok';
  const smtp = status.smtp || {};
  const oauth = status.google_oauth || {};
  const ws = websocketServiceStatus(status);
  return [
    { name: 'API REST', status: dbOk ? 'ok' : 'err', value: dbOk ? 'Online' : 'Degradado' },
    {
      name: 'Redis / WS',
      status: ws.status,
      value: ws.value,
    },
    { name: 'SMTP', status: smtp.configured ? 'ok' : 'warn', value: smtp.configured ? 'Configurado' : 'Sin credenciales' },
    { name: 'Google OAuth', status: oauth.configured ? 'ok' : 'warn', value: oauth.configured ? 'Listo' : 'Pendiente' },
    { name: 'Modo', status: status.platform?.production ? 'ok' : (status.platform?.debug ? 'warn' : 'ok'), value: status.platform?.production ? 'Producción' : 'Desarrollo' },
  ];
}

export default function AdminDashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastUpdate, setLastUpdate] = useState(new Date());
  const timer = useRef(/** @type {ReturnType<typeof setInterval> | null} */ (null));

  const load = async () => {
    try {
      const { values, failed } = await loadResources({
        profiles: () => authService.listProfiles('-created_date', 500),
        resultados: () => examenesService.resultados.list('-created_date', 500),
        examenes: () => examenesService.examenes.list(),
        material: () => materialesService.materiales.list(),
        conexiones: () => conexionesService.conexiones.list('-created_date', 100),
        registroConexion: () => conexionesService.registros.list('-created_date', 500),
        systemStatus: () => authService.getSystemStatus(),
        counts: () => authService.dashboardCounts(),
      });
      setData(previous => ({ profiles: [], resultados: [], examenes: [], material: [], conexiones: [], registroConexion: [], ...previous, ...values }));
      setError(failed.length ? 'Algunos datos no se pudieron actualizar. Se conservan los últimos datos disponibles.' : '');
      setLastUpdate(new Date());
    } catch {
      setError('No se pudieron actualizar los datos del panel. Vuelve a intentarlo.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    timer.current = setInterval(() => load(), 30000);
    return () => {
      if (timer.current != null) clearInterval(timer.current);
    };
  }, []);

  const systemStatus = data?.systemStatus;
  const users = systemStatus?.users;
  const academic = systemStatus?.academic;
  const totalUsuarios = users?.total ?? '—';
  const conectadosUnicos = data?.counts?.active_sessions ?? '—';
  const cursos = academic?.published_courses ?? '—';
  const examenesDisp = academic?.available_exams ?? '—';
  const aprobados = academic?.passed_exams ?? '—';
  const services = buildServices(systemStatus);
  const serviciosOk = services.filter((s) => s.status === 'ok').length;

  const feed = data ? buildActivityFeed(data).slice(0, 9) : [];

  return (
    <div className="space-y-6">
      {error && <div role="alert" className="p-3 border border-danger-border bg-danger-soft text-danger text-sm">{error} <button onClick={load} className="underline">Reintentar</button></div>}
      {/* Header + refresh */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <div className="inline-flex items-center gap-2 mb-2 px-3 py-1.5 border border-primary/20 bg-primary/5 text-primary text-xs font-mono uppercase tracking-widest">
            <Activity className="w-3.5 h-3.5" /> Centro de Operaciones
          </div>
          <h2 className="font-heading text-2xl font-bold text-foreground tracking-tight">Visión global de la plataforma</h2>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground/60">
            Actualizado: {lastUpdate.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </span>
        </div>
      </div>

      {/* KPIs principales */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
        <KpiCard icon={Users} label="Total usuarios" value={totalUsuarios} trend="up" loading={loading} />
        <KpiCard icon={Shield} label="Administradores activos" value={users?.admin ?? '—'} accent="orange" loading={loading} />
        <KpiCard icon={UserCheck} label="Instructores activos" value={users?.instructor ?? '—'} accent="blue" loading={loading} />
        <KpiCard icon={GraduationCap} label="Alumnos activos" value={users?.alumno ?? '—'} loading={loading} />
        <KpiCard icon={Radio} label="Conectados ahora" value={conectadosUnicos} trend="up" accent="orange" loading={loading} />
        <KpiCard icon={BookOpen} label="Cursos publicados" value={cursos} accent="blue" loading={loading} />
        <KpiCard icon={ClipboardList} label="Exámenes disponibles" value={examenesDisp} loading={loading} />
        <KpiCard icon={BookOpen} label="Materiales publicados" value={academic?.published_materials ?? '—'} accent="blue" loading={loading} />
      </div>

      {/* KPIs secundarios */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <KpiCard icon={Award} label="Exámenes aprobados" value={aprobados} trend="up" loading={loading} />
        <KpiCard icon={HardDrive} label="Recursos publicados" value={academic ? academic.published_materials + academic.available_exams : '—'} delta="material + exámenes" accent="orange" loading={loading} />
        <KpiCard icon={Server} label="Estado servicios" value={services.length ? `${serviciosOk}/${services.length}` : '—'} trend="up" loading={loading} />
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="glass-card p-5 lg:col-span-1">
          <h3 className="font-heading text-sm font-semibold text-foreground mb-1 flex items-center gap-2">
            <HardDrive className="w-4 h-4 text-primary" /> Contenido académico
          </h3>
          <p className="text-xs text-muted-foreground mb-4">{academic?.total_exams ?? '—'} exámenes · {academic?.total_materials ?? '—'} materiales</p>
          <div className="space-y-2 text-xs text-muted-foreground">
            <p>Alumnos activos: <span className="text-foreground font-mono">{users?.alumno ?? '—'}</span></p>
            <p>Resultados registrados: <span className="text-foreground font-mono">{academic?.exam_results ?? '—'}</span></p>
            <p>Sesiones activas: <span className="text-foreground font-mono">{conectadosUnicos}</span></p>
          </div>
        </div>

        <div className="glass-card p-5 lg:col-span-2">
          <h3 className="font-heading text-sm font-semibold text-foreground mb-1 flex items-center gap-2">
            <Server className="w-4 h-4 text-primary" /> Estado de los servicios
          </h3>
          <p className="text-xs text-muted-foreground mb-4">Datos del endpoint /api/system/status/</p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {services.map((s) => {
              const st = statusUiFor(s.status);
              return (
              <div key={s.name} className="flex items-center justify-between px-3 py-2.5 border border-border-subtle rounded bg-surface-subtle">
                <div className="min-w-0">
                  <p className="text-xs text-foreground truncate">{s.name}</p>
                  <p className="text-[10px] text-muted-foreground/60">{s.value}</p>
                </div>
                <span className="flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-full ${st.dot} animate-pulse`} />
                  <span className={`text-[10px] font-mono uppercase tracking-widest ${st.text}`}>
                    {s.status === 'ok' ? 'OK' : s.status === 'warn' ? 'Aviso' : 'Error'}
                  </span>
                </span>
              </div>
            );})}
          </div>
        </div>
      </div>

      {/* Feed actividad en tiempo real */}
      <div className="glass-card p-5">
        <h3 className="font-heading text-sm font-semibold text-foreground mb-1 flex items-center gap-2">
          <Activity className="w-4 h-4 text-primary" /> Actividad en tiempo real
        </h3>
        <p className="text-xs text-muted-foreground mb-4">Feed cronológico de los últimos eventos de la plataforma</p>
        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="w-6 h-6 text-primary animate-spin" />
          </div>
        ) : (
          <div className="space-y-2">
            {feed.map((e, i) => {
              const Icon = getActivityIcon(e.tipo);
              return (
                <motion.div
                  key={e.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.03 }}
                  className="flex items-center gap-3 px-3 py-2.5 border border-border-subtle rounded hover:bg-surface-subtle transition-colors"
                >
                  <span className={`w-8 h-8 shrink-0 flex items-center justify-center rounded border ${e.ok ? 'border-success-border bg-success-soft text-success' : 'border-warning-border bg-warning-soft text-warning'}`}>
                    <Icon className="w-4 h-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-foreground truncate">
                      <span className="font-medium">{e.accion}</span>
                      {e.detalle ? <span className="text-muted-foreground"> · {e.detalle}</span> : null}
                    </p>
                    <p className="text-[10px] text-muted-foreground/60 truncate">
                      {e.usuario !== '—' ? `${e.usuario} · ` : ''}
                      <span className={`inline-block px-1 border rounded ${rolBadgeClass(e.rol)}`}>{e.rol}</span>
                      {' · IP '}
                      <span className="font-mono">{e.ip}</span>
                    </p>
                  </div>
                  <span className="text-[10px] font-mono text-muted-foreground/50 shrink-0">{formatActivityTimestamp(e.fecha)}</span>
                </motion.div>
              );
            })}
            {feed.length === 0 && <p className="text-xs text-muted-foreground text-center py-6">Sin actividad reciente.</p>}
          </div>
        )}
      </div>
    </div>
  );
}
