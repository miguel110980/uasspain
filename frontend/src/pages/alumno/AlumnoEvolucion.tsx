import DataLoadNotice from '@/components/ui/DataLoadNotice';
import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { TrendingUp, Loader2 } from 'lucide-react';
import examenesService from '@/services/examenesService';
import { compareDatesAsc } from '@/lib/dates';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';

const GRUPOS = [
  { label: 'Categoría Abierta — A1/A3', cats: ['A1/A3'] },
  { label: 'Categoría Abierta — A2', cats: ['A2'] },
  { label: 'Categoría Específica — STS', cats: ['STS'] },
];

/** @param {{ active?: boolean, payload?: any[], label?: string }} props */
const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: any[]; label?: any } = {}) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-card border border-border-subtle rounded px-4 py-3 text-xs space-y-1 shadow-2xl">
      <p className="font-mono uppercase tracking-widest text-muted-foreground mb-2">{d.fechaFull || label}</p>
      <p className="text-foreground">Nota: <span className="text-primary font-bold">{d.nota}/10</span></p>
    </div>
  );
};

function GraficaCategoria({ categoria, resultados }) {
  const sorted = [...resultados].sort((a, b) => compareDatesAsc(a.fecha, b.fecha));
  const chartData = sorted.map((r, i) => ({
    nota: parseFloat((r.nota ?? 0).toFixed(1)),
    fecha: r.fecha ? new Date(r.fecha).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' }) : `#${i + 1}`,
    fechaFull: r.fecha ? new Date(r.fecha).toLocaleDateString('es-ES') : `Intento ${i + 1}`,
  }));
  const media = resultados.length
    ? parseFloat((resultados.reduce((s, r) => s + (r.nota ?? 0), 0) / resultados.length).toFixed(1))
    : 0;

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="glass-card p-6 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-heading text-lg font-bold text-foreground">{categoria}</h3>
        <div className="text-right">
          <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Media</p>
          <p className="font-heading text-xl font-bold text-primary">{media}/10</p>
        </div>
      </div>
      {chartData.length >= 2 ? (
        <ResponsiveContainer width="100%" height={200}>
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
            />
          </LineChart>
        </ResponsiveContainer>
      ) : (
        <div className="flex items-center justify-center h-24 text-xs text-muted-foreground font-mono">
          Necesitas al menos 2 intentos para ver la evolución
        </div>
      )}
    </motion.div>
  );
}

export default function AlumnoEvolucion({ alumnoId }) {
  const [resultados, setResultados] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

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

  const porGrupo = GRUPOS.map((grupo) => ({
    label: grupo.label,
    items: resultados.filter((r) => grupo.cats.includes(r.categoria)),
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
      <div className="mb-8">
        <div className="inline-flex items-center gap-2 mb-3 px-3 py-1.5 border border-primary/20 bg-primary/5 text-primary text-xs font-mono uppercase tracking-widest">
          <TrendingUp className="w-3.5 h-3.5" /> Evolución
        </div>
        <h2 className="font-heading text-2xl font-bold text-foreground tracking-tight">Evolución de Resultados</h2>
        <p className="text-sm text-muted-foreground mt-1">Progreso de tus notas a lo largo del tiempo.</p>
      </div>

      {porGrupo.length === 0 ? (
        <div className="text-center py-20 glass-card">
          <TrendingUp className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground text-sm">Todavía no has realizado ningún examen.</p>
        </div>
      ) : (
        porGrupo.map(({ label, items }) => (
          <GraficaCategoria key={label} categoria={label} resultados={items} />
        ))
      )}
    </motion.div>
  );
}
