import DataLoadNotice from '@/components/ui/DataLoadNotice';
import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { BarChart2, Loader2, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import examenesService from '@/services/examenesService';
import { compareDatesAsc } from '@/lib/dates';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';

// Mismos grupos que AlumnoExamenes
const GRUPOS = [
  { label: 'Categoría Abierta — A1/A3', filtro: 'A1/A3', cats: ['A1/A3'] },
  { label: 'Categoría Abierta — A2',    filtro: 'A2',    cats: ['A2'] },
  { label: 'Categoría Específica — STS', filtro: 'STS',  cats: ['STS'] },
];
const FILTROS = ['Todos', 'A1/A3', 'A2', 'STS'];

const formatTiempo = (secs) => {
  if (!secs) return '—';
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}m ${s}s`;
};

/** @param {{ active?: boolean, payload?: any[], label?: string }} props */
const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: any[]; label?: any } = {}) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-card border border-border-subtle rounded px-4 py-3 text-xs space-y-1 shadow-2xl">
      <p className="font-mono uppercase tracking-widest text-muted-foreground mb-2">{d.fechaFull || label}</p>
      <p className="text-foreground">Nota: <span className="text-primary font-bold">{d.nota}/10</span></p>
      <p className="text-foreground">Aciertos: <span className="text-primary font-bold">{d.aciertos ?? '—'}</span></p>
      <p className="text-foreground">Errores: <span className="text-danger font-bold">{d.errores ?? '—'}</span></p>
      <p className="text-foreground">Porcentaje: <span className="font-bold">{d.porcentaje ?? '—'}%</span></p>
      {d.tiempo_empleado != null && (
        <p className="text-foreground">Tiempo: <span className="font-bold">{formatTiempo(d.tiempo_empleado)}</span></p>
      )}
    </div>
  );
};

function GraficaExamen({ resultados, categoria }) {
  const sorted = [...resultados].sort((a, b) => compareDatesAsc(a.fecha, b.fecha));
  const chartData = sorted.map((r, i) => ({
    idx: i + 1,
    nota: parseFloat((r.nota ?? 0).toFixed(1)),
    aciertos: r.aciertos,
    errores: r.errores,
    porcentaje: r.porcentaje,
    tiempo_empleado: r.tiempo_empleado,
    fecha: r.fecha ? new Date(r.fecha).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' }) : `#${i + 1}`,
    fechaFull: r.fecha ? new Date(r.fecha).toLocaleDateString('es-ES') : `Intento ${i + 1}`,
  }));
  const media = resultados.length
    ? parseFloat((resultados.reduce((s, r) => s + (r.nota ?? 0), 0) / resultados.length).toFixed(1))
    : 0;
  const tendencia = chartData.length >= 2
    ? parseFloat((chartData[chartData.length - 1].nota - chartData[0].nota).toFixed(1))
    : 0;
  const TrendIcon = tendencia > 0 ? TrendingUp : tendencia < 0 ? TrendingDown : Minus;
  const trendColor = tendencia > 0 ? 'text-success' : tendencia < 0 ? 'text-danger' : 'text-muted-foreground';

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="glass-card p-6 mb-6"
    >
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
        <div>
          <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-1">Categoría</p>
          <h3 className="font-heading text-lg font-bold text-foreground">{categoria}</h3>
        </div>
        <div className="flex flex-wrap items-center gap-3 sm:gap-6 text-right">
          <div>
            <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Media</p>
            <p className="font-heading text-xl font-bold text-primary">{media}/10</p>
          </div>
          <div>
            <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Intentos</p>
            <p className="font-heading text-xl font-bold text-foreground">{resultados.length}</p>
          </div>
          <div>
            <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Tendencia</p>
            <div className={`flex items-center justify-end gap-1 mt-0.5 ${trendColor}`}>
              <TrendIcon className="w-4 h-4" />
              <span className="font-heading text-sm font-bold">
                {tendencia > 0 ? '+' : ''}{tendencia}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Gráfica */}
      {chartData.length >= 2 ? (
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="fecha" tick={{ fontSize: 10, fill: 'hsl(var(--text-secondary))' }} />
            <YAxis domain={[0, 10]} tick={{ fontSize: 10, fill: 'hsl(var(--text-secondary))' }} />
            <Tooltip content={<CustomTooltip />} />
            <ReferenceLine y={media} stroke="hsl(186 100% 50% / 0.3)" strokeDasharray="4 4" />
            <Line
              type="monotone"
              dataKey="nota"
              stroke="hsl(186 100% 50%)"
              strokeWidth={2}
              dot={{ fill: 'hsl(186 100% 50%)', r: 4, strokeWidth: 0 }}
              activeDot={{ r: 6 }}
              isAnimationActive={true}
              animationDuration={800}
            />
          </LineChart>
        </ResponsiveContainer>
      ) : chartData.length === 1 ? (
        <div className="flex items-center justify-center h-24 text-xs text-muted-foreground font-mono">
          Necesitas al menos 2 intentos para ver la evolución
        </div>
      ) : null}

      {/* Historial */}
      <div className="mt-4 overflow-x-auto" tabIndex={0} role="region" aria-label={`Historial de resultados de ${categoria}`}>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border-subtle">
              {['#', 'Fecha', 'Modalidad', 'Aciertos', 'Errores', 'Nota', 'Estado'].map((h) => (
                <th key={h} className="px-3 py-2 text-left font-mono uppercase tracking-widest text-muted-foreground whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, i) => (
              <tr key={r.id || i} className={`border-b border-border-subtle ${i % 2 === 1 ? 'bg-surface-subtle' : ''}`}>
                <td className="px-3 py-2 text-muted-foreground">#{i + 1}</td>
                <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                  {r.fecha ? new Date(r.fecha).toLocaleDateString('es-ES') : '—'}
                </td>
                <td className="px-3 py-2 text-muted-foreground capitalize">{r.modalidad || '—'}</td>
                <td className="px-3 py-2 text-primary font-bold">{r.aciertos ?? '—'}</td>
                <td className="px-3 py-2 text-danger font-bold">{r.errores ?? '—'}</td>
                <td className="px-3 py-2 font-bold whitespace-nowrap">
                  <span className={r.aprobado ? 'text-primary' : 'text-danger'}>
                    {(r.nota ?? 0).toFixed(1)}/10
                  </span>
                </td>
                <td className="px-3 py-2">
                  <span className={`px-2 py-0.5 border text-xs ${r.aprobado ? 'text-primary bg-primary/10 border-primary/20' : 'text-danger bg-danger-soft border-danger-border'}`}>
                    {r.aprobado ? 'Aprobado' : 'Suspendido'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </motion.div>
  );
}

export default function AlumnoResultados({ alumnoId }) {
  const [resultados, setResultados] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [filtro, setFiltro] = useState('Todos');

  useEffect(() => {
    loadData();
  }, [alumnoId]);

  const loadData = async () => {
    if (!alumnoId) {
      setResultados([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError('');
    try {
      const data = await examenesService.resultados.filter({ alumno_id: alumnoId }, '-fecha', 200);
      setResultados(data);
    } catch {
      setLoadError('No se pudieron cargar los datos. Vuelve a intentarlo.');
      setResultados([]);
    } finally {
      setLoading(false);
    }
  };

  // Mapear filtro a cats reales
  const getCatsForFiltro = (f) => {
    if (f === 'Todos') return ['A1/A3', 'A2', 'STS'];
    const g = GRUPOS.find((gr) => gr.filtro === f);
    return g ? g.cats : [];
  };

  const teoricos = resultados.filter((r) => getCatsForFiltro(filtro).includes(r.categoria));

  const media = teoricos.length ? (teoricos.reduce((s, r) => s + (r.nota ?? 0), 0) / teoricos.length).toFixed(1) : '—';
  const aprobados = teoricos.filter((r) => r.aprobado).length;
  const suspendidos = teoricos.filter((r) => !r.aprobado).length;

  const porGrupo = GRUPOS.map((grupo) => ({
    label: grupo.label,
    items: (filtro === 'Todos' || filtro === grupo.filtro)
      ? resultados.filter((r) => grupo.cats.includes(r.categoria))
      : [],
  })).filter(({ items }) => items.length > 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
      <DataLoadNotice error={loadError} retry={loadData} />
      {/* Header */}
      <div className="mb-8">
        <div className="inline-flex items-center gap-2 mb-3 px-3 py-1.5 border border-primary/20 bg-primary/5 text-primary text-xs font-mono uppercase tracking-widest">
          <BarChart2 className="w-3.5 h-3.5" /> Resultados
        </div>
        <h2 className="font-heading text-2xl font-bold text-foreground tracking-tight">Panel de Resultados</h2>
        <p className="text-sm text-muted-foreground mt-1">Evolución independiente por tipo de examen.</p>
      </div>

      {resultados.length === 0 ? (
        <div className="text-center py-20 glass-card">
          <BarChart2 className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground text-sm">Todavía no has realizado ningún examen.</p>
        </div>
      ) : (
        <>
          {/* Filtros */}
          <div className="flex gap-2 flex-wrap mb-8">
            {FILTROS.map((f) => (
              <button
                key={f}
                onClick={() => setFiltro(f)}
                className={`px-4 py-2 text-xs font-mono uppercase tracking-widest border transition-all duration-200 ${
                  filtro === f
                    ? 'border-primary/50 bg-primary/10 text-primary'
                    : 'border-border-subtle text-muted-foreground hover:border-primary/30 hover:text-primary'
                }`}
              >
                {f}
              </button>
            ))}
          </div>

          {/* Stats globales */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            {[
              { label: 'Media global', value: media !== '—' ? `${media}/10` : '—' },
              { label: 'Exámenes realizados', value: teoricos.length },
              { label: 'Aprobados', value: aprobados },
              { label: 'Suspendidos', value: suspendidos },
            ].map(({ label, value }) => (
              <div key={label} className="glass-card p-5">
                <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-2">{label}</p>
                <p className="font-heading text-2xl font-bold text-primary">{value}</p>
              </div>
            ))}
          </div>

          {/* Gráficas por grupo */}
          {porGrupo.map(({ label, items }) => (
            <GraficaExamen key={label} categoria={label} resultados={items} />
          ))}
        </>
      )}
    </motion.div>
  );
}
