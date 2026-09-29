import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Lock, Play, Loader2, Clock, CheckCircle, ClipboardList, ShieldAlert } from 'lucide-react';
import examenesService from '@/services/examenesService';
const GRUPOS = [
  { label: 'Categoría Abierta — A1/A3', subtitle: 'Primer nivel de operaciones con drones profesionales.', cats: ['A1/A3'] },
  { label: 'Categoría Abierta — A2', subtitle: 'Requiere haber obtenido previamente la titulación A1/A3.', cats: ['A2'], requiereA1: true },
  { label: 'Categoría Específica — Estándares Europeos (STS)', subtitle: 'Requiere haber obtenido previamente la titulación A2.', cats: ['STS'], requiereA2: true },
];

export default function AlumnoExamenes({ alumnoId, onIniciarExamen }) {
  const [examenes, setExamenes] = useState([]);
  const [resultados, setResultados] = useState([]);
  const [bloqueos, setBloqueos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedExamen, setSelectedExamen] = useState(null);
  const [modalidad, setModalidad] = useState('tiempo');

  useEffect(() => {
    if (!alumnoId) return;
    loadData();
  }, [alumnoId]);

  const loadData = async () => {
    if (!alumnoId) return;
    setLoading(true);
    setError(null);
    try {
      const [exs, res, bloqData] = await Promise.all([
        examenesService.examenes.list(),
        examenesService.resultados.filter({ alumno_id: alumnoId }, '-created_date', 100),
        examenesService.bloqueos.filter({ alumno_id: alumnoId }),
      ]);
      setExamenes(exs);
      setResultados(res);
      setBloqueos(bloqData.filter((b) => b.bloqueado));
    } catch (err) {
      if (err?.response?.status === 403) {
        setError('No tienes acceso a los exámenes. Consulta con tu instructor.');
      } else {
        setError('No se pudieron cargar los exámenes. Comprueba tu conexión y vuelve a intentarlo.');
      }
    } finally {
      setLoading(false);
    }
  };

  const getUltimoResultado = (examenId) =>
    resultados.filter((r) => r.examen_id === examenId)[0] || null;

  const tieneAprobadoCategoria = (categoria) =>
    resultados.some((r) => r.categoria === categoria && r.aprobado);

  const estaBloqueadoPorInstructor = (examenId) =>
    bloqueos.some((b) => b.examen_id === examenId);

  const handleComenzar = () => {
    if (!selectedExamen) return;
    onIniciarExamen(selectedExamen, modalidad);
    setSelectedExamen(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-20 glass-card">
        <ShieldAlert className="w-10 h-10 text-warning mb-3" />
        <p className="text-sm text-muted-foreground text-center">{error}</p>
      </div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
      <div className="mb-8">
        <div className="inline-flex items-center gap-2 mb-3 px-3 py-1.5 border border-primary/20 bg-primary/5 text-primary text-xs font-mono uppercase tracking-widest">
          <ClipboardList className="w-3.5 h-3.5" /> Exámenes
        </div>
        <h2 className="font-heading text-2xl font-bold text-foreground tracking-tight">Exámenes Disponibles</h2>
        <p className="text-sm text-muted-foreground mt-1">Selecciona un examen para comenzar.</p>
      </div>

      <div className="space-y-12">
        {GRUPOS.map((grupo) => {
          const exsCat = examenes.filter((e) => grupo.cats.includes(e.categoria));
          if (exsCat.length === 0) return null;
          return (
            <div key={grupo.label}>
              <div className="mb-5 pb-3 border-b border-border-subtle">
                <h3 className="font-heading text-base font-bold uppercase tracking-widest text-foreground">
                  {grupo.label}
                </h3>
                <p className="text-xs text-muted-foreground mt-1">{grupo.subtitle}</p>
              </div>
              {(grupo.requiereA1 || grupo.requiereA2) && !tieneAprobadoCategoria(grupo.requiereA1 ? 'A1/A3' : 'A2') && (
              <div className="mb-4 flex items-start gap-2 text-xs text-warning/80 bg-warning-soft/50 border border-warning-border px-4 py-3">
                <span className="shrink-0 mt-0.5">🔒</span>
                <span>
                  Esta categoría requiere haber aprobado previamente la titulación{' '}
                  <strong>{grupo.requiereA1 ? 'A1/A3' : 'A2'}</strong>. Completa y aprueba los exámenes de esa categoría primero.
                </span>
              </div>
            )}
          <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
                {exsCat.map((ex, i) => {
                  const ultimo = getUltimoResultado(ex.id);
                  const bloqueadoPorRequisito = (grupo.requiereA1 && !tieneAprobadoCategoria('A1/A3')) || (grupo.requiereA2 && !tieneAprobadoCategoria('A2'));
                  return (
                    <motion.div
                      key={ex.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.05 }}
                      className={`glass-card p-6 flex flex-col gap-4 ${(ex.bloqueado || bloqueadoPorRequisito) ? 'opacity-60' : ''}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-heading text-sm font-semibold text-foreground">{ex.nombre}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">{ex.num_preguntas || 40} preguntas</p>
                        </div>
                        {ex.bloqueado ? (
                          <Lock className="w-4 h-4 text-warning shrink-0 mt-0.5" />
                        ) : (
                          <CheckCircle className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                        )}
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div>
                          <p className="text-muted-foreground font-mono uppercase tracking-widest">Último</p>
                          <p className="text-foreground mt-0.5">
                            {ultimo ? new Date(ultimo.fecha || ultimo.created_date).toLocaleDateString('es-ES') : '—'}
                          </p>
                        </div>
                        <div>
                          <p className="text-muted-foreground font-mono uppercase tracking-widest">Nota</p>
                          <p className={`mt-0.5 font-bold ${ultimo ? (ultimo.aprobado ? 'text-primary' : 'text-danger') : 'text-foreground'}`}>
                            {ultimo ? `${Number(ultimo.nota ?? 0).toFixed(1)}/10` : '—'}
                          </p>
                        </div>
                      </div>

                      {estaBloqueadoPorInstructor(ex.id) ? (
                        <div className="flex items-center gap-2 text-xs text-warning bg-warning-soft border border-warning-border px-3 py-2 rounded-sm">
                          <Lock className="w-3 h-3 shrink-0" />
                          Tu Profesor ha bloqueado este examen.
                        </div>
                      ) : bloqueadoPorRequisito ? (
                        <div className="flex items-center gap-2 text-xs text-warning bg-warning-soft border border-warning-border px-3 py-2 rounded-sm">
                          <Lock className="w-3 h-3 shrink-0" />
                          Requiere titulación previa.
                        </div>
                      ) : (
                        <button
                          onClick={() => setSelectedExamen(ex)}
                          className="inline-flex items-center justify-center gap-2 bg-primary/10 border border-primary/30 text-primary hover:bg-primary hover:text-primary-foreground px-4 py-2 text-xs font-bold uppercase tracking-widest transition-all duration-200"
                        >
                          <Play className="w-3.5 h-3.5" /> Iniciar examen
                        </button>
                      )}
                    </motion.div>
                  );
                })}
              </div>
            </div>
          );
        })}

        {examenes.length === 0 && (
          <div className="text-center py-20 glass-card">
            <ClipboardList className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground text-sm">No hay exámenes disponibles todavía.</p>
          </div>
        )}
      </div>

      {/* Modal configuración */}
      {selectedExamen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setSelectedExamen(null)} />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="relative w-full max-w-md glass-card p-8 z-10"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-heading text-xl font-bold text-foreground mb-1">{selectedExamen.nombre}</h3>
            <p className="text-sm text-muted-foreground mb-6">Categoría {selectedExamen.categoria} · {selectedExamen.num_preguntas || 40} preguntas</p>

            <div className="mb-6">
              <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-3">Modalidad</p>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { value: 'tiempo', label: 'Por tiempo', desc: '40 minutos', icon: Clock },
                  { value: 'libre', label: 'Libre', desc: 'Sin límite', icon: Play },
                ].map(({ value, label, desc, icon: Icon }) => (
                  <button
                    key={value}
                    onClick={() => setModalidad(value)}
                    className={`flex flex-col items-center gap-2 p-4 border transition-all duration-200 ${
                      modalidad === value
                        ? 'border-primary/50 bg-primary/10 text-primary'
                        : 'border-border-subtle text-muted-foreground hover:border-primary/30'
                    }`}
                  >
                    <Icon className="w-5 h-5" />
                    <span className="text-xs font-bold uppercase tracking-widest">{label}</span>
                    <span className="text-xs opacity-70">{desc}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setSelectedExamen(null)}
                className="flex-1 px-4 py-3 border border-border-subtle text-muted-foreground text-xs font-bold uppercase tracking-widest hover:border-primary/30 hover:text-primary transition-all duration-200"
              >
                Cancelar
              </button>
              <button
                onClick={handleComenzar}
                className="flex-1 inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground px-4 py-3 font-bold uppercase tracking-tighter text-xs hover:bg-primary/80 transition-all duration-300"
              >
                <Play className="w-3.5 h-3.5" /> Comenzar examen
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </motion.div>
  );
}