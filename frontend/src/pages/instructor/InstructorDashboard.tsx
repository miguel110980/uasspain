import React from 'react';
import {
  Users, ClipboardList, CheckCircle2, BookOpen, MessageCircle, Wifi,
  Activity, Award,
} from 'lucide-react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  PieChart, Pie, Cell, AreaChart, Area,
} from 'recharts';
import KpiCard from '@/components/admin/KpiCard';
import { compareDatesDesc } from '@/lib/dates';

const CYAN = '#22D3EE';
const ORANGE = '#F97316';
const BLUE = '#60A5FA';
const EMERALD = '#34D399';
const RED = '#F87171';

export default function InstructorDashboard({ profiles, resultados, examenes, material, mensajes, conexiones, loading }) {
  const alumnos = profiles.filter((p) => (p.role || 'alumno') === 'alumno');
  const pendientes = alumnos.filter((p) => p.status === 'pendiente');
  const activos = alumnos.filter((p) => p.status === 'activo');
  const realizados = resultados;
  const aprobados = realizados.filter((r) => r.aprobado);

  const porCategoria = ['A1/A3', 'A2', 'STS'].map((cat) => ({
    name: cat,
    realizados: realizados.filter((r) => r.categoria === cat).length,
    aprobados: realizados.filter((r) => r.categoria === cat && r.aprobado).length,
  }));

  const aprobPie = [
    { name: 'Aprobados', value: aprobados.length, color: EMERALD },
    { name: 'Suspendidos', value: Math.max(realizados.length - aprobados.length, 0), color: RED },
  ];

  const today = new Date();
  const dias = Array.from({ length: 7 }).map((_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() - (6 - i));
    return d;
  });
  const actividad = dias.map((d) => {
    const key = d.toISOString().split('T')[0];
    return {
      name: d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' }),
      examenes: realizados.filter((r) => (r.fecha || '').slice(0, 10) === key).length,
      altas: profiles.filter((p) => (p.created_date || '').slice(0, 10) === key).length,
    };
  });

  const reciente = [
    ...realizados.slice(0, 6).map((r) => ({
      titulo: `${r.examen_nombre || 'Examen'} — ${r.aprobado ? 'Aprobado' : 'Suspendido'}`,
      sub: `${r.categoria || ''} · ${r.porcentaje ?? '--'}%`,
      fecha: r.fecha || r.created_date,
      ok: r.aprobado,
    })),
    ...profiles.slice(0, 6).map((p) => ({
      titulo: `${p.nombre} ${p.apellidos}`,
      sub: `Alumno · ${p.status}`,
      fecha: p.created_date,
      ok: p.status === 'activo',
    })),
  ]
    .sort((a, b) => compareDatesDesc(a.fecha, b.fecha))
    .slice(0, 8);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <div className="inline-flex items-center gap-2 mb-2 px-3 py-1.5 border border-primary/20 bg-primary/5 text-primary text-xs font-mono uppercase tracking-widest">
            <Activity className="w-3.5 h-3.5" /> Panel del instructor
          </div>
          <h2 className="font-heading text-2xl font-bold text-foreground tracking-tight">Resumen general</h2>
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
        <KpiCard icon={Users} label="Alumnos" value={alumnos.length} delta={pendientes.length ? `${pendientes.length} pend.` : null} trend="up" loading={loading} />
        <KpiCard icon={CheckCircle2} label="Alumnos activos" value={activos.length} trend="up" accent="blue" loading={loading} />
        <KpiCard icon={ClipboardList} label="Exámenes realizados" value={realizados.length} trend="up" accent="orange" loading={loading} />
        <KpiCard icon={Award} label="Exámenes aprobados" value={aprobados.length} trend="up" loading={loading} />
        <KpiCard icon={BookOpen} label="Material formativo" value={material.length} accent="blue" loading={loading} />
        <KpiCard icon={ClipboardList} label="Exámenes config." value={examenes.length} accent="orange" loading={loading} />
        <KpiCard icon={MessageCircle} label="Mensajes" value={mensajes.length} accent="blue" loading={loading} />
        <KpiCard icon={Wifi} label="Conexiones" value={conexiones.length} loading={loading} />
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="glass-card p-5 lg:col-span-2">
          <h3 className="font-heading text-sm font-semibold text-foreground mb-1">Actividad (7 días)</h3>
          <p className="text-xs text-muted-foreground mb-4">Exámenes realizados y altas por día</p>
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={actividad}>
              <defs>
                <linearGradient id="gExamI" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={CYAN} stopOpacity={0.4} />
                  <stop offset="100%" stopColor={CYAN} stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gAltasI" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={ORANGE} stopOpacity={0.4} />
                  <stop offset="100%" stopColor={ORANGE} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="name" tick={{ fill: 'hsl(var(--text-secondary))', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: 'hsl(var(--text-secondary))', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 6, fontSize: 12 }} />
              <Area type="monotone" dataKey="examenes" stroke={CYAN} strokeWidth={2} fill="url(#gExamI)" name="Exámenes" />
              <Area type="monotone" dataKey="altas" stroke={ORANGE} strokeWidth={2} fill="url(#gAltasI)" name="Altas" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="glass-card p-5">
          <h3 className="font-heading text-sm font-semibold text-foreground mb-1">Aprobación</h3>
          <p className="text-xs text-muted-foreground mb-4">Aprobados vs suspendidos</p>
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie data={aprobPie} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={3}>
                {aprobPie.map((e) => <Cell key={e.name} fill={e.color} />)}
              </Pie>
              <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 6, fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
          <div className="flex justify-center gap-4 mt-2">
            {aprobPie.map((e) => (
              <span key={e.name} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: e.color }} /> {e.name}: {e.value}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="glass-card p-5 lg:col-span-2">
          <h3 className="font-heading text-sm font-semibold text-foreground mb-1">Resultados por categoría</h3>
          <p className="text-xs text-muted-foreground mb-4">Realizados vs aprobados</p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={porCategoria}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="name" tick={{ fill: 'hsl(var(--text-secondary))', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: 'hsl(var(--text-secondary))', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 6, fontSize: 12 }} />
              <Bar dataKey="realizados" fill={BLUE} radius={[4, 4, 0, 0]} name="Realizados" />
              <Bar dataKey="aprobados" fill={CYAN} radius={[4, 4, 0, 0]} name="Aprobados" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="glass-card p-5">
          <h3 className="font-heading text-sm font-semibold text-foreground mb-1 flex items-center gap-2">
            <Activity className="w-4 h-4 text-primary" /> Actividad reciente
          </h3>
          <div className="mt-4 space-y-3">
            {reciente.map((r, i) => (
              <div key={i} className="flex items-start gap-3">
                <span className={`mt-1 w-2 h-2 rounded-full shrink-0 ${r.ok ? 'bg-success' : 'bg-warning'}`} />
                <div className="min-w-0">
                  <p className="text-xs text-foreground truncate">{r.titulo}</p>
                  <p className="text-[10px] text-muted-foreground/70">{r.sub}</p>
                </div>
              </div>
            ))}
            {reciente.length === 0 && <p className="text-xs text-muted-foreground">Sin actividad reciente.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}