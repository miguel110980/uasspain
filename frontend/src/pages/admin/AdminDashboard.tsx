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
import KpiCard from '@/components/admin/KpiCard';
import { profileHasAdmin, profileHasInstructor } from '@/lib/roles';
import { buildActivityFeed, formatActivityTimestamp, rolBadgeClass } from '@/lib/adminActivity';
import { getActivityIcon } from '@/lib/adminActivityIcons';
import { databaseConnected, statusUiFor, websocketServiceStatus } from '@/lib/systemStatus';

function buildServices(status) {
  if (!status) return [];
  const dbOk = databaseConnected(status);
  const smtp = status.smtp || {};
  const ws = websocketServiceStatus(status);
  return [
    { name: 'API REST', status: dbOk ? 'ok' : 'err', value: dbOk ? 'Online' : 'Degradado' },
    {
      name: 'Redis / WS',
      status: ws.status,
      value: ws.value,
    },
    { name: 'SMTP', status: smtp.configured ? 'ok' : 'warn', value: smtp.configured ? 'Configurado' : 'Sin credenciales' },
    { name: 'Modo', status: status.platform?.production ? 'ok' : (status.platform?.debug ? 'warn' : 'ok'), value: status.platform?.production ? 'Producción' : 'Desarrollo' },
  ];
}

export default function AdminDashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState(new Date());
  const timer = useRef(/** @type {ReturnType<typeof setInterval> | null} */ (null));

  const load = async () => {
    try {
      const [profiles, resultados, examenes, material, conexiones, registroConexion, systemStatus] = await Promise.all([
        authService.listProfiles('-created_date', 500),
        examenesService.resultados.list('-created_date', 500),
        examenesService.examenes.list(),
        materialesService.materiales.list(),
        conexionesService.conexiones.list('-created_date', 100),
        conexionesService.registros.list('-created_date', 500),
        authService.getSystemStatus().catch(() => null),
      ]);
      setData({ profiles, resultados, examenes, material, conexiones, registroConexion, systemStatus });
    } catch {
    } finally {
      setLoading(false);
      setLastUpdate(new Date());
    }
  };

  useEffect(() => {
    load();
    timer.current = setInterval(() => load(), 30000);
    return () => {
      if (timer.current != null) clearInterval(timer.current);
    };
  }, []);

  const profiles = data?.profiles || [];
  const resultados = data?.resultados || [];
  const examenes = data?.examenes || [];
  const material = data?.material || [];
  const registro = data?.registroConexion || [];

  const totalUsuarios = profiles.length;
  const admins = profiles.filter((p) => profileHasAdmin(p) && p.status === 'activo');
  const instructores = profiles.filter((p) => profileHasInstructor(p) && p.status === 'activo');
  const alumnos = profiles.filter((p) => !profileHasAdmin(p) && !profileHasInstructor(p) && p.status === 'activo');
  const conectados = registro.filter((r) => r.estado_sesion === 'activa');
  const conectadosUnicos = new Set(conectados.map((r) => r.usuario || r.email).filter(Boolean)).size;
  const cursos = new Set(examenes.map((e) => e.categoria).filter(Boolean)).size;
  const examenesDisp = examenes.filter((e) => !e.bloqueado).length;
  const certificados = resultados.filter((r) => r.aprobado).length;
  const systemStatus = data?.systemStatus;
  const services = buildServices(systemStatus);
  const serviciosOk = services.filter((s) => s.status === 'ok').length;

  const feed = data ? buildActivityFeed(data).slice(0, 9) : [];

  return (
    <div className="space-y-6">
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
        <KpiCard icon={Shield} label="Administradores activos" value={admins.length} accent="orange" loading={loading} />
        <KpiCard icon={UserCheck} label="Instructores activos" value={instructores.length} accent="blue" loading={loading} />
        <KpiCard icon={GraduationCap} label="Alumnos activos" value={alumnos.length} loading={loading} />
        <KpiCard icon={Radio} label="Conectados ahora" value={conectadosUnicos} trend="up" accent="orange" loading={loading} />
        <KpiCard icon={BookOpen} label="Cursos publicados" value={cursos} accent="blue" loading={loading} />
        <KpiCard icon={ClipboardList} label="Exámenes disponibles" value={examenesDisp} loading={loading} />
        <KpiCard icon={BookOpen} label="Materiales publicados" value={material.length} accent="blue" loading={loading} />
      </div>

      {/* KPIs secundarios */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <KpiCard icon={Award} label="Certificados emitidos" value={certificados} trend="up" loading={loading} />
        <KpiCard icon={HardDrive} label="Recursos publicados" value={material.length + examenes.length} delta="material + exámenes" accent="orange" loading={loading} />
        <KpiCard icon={Server} label="Estado servicios" value={services.length ? `${serviciosOk}/${services.length}` : '—'} trend="up" loading={loading} />
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="glass-card p-5 lg:col-span-1">
          <h3 className="font-heading text-sm font-semibold text-foreground mb-1 flex items-center gap-2">
            <HardDrive className="w-4 h-4 text-primary" /> Contenido académico
          </h3>
          <p className="text-xs text-muted-foreground mb-4">{examenes.length} exámenes · {material.length} materiales</p>
          <div className="space-y-2 text-xs text-muted-foreground">
            <p>Alumnos activos: <span className="text-foreground font-mono">{alumnos.length}</span></p>
            <p>Resultados registrados: <span className="text-foreground font-mono">{resultados.length}</span></p>
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