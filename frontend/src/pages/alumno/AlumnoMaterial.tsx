import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { FileText, Lock, Download, Loader2, BookOpen, AlertCircle, CheckCircle2, Circle, ShieldAlert } from 'lucide-react';
import materialesService from '@/services/materialesService';
import { getSafeUrl } from '@/lib/sanitize';

const CATEGORIAS = ['A1/A3', 'A2', 'STS', 'Radiofonista'];

export default function AlumnoMaterial({ alumnoId }) {
  const [materiales, setMateriales] = useState([]);
  const [permisos, setPermisos] = useState({});
  const [publicaciones, setPublicaciones] = useState([]);
  const [completados, setCompletados] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadData();
  }, [alumnoId]);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const mats = await materialesService.materiales.list('-orden');
      setMateriales(mats);

      const permsData = await materialesService.permisos.filter(
        { alumno_id: alumnoId },
        null,
        100
      );
      
      const permisosObj = {
        'A1/A3': true,
        A2: permsData.some((p) => p.categoria === 'A2' && p.permitido),
        STS: permsData.some((p) => p.categoria === 'STS' && p.permitido),
        Radiofonista: permsData.some((p) => p.categoria === 'Radiofonista' && p.permitido),
      };
      setPermisos(permisosObj);

      const pubs = await materialesService.publicacionesBoe.list('-fecha_publicacion', 50);
      setPublicaciones(pubs);

      const completadosData = await materialesService.completados.filter({ alumno_id: alumnoId }, null, 500);
      setCompletados(completadosData);
    } catch (err) {
      if (err?.response?.status === 403) {
        setError('No tienes acceso al material de estudio. Consulta con tu instructor.');
      }
    } finally {
      setLoading(false);
    }
  };

  const estaCompletado = (materialId) => {
    return completados.some((c) => c.material_id === materialId && c.completado);
  };

  const toggleCompletado = async (materialId) => {
    const existente = completados.find((c) => c.material_id === materialId);
    if (existente) {
      const nuevoEstado = !existente.completado;
      await materialesService.completados.update(existente.id, { completado: nuevoEstado });
      setCompletados((prev) => prev.map((c) => (c.id === existente.id ? { ...c, completado: nuevoEstado } : c)));
    } else {
      const nuevo = await materialesService.completados.create({
        alumno_id: alumnoId,
        material_id: materialId,
        completado: true,
      });
      setCompletados((prev) => [...prev, nuevo]);
    }
  };

  const handleDescargar = (archivoUrl, titulo, nombreOriginal) => {
    const safeUrl = getSafeUrl(archivoUrl);
    if (safeUrl === '#') return;
    const link = document.createElement('a');
    link.href = safeUrl;
    link.download = nombreOriginal || `${titulo}.pdf`;
    link.click();
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
      {/* Header */}
      <div className="mb-8">
        <div className="inline-flex items-center gap-2 mb-3 px-3 py-1.5 border border-primary/20 bg-primary/5 text-primary text-xs font-mono uppercase tracking-widest">
          <BookOpen className="w-3.5 h-3.5" /> Material
        </div>
        <h2 className="font-heading text-2xl font-bold text-foreground tracking-tight">Material de Estudio</h2>
        <p className="text-sm text-muted-foreground mt-1">Descargas de PDFs y normativa oficial.</p>
      </div>

      {/* Barra de Progreso */}
      {materiales.length > 0 && (
        <div className="glass-card p-5 mb-8">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold text-foreground">Progreso de Formación</p>
            <p className="text-xs text-muted-foreground">
              {materiales.filter((m) => estaCompletado(m.id)).length} / {materiales.length} completados
            </p>
          </div>
          <div className="w-full h-2 bg-surface-muted rounded-full overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{
                width: `${materiales.length ? (materiales.filter((m) => estaCompletado(m.id)).length / materiales.length) * 100 : 0}%`,
              }}
              transition={{ duration: 0.5 }}
              className="h-full bg-primary"
            />
          </div>
        </div>
      )}

      {/* Material de Estudio */}
      <div className="mb-12">
        <div className="mb-6 pb-3 border-b border-border-subtle">
          <h3 className="font-heading text-lg font-bold uppercase tracking-widest text-foreground">
            📚 Material por Categoría
          </h3>
          <p className="text-xs text-muted-foreground mt-2">Documentos descargables para tu preparación.</p>
        </div>

        {CATEGORIAS.map((cat) => {
          const matsCat = materiales.filter((m) => m.categoria === cat);
          const tieneAcceso = permisos[cat];

          return (
            <div key={cat} className="mb-8">
              <div className="flex items-center justify-between mb-4">
                <h4 className="font-heading text-base font-semibold uppercase tracking-wider text-foreground">
                  {cat}
                </h4>
                {!tieneAcceso && (
                  <div className="flex items-center gap-1 text-xs text-warning/70">
                    <Lock className="w-3 h-3" />
                    <span>Bloqueado</span>
                  </div>
                )}
              </div>

              {!tieneAcceso && (
                <div className="mb-4 flex items-start gap-2 text-xs text-warning/80 bg-warning-soft/50 border border-warning-border px-4 py-3 rounded-sm">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>Este material está bloqueado por el Instructor. Solicita acceso cuando completes la categoría anterior.</span>
                </div>
              )}

              {matsCat.length > 0 ? (
                <div className="grid gap-3 mb-6">
                  {matsCat.map((mat) => (
                    <motion.div
                      key={mat.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={`glass-card p-4 flex items-start gap-4 ${!tieneAcceso ? 'opacity-50' : ''}`}
                    >
                      <FileText className={`w-5 h-5 shrink-0 mt-0.5 ${tieneAcceso ? 'text-primary' : 'text-muted-foreground'}`} />
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm text-foreground">{mat.titulo}</p>
                        {mat.descripcion && (
                          <p className="text-xs text-muted-foreground mt-1">{mat.descripcion}</p>
                        )}
                      </div>
                      {tieneAcceso ? (
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            onClick={() => toggleCompletado(mat.id)}
                            className={`inline-flex items-center gap-2 px-3 py-2 border text-xs font-bold uppercase tracking-widest transition-all duration-200 ${
                              estaCompletado(mat.id)
                                ? 'bg-primary/10 border-primary/30 text-primary'
                                : 'border-border-subtle text-muted-foreground hover:border-primary/30 hover:text-primary'
                            }`}
                          >
                            {estaCompletado(mat.id) ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Circle className="w-3.5 h-3.5" />}
                            {estaCompletado(mat.id) ? 'Completado' : 'Marcar'}
                          </button>
                          <button
                            onClick={() => handleDescargar(mat.archivo_url, mat.titulo, mat.archivo_nombre_original)}
                            className="inline-flex items-center gap-2 px-3 py-2 bg-primary/10 border border-primary/30 text-primary hover:bg-primary hover:text-primary-foreground text-xs font-bold uppercase tracking-widest transition-all duration-200"
                          >
                            <Download className="w-3.5 h-3.5" />
                            Descargar
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 px-3 py-2 text-xs font-bold uppercase tracking-widest text-muted-foreground border border-border-subtle shrink-0">
                          <Lock className="w-3.5 h-3.5" />
                          Bloqueado
                        </div>
                      )}
                    </motion.div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-xs text-muted-foreground border border-border-subtle bg-surface-subtle rounded-sm mb-6">
                  Sin material disponible aún
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Publicaciones BOE */}
      <div>
        <div className="mb-6 pb-3 border-b border-border-subtle">
          <h3 className="font-heading text-lg font-bold uppercase tracking-widest text-foreground">
            📄 BOE — Publicaciones Oficiales
          </h3>
          <p className="text-xs text-muted-foreground mt-2">Normativa y actualizaciones legales de drones en España.</p>
        </div>

        {publicaciones.length > 0 ? (
          <div className="grid gap-4">
            {publicaciones.map((pub, i) => (
              <motion.div
                key={pub.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="glass-card p-5 flex flex-col gap-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm text-foreground leading-tight">{pub.titulo}</p>
                    <p className="text-xs text-muted-foreground mt-2">
                      {pub.fecha_publicacion
                        ? new Date(pub.fecha_publicacion).toLocaleDateString('es-ES', {
                            day: 'numeric',
                            month: 'long',
                            year: 'numeric',
                          })
                        : '—'}
                    </p>
                  </div>
                  {pub.categoria !== 'General' && (
                    <span className="px-2 py-1 bg-primary/10 border border-primary/20 text-primary text-xs font-bold uppercase tracking-widest shrink-0">
                      {pub.categoria}
                    </span>
                  )}
                </div>

                {pub.resumen && (
                  <p className="text-xs text-muted-foreground leading-relaxed">{pub.resumen}</p>
                )}

                <a
                  href={getSafeUrl(pub.url)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-primary hover:text-primary/80 text-xs font-bold uppercase tracking-widest transition-colors duration-200 w-fit"
                >
                  Ver publicación oficial ↗
                </a>
              </motion.div>
            ))}
          </div>
        ) : (
          <div className="text-center py-12 text-xs text-muted-foreground border border-border-subtle bg-surface-subtle rounded-sm">
            <FileText className="w-8 h-8 text-muted-foreground/50 mx-auto mb-2" />
            <p>No hay publicaciones BOE disponibles.</p>
          </div>
        )}
      </div>
    </motion.div>
  );
}
