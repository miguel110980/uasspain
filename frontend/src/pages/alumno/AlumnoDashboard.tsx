import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { ClipboardList, CheckCircle2, Award, TrendingUp, BookOpen, Clock, Activity, Target, RefreshCw, UserCheck } from 'lucide-react';
import examenesService from '@/services/examenesService';
import materialesService from '@/services/materialesService';
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, Tooltip, CartesianGrid, PieChart, Pie, Cell, ReferenceLine,
} from 'recharts';
import KpiCard from '@/components/admin/KpiCard';
import { compareDatesAsc, compareDatesDesc } from '@/lib/dates';

const CYAN = '#22D3EE';
const ORANGE = '#F97316';
const BLUE = '#60A5FA';
const EMERALD = '#34D399';
const RED = '#F87171';

const CATS = ['A1/A3', 'A2', 'STS'];

/** @param {{ active?: boolean, payload?: any[], label?: string }} props */
const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: any[]; label?: any } = {}) => {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  return (
    <div className="bg-card border border-border-subtle rounded px-4 py-3 text-xs space-y-1 shadow-2xl">
      <p className="font-mono uppercase tracking-widest text-muted-foreground mb-1">{d?.fechaFull || label}</p>
      {payload.map((p) => (
        <p key={p.dataKey} className="text-foreground">
          {p.name}: <span className="text-primary font-bold">{p.value}</span>
        </p>
      ))}
    </div>
  );
};

export default function AlumnoDashboard({ alumnoId, alumnoNombre, assignedInstructorName }) {
  const [resultados, setResultados] = useState([]);
  const [material, setMaterial] = useState([]);
  const [completados, setCompletados] = useState([]);
  const [examenes, setExamenes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [hasData, setHasData] = useState(false);

  useEffect(() => {
    if (!alumnoId) return;
    loadData();
  }, [alumnoId]);

  const loadData = async (manual = false) => {
    if (manual) setRefreshing(true); else setLoading(true);
    try {
      const [res, mat, comp, exa] = await Promise.all([
        examenesService.resultados.filter({ alumno_id: alumnoId }, '-fecha', 200),
        materialesService.materiales.list(),
        materialesService.completados.filter({ alumno_id: alumnoId }),
        examenesService.examenes.list(),
      ]);
      setResultados(res);
      setMaterial(mat);
      setCompletados(comp);
      setExamenes(exa);
      setHasData(true);
      setError('');
    } catch {
      setError('No se pudieron actualizar tus datos. Vuelve a intentarlo.');
    } finally {
      setLoading(false);
      if (manual) setRefreshing(false);
    }
  };

  const realizados = resultados;
  const aprobados = realizados.filter((r) => r.aprobado);
  const suspendidos = realizados.filter((r) => !r.aprobado);
  const notaMedia = realizados.length
    ? parseFloat((realizados.reduce((s, r) => s + (r.nota ?? 0), 0) / realizados.length).toFixed(1))
    : 0;
  const tasaAprobacion = realizados.length
    ? Math.round((aprobados.length / realizados.length) * 100)
    : 0;

  // Mejor categoría
  const porCategoria = CATS.map((cat) => {
    const items = realizados.filter((r) => r.categoria === cat);
    const ap = items.filter((r) => r.aprobado).length;
    const media = items.length
      ? parseFloat((items.reduce((s, r) => s + (r.nota ?? 0), 0) / items.length).toFixed(1))
      : 0;
    return { name: cat, realizados: items.length, aprobados: ap, media };
  });

  // Evolución temporal
  const evolucion = [...realizados]
    .sort((a, b) => compareDatesAsc(a.fecha || a.created_date, b.fecha || b.created_date))
    .map((r, i) => ({
      nota: parseFloat((r.nota ?? 0).toFixed(1)),
      fecha: r.fecha ? new Date(r.fecha).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' }) : `#${i + 1}`,
      fechaFull: r.fecha ? new Date(r.fecha).toLocaleDateString('es-ES') : `Intento ${i + 1}`,
    }));

  // Actividad 7 días
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
      examenes: realizados.filter((r) => (r.fecha || r.created_date || '').slice(0, 10) === key).length,
    };
  });

  const aprobPie = [
    { name: 'Aprobados', value: aprobados.length, color: EMERALD },
    { name: 'Suspendidos', value: Math.max(suspendidos.length, 0), color: RED },
  ];

  const reciente = realizados
    .slice()
    .sort((a, b) => compareDatesDesc(a.fecha || a.created_date, b.fecha || b.created_date))
    .slice(0, 6)
    .map((r) => ({
      titulo: r.examen_nombre || 'Examen',
      sub: `${r.categoria || ''} · ${r.porcentaje ?? '--'}% · ${r.aprobado ? 'Aprobado' : 'Suspendido'}`,
      fecha: r.fecha || r.created_date,
      ok: r.aprobado,
    }));

  if (error && !hasData) return <div role="alert" className="p-3 border border-danger-border bg-danger-soft text-danger text-sm">{error} <button onClick={() => loadData(true)} className="underline">Reintentar</button></div>;

  return (
    <div className="space-y-6">
      {error && <p role="alert" className="text-danger text-sm">{error}</p>}
      {/* Saludo */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <div>
          <div className="inline-flex items-center gap-2 mb-2 px-3 py-1.5 border border-primary/20 bg-primary/5 text-primary text-xs font-mono uppercase tracking-widest">
            <Activity className="w-3.5 h-3.5" /> Panel del alumno
          </div>
          <h2 className="font-heading text-2xl font-bold text-foreground tracking-tight">
            Hola, {alumnoNombre || 'alumno'}
          </h2>
          <p className="text-sm text-muted-foreground mt-1">Resumen de tu progreso y actividad.</p>
        </div>
        <button onClick={() => loadData(true)} className="flex items-center gap-1.5 px-3 py-2 border border-border-subtle text-xs font-mono uppercase tracking-widest text-muted-foreground hover:border-primary/30 hover:text-primary rounded transition-all">
          <RefreshCw className={`w-3.5 h-3.5 ${loading || refreshing ? 'animate-spin' : ''}`} /> Actualizar
        </button>
      </motion.div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
        <KpiCard icon={ClipboardList} label="Exámenes realizados" value={realizados.length} trend="up" loading={loading} />
        <KpiCard icon={CheckCircle2} label="Aprobados" value={aprobados.length} trend="up" accent="blue" loading={loading} />
        <KpiCard icon={Award} label="Nota media" value={notaMedia} delta={`/10`} trend={notaMedia >= 5 ? 'up' : 'down'} accent="orange" loading={loading} />
        <KpiCard icon={Target} label="Tasa aprobación" value={`${tasaAprobacion}%`} trend={tasaAprobacion >= 50 ? 'up' : 'down'} loading={loading} />
        <KpiCard icon={BookOpen} label="Material disponible" value={material.length} accent="blue" loading={loading} />
        <KpiCard icon={CheckCircle2} label="Material completado" value={completados.filter((c) => c.completado).length} accent="blue" loading={loading} />
        <KpiCard icon={ClipboardList} label="Exámenes disponibles" value={examenes.filter((e) => !e.bloqueado).length} accent="orange" loading={loading} />
        <KpiCard icon={TrendingUp} label="Intentos totales" value={realizados.length} loading={loading} />
      </div>

      {/* Instructor asignado */}
      {assignedInstructorName && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="glass-card p-4 flex items-center gap-3">
          <UserCheck className="w-5 h-5 text-primary shrink-0" />
          <div>
            <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-0.5">Tu instructor asignado</p>
            <p className="text-sm text-foreground font-medium">{assignedInstructorName}</p>
          </div>
        </motion.div>
      )}

      {/* Charts fila 1 */}
      <div className="grid lg:grid-cols-3 gap-4">
        <div className="glass-card p-5 lg:col-span-2">
          <h3 className="font-heading text-sm font-semibold text-foreground mb-1">Evolución de notas</h3>
          <p className="text-xs text-muted-foreground mb-4">Tus notas a lo largo del tiempo</p>
          {evolucion.length >= 2 ? (
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={evolucion}>
                <defs>
                  <linearGradient id="gNota" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={CYAN} stopOpacity={0.4} />
                    <stop offset="100%" stopColor={CYAN} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="fecha" tick={{ fill: 'hsl(var(--text-secondary))', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis domain={[0, 10]} tick={{ fill: 'hsl(var(--text-secondary))', fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip content={<CustomTooltip />} />
                <ReferenceLine y={5} stroke={ORANGE} strokeDasharray="4 4" strokeOpacity={0.5} />
                <Area type="monotone" dataKey="nota" stroke={CYAN} strokeWidth={2} fill="url(#gNota)" name="Nota" />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[200px] text-xs text-muted-foreground font-mono">
              Necesitas al menos 2 intentos para ver la evolución
            </div>
          )}
        </div>

        <div className="glass-card p-5">
          <h3 className="font-heading text-sm font-semibold text-foreground mb-1">Aprobación</h3>
          <p className="text-xs text-muted-foreground mb-4">Aprobados vs suspendidos</p>
          {realizados.length > 0 ? (
            <>
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
            </>
          ) : (
            <div className="flex items-center justify-center h-[240px] text-xs text-muted-foreground font-mono">
              Sin datos aún
            </div>
          )}
        </div>
      </div>

      {/* Actividad semanal */}
      <div className="glass-card p-5">
        <h3 className="font-heading text-sm font-semibold text-foreground mb-1">Actividad semanal</h3>
        <p className="text-xs text-muted-foreground mb-4">Exámenes realizados en los últimos 7 días</p>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={actividad}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis dataKey="name" tick={{ fill: 'hsl(var(--text-secondary))', fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis allowDecimals={false} tick={{ fill: 'hsl(var(--text-secondary))', fontSize: 11 }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 6, fontSize: 12 }} />
            <Bar dataKey="examenes" fill={CYAN} radius={[4, 4, 0, 0]} name="Exámenes" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Charts fila 2 */}
      <div className="grid lg:grid-cols-3 gap-4">
        <div className="glass-card p-5 lg:col-span-2">
          <h3 className="font-heading text-sm font-semibold text-foreground mb-1">Resultados por categoría</h3>
          <p className="text-xs text-muted-foreground mb-4">Realizados vs aprobados</p>
          {realizados.length > 0 ? (
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
          ) : (
            <div className="flex items-center justify-center h-[220px] text-xs text-muted-foreground font-mono">
              Sin datos aún
            </div>
          )}
        </div>

        <div className="glass-card p-5">
          <h3 className="font-heading text-sm font-semibold text-foreground mb-1 flex items-center gap-2">
            <Clock className="w-4 h-4 text-primary" /> Actividad reciente
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
