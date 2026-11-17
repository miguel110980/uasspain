import DataLoadNotice from '@/components/ui/DataLoadNotice';
import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Loader2, Search, BarChart2 } from 'lucide-react';
import examenesService from '@/services/examenesService';
import authService from '@/services/authService';

export default function InstructorResultados() {
  const [resultados, setResultados] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [busquedaNombre, setBusquedaNombre] = useState('');
  const [filtroFecha, setFiltroFecha] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    setLoadError('');
    try {
      const [resultadosData, profilesData] = await Promise.all([
        examenesService.resultados.listAll(),
        authService.listProfiles(),
      ]);
      setResultados(resultadosData);
      setProfiles(profilesData);
    } catch {
      setLoadError('No se pudieron cargar los datos. Vuelve a intentarlo.');
    } finally {
      setLoading(false);
    }
  };

  const getNombreAlumno = (alumnoId) => {
    const perfil = profiles.find((p) => p.id === alumnoId);
    return perfil ? `${perfil.nombre || ''} ${perfil.apellidos || ''}`.trim() : 'Desconocido';
  };

  const resultadosFiltrados = resultados.filter((r) => {
    const nombre = getNombreAlumno(r.alumno_id).toLowerCase();
    const coincideNombre = busquedaNombre ? nombre.includes(busquedaNombre.toLowerCase()) : true;
    const coincideFecha = filtroFecha
      ? r.fecha && new Date(r.fecha).toISOString().slice(0, 10) === filtroFecha
      : true;
    return coincideNombre && coincideFecha;
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
      <DataLoadNotice error={loadError} retry={loadData} />
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
          <input aria-label="Buscar por nombre de alumno..."
            type="text"
            value={busquedaNombre}
            onChange={(e) => setBusquedaNombre(e.target.value)}
            placeholder="Buscar por nombre de alumno..."
            className="w-full bg-surface-muted border border-border-subtle rounded pl-9 pr-3 py-2.5 text-sm text-foreground focus:border-transparent focus:outline-none"
          />
        </div>
        <input aria-label="Filtrar por fecha"
          type="date"
          value={filtroFecha}
          onChange={(e) => setFiltroFecha(e.target.value)}
          className="bg-surface-muted border border-border-subtle rounded px-3 py-2.5 text-sm text-foreground focus:border-transparent focus:outline-none"
        />
        {(busquedaNombre || filtroFecha) && (
          <button
            onClick={() => { setBusquedaNombre(''); setFiltroFecha(''); }}
            className="px-4 py-2.5 text-xs font-mono uppercase tracking-widest text-muted-foreground border border-border-subtle hover:border-primary/30 hover:text-brand-cyan-text transition-all duration-200"
          >
            Limpiar
          </button>
        )}
      </div>

      {resultadosFiltrados.length === 0 ? (
        <div className="text-center py-20 glass-card">
          <BarChart2 className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground text-sm">No hay resultados que coincidan con la búsqueda.</p>
        </div>
      ) : (
        <div className="overflow-x-auto glass-card" role="region" aria-label="Resultados de los alumnos" tabIndex={0}>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-subtle text-xs font-mono uppercase tracking-widest text-muted-foreground">
                <th className="text-left px-4 py-3">Alumno</th>
                <th className="text-left px-4 py-3">Examen</th>
                <th className="text-left px-4 py-3">Categoría</th>
                <th className="text-left px-4 py-3">Nota</th>
                <th className="text-left px-4 py-3">Resultado</th>
                <th className="text-left px-4 py-3">Fecha</th>
              </tr>
            </thead>
            <tbody>
              {resultadosFiltrados.map((r, i) => (
                <motion.tr
                  key={r.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: i * 0.02 }}
                  className="border-b border-border-subtle last:border-0"
                >
                  <td className="px-4 py-3 text-foreground font-medium">{getNombreAlumno(r.alumno_id)}</td>
                  <td className="px-4 py-3 text-foreground">{r.examen_nombre}</td>
                  <td className="px-4 py-3 text-muted-foreground">{r.categoria}</td>
                  <td className="px-4 py-3 text-foreground">{r.nota}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 text-xs border rounded-sm ${
                      r.aprobado ? 'text-primary bg-primary/10 border-primary/20' : 'text-danger bg-danger-soft border-danger-border'
                    }`}>
                      {r.aprobado ? 'Aprobado' : 'Suspendido'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {r.fecha ? new Date(r.fecha).toLocaleDateString('es-ES') : ''}
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </motion.div>
  );
}
