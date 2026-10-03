import React, { useEffect, useState, useRef } from 'react';
import { motion } from 'framer-motion';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  PieChart, Pie, Cell, AreaChart, Area, LineChart, Line,
} from 'recharts';
import { TrendingUp, BarChart2, Users, Award, Loader2 } from 'lucide-react';
import authService from '@/services/authService';
import examenesService from '@/services/examenesService';
import materialesService from '@/services/materialesService';
import conexionesService from '@/services/conexionesService';
import { useRefreshableLoad } from '@/hooks/useRefreshableLoad';
import { hasRole } from '@/lib/roles';

const CYAN = '#22D3EE';
const ORANGE = '#F97316';
const BLUE = '#60A5FA';
const EMERALD = '#34D399';

const MONTH_NAMES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

export default function AdminEstadisticas() {
  const [data, setData] = useState(null);
  const { loading, isBusy, lastUpdate, runLoad } = useRefreshableLoad();
  const hasData = useRef(false);

  const load = (manual = false) => runLoad(async () => {
    const [profiles, resultados, examenes, material, registroConexion] = await Promise.all([
      authService.listProfiles('-created_date', 1000),
      examenesService.resultados.list('-created_date', 1000),
      examenesService.examenes.list(),
      materialesService.materiales.list(),
      conexionesService.registros.list('-created_date', 1000),
    ]);
    setData({ profiles, resultados, examenes, material, registroConexion });
    hasData.current = true;
  }, { manual, silent: !manual && hasData.current });

  useEffect(() => {
    load();
    const timer = setInterval(() => load(false), 30000);
    return () => clearInterval(timer);
  }, []);

  const profiles = data?.profiles || [];
  const resultados = data?.resultados || [];
  const registro = data?.registroConexion || [];

  // Usuarios por mes (últimos 12)
  const now = new Date();
  const meses = Array.from({ length: 12 }).map((_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (11 - i), 1);
    return { key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, name: MONTH_NAMES[d.getMonth()] };
  });
  const usuariosPorMes = meses.map((m) => {
    const enMes = profiles.filter((p) => (p.created_date || '').slice(0, 7) === m.key);
    return {
      name: m.name,
      total: enMes.length,
      alumnos: enMes.filter((p) => hasRole(p, 'alumno')).length,
      instructores: enMes.filter((p) => hasRole(p, 'instructor')).length,
    };
  });

  // Distribución por rol
  const rolesPie = [
    { name: 'Alumnos', value: profiles.filter((p) => hasRole(p, 'alumno')).length, color: BLUE },
    { name: 'Instructores', value: profiles.filter((p) => hasRole(p, 'instructor')).length, color: CYAN },
    { name: 'Admins', value: profiles.filter((p) => hasRole(p, 'admin')).length, color: ORANGE },
  ];

  // Exámenes realizados por categoría
  const porCategoria = ['A1/A3', 'A2', 'STS'].map((cat) => ({
    name: cat,
    realizados: resultados.filter((r) => r.categoria === cat).length,
    aprobados: resultados.filter((r) => r.categoria === cat && r.aprobado).length,
  }));

  // Certificados emitidos por mes
  const certPorMes = meses.map((m) => ({
    name: m.name,
    certificados: resultados.filter((r) => r.aprobado && (r.fecha || r.created_date || '').slice(0, 7) === m.key).length,
  }));

  // Actividad diaria (sesiones por día, últimos 14)
  const dias = Array.from({ length: 14 }).map((_, i) => {
    const d = new Date(now);
    d.setDate(now.getDate() - (13 - i));
    return d;
  });
  const actividadDiaria = dias.map((d) => {
    const key = d.toISOString().split('T')[0];
    return {
      name: d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' }),
      sesiones: registro.filter((r) => (r.fecha_hora || '').slice(0, 10) === key).length,
      examenes: resultados.filter((r) => (r.fecha || r.created_date || '').slice(0, 10) === key).length,
    };
  });

  const TT = { background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 6, fontSize: 12, color: 'hsl(var(--text-primary))' };

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-heading text-xl font-bold text-foreground flex items-center gap-2">
            <BarChart2 className="w-5 h-5 text-primary" /> Estadísticas globales
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            Métricas de uso y actividad · Actualizado {lastUpdate.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>
      </div>

      {/* Usuarios por mes */}
      <div className="glass-card p-5">
        <h3 className="font-heading text-sm font-semibold text-foreground mb-1 flex items-center gap-2">
          <Users className="w-4 h-4 text-primary" /> Usuarios registrados por mes
        </h3>
        <p className="text-xs text-muted-foreground mb-4">Nuevos alumnos e instructores (últimos 12 meses)</p>
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={usuariosPorMes}>
            <defs>
              <linearGradient id="gAlumnos" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={BLUE} stopOpacity={0.4} />
                <stop offset="100%" stopColor={BLUE} stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gInst" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={CYAN} stopOpacity={0.4} />
                <stop offset="100%" stopColor={CYAN} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis dataKey="name" tick={{ fill: 'hsl(var(--text-secondary))', fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: 'hsl(var(--text-secondary))', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
            <Tooltip contentStyle={TT} />
            <Area type="monotone" dataKey="alumnos" stroke={BLUE} strokeWidth={2} fill="url(#gAlumnos)" name="Alumnos" />
            <Area type="monotone" dataKey="instructores" stroke={CYAN} strokeWidth={2} fill="url(#gInst)" name="Instructores" />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* Distribución por rol */}
        <div className="glass-card p-5">
          <h3 className="font-heading text-sm font-semibold text-foreground mb-1">Distribución por rol</h3>
          <p className="text-xs text-muted-foreground mb-4">Usuarios por rol; una persona puede pertenecer a varios roles.</p>
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie data={rolesPie} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={3}>
                {rolesPie.map((e) => <Cell key={e.name} fill={e.color} />)}
              </Pie>
              <Tooltip contentStyle={TT} />
            </PieChart>
          </ResponsiveContainer>
          <div className="flex justify-center gap-4 mt-2 flex-wrap">
            {rolesPie.map((e) => (
              <span key={e.name} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: e.color }} /> {e.name}: {e.value}
              </span>
            ))}
          </div>
        </div>

        {/* Exámenes por categoría */}
        <div className="glass-card p-5">
          <h3 className="font-heading text-sm font-semibold text-foreground mb-1">Exámenes por categoría</h3>
          <p className="text-xs text-muted-foreground mb-4">Realizados vs aprobados</p>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={porCategoria}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="name" tick={{ fill: 'hsl(var(--text-secondary))', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: 'hsl(var(--text-secondary))', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip contentStyle={TT} />
              <Bar dataKey="realizados" fill={BLUE} radius={[4, 4, 0, 0]} name="Realizados" />
              <Bar dataKey="aprobados" fill={CYAN} radius={[4, 4, 0, 0]} name="Aprobados" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Actividad diaria */}
      <div className="glass-card p-5">
        <h3 className="font-heading text-sm font-semibold text-foreground mb-1 flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-primary" /> Actividad diaria
        </h3>
        <p className="text-xs text-muted-foreground mb-4">Sesiones y exámenes por día (últimos 14 días)</p>
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={actividadDiaria}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis dataKey="name" tick={{ fill: 'hsl(var(--text-secondary))', fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: 'hsl(var(--text-secondary))', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
            <Tooltip contentStyle={TT} />
            <Line type="monotone" dataKey="sesiones" stroke={CYAN} strokeWidth={2} dot={false} name="Sesiones" />
            <Line type="monotone" dataKey="examenes" stroke={ORANGE} strokeWidth={2} dot={false} name="Exámenes" />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Certificados por mes */}
      <div className="glass-card p-5">
        <h3 className="font-heading text-sm font-semibold text-foreground mb-1 flex items-center gap-2">
          <Award className="w-4 h-4 text-primary" /> Exámenes aprobados por mes
        </h3>
        <p className="text-xs text-muted-foreground mb-4">Exámenes aprobados (últimos 12 meses)</p>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={certPorMes}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis dataKey="name" tick={{ fill: 'hsl(var(--text-secondary))', fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: 'hsl(var(--text-secondary))', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
            <Tooltip contentStyle={TT} />
            <Bar dataKey="certificados" fill={EMERALD} radius={[4, 4, 0, 0]} name="Exámenes aprobados" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </motion.div>
  );
}
