import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Loader2, TrendingUp } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import examenesService from '@/services/examenesService';
import materialesService from '@/services/materialesService';
import authService from '@/services/authService';

const CATEGORIAS = ['A1/A3', 'A2', 'STS'];
const COLORS = ['#00e5ff', '#ff4d1a'];

export default function InstructorEstadisticas() {
  const [resultados, setResultados] = useState([]);
  const [materiales, setMateriales] = useState([]);
  const [completados, setCompletados] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [resultadosData, materialesData, completadosData, profilesData] = await Promise.all([
        examenesService.resultados.list('-fecha', 1000),
        materialesService.materiales.list(),
        materialesService.completados.list('-created_date', 1000),
        authService.filterProfiles({ role: 'alumno', status: 'activo' }, '-created_date', 500),
      ]);
      setResultados(resultadosData);
      setMateriales(materialesData);
      setCompletados(completadosData);
      setProfiles(profilesData);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  const totalMateriales = materiales.length;
  const progresoPromedio = profiles.length && totalMateriales
    ? Math.round(
        (profiles.reduce((sum, p) => {
          const completadosAlumno = completados.filter((c) => c.alumno_id === p.id && c.completado).length;
          return sum + completadosAlumno / totalMateriales;
        }, 0) / profiles.length) * 100
      )
    : 0;

  const aprobados = resultados.filter((r) => r.aprobado).length;
  const suspendidos = resultados.length - aprobados;
  const tasaAprobacion = resultados.length ? Math.round((aprobados / resultados.length) * 100) : 0;

  const dataAprobacionPie = [
    { name: 'Aprobados', value: aprobados },
    { name: 'Suspendidos', value: suspendidos },
  ];

  const dataPorCategoria = CATEGORIAS.map((cat) => {
    const resCat = resultados.filter((r) => r.categoria === cat);
    const aprobadosCat = resCat.filter((r) => r.aprobado).length;
    return {
      categoria: cat,
      tasa: resCat.length ? Math.round((aprobadosCat / resCat.length) * 100) : 0,
      total: resCat.length,
    };
  });

  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="space-y-8">
      {/* KPIs */}
      <div className="grid sm:grid-cols-3 gap-4">
        <div className="glass-card p-6">
          <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-2">Progreso Promedio</p>
          <p className="font-heading text-3xl font-bold text-primary">{progresoPromedio}%</p>
          <p className="text-xs text-muted-foreground mt-1">Material completado por alumno</p>
        </div>
        <div className="glass-card p-6">
          <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-2">Tasa de Aprobación</p>
          <p className="font-heading text-3xl font-bold text-primary">{tasaAprobacion}%</p>
          <p className="text-xs text-muted-foreground mt-1">{aprobados} de {resultados.length} exámenes</p>
        </div>
        <div className="glass-card p-6">
          <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-2">Alumnos Activos</p>
          <p className="font-heading text-3xl font-bold text-primary">{profiles.length}</p>
          <p className="text-xs text-muted-foreground mt-1">Alumnos con cuenta activa</p>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Tasa de aprobación por categoría */}
        <div className="glass-card p-6">
          <h3 className="font-heading text-base font-bold text-foreground mb-4 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-primary" />
            Tasa de Aprobación por Categoría
          </h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={dataPorCategoria}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="categoria" tick={{ fill: 'hsl(var(--text-secondary))', fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: 'hsl(var(--text-secondary))', fontSize: 12 }} unit="%" axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 6, fontSize: 12, color: 'hsl(var(--text-primary))' }}
              />
              <Bar dataKey="tasa" fill="#00e5ff" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Aprobados vs suspendidos */}
        <div className="glass-card p-6">
          <h3 className="font-heading text-base font-bold text-foreground mb-4">Aprobados vs Suspendidos</h3>
          {resultados.length === 0 ? (
            <div className="flex items-center justify-center h-[280px] text-sm text-muted-foreground">
              No hay resultados de exámenes aún.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie data={dataAprobacionPie} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label>
                  {dataAprobacionPie.map((entry, index) => (
                    <Cell key={entry.name} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 6, fontSize: 12, color: 'hsl(var(--text-primary))' }}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </motion.div>
  );
}