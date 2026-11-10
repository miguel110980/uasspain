import PanelModal from '@/components/ui/PanelModal';
import DataLoadNotice from '@/components/ui/DataLoadNotice';
import { loadResources } from '@/lib/loadResources';
import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Plus, Trash2, Loader2, Upload, FileText, Download, ExternalLink } from 'lucide-react';
import examenesService from '@/services/examenesService';
import { extractErrorMessage } from '@/lib/errors';
import { useToast } from '@/components/ui/use-toast';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { getSafeUrl } from '@/lib/sanitize';

const CATEGORIAS = ['A1/A3', 'A2', 'STS'];

const formatBytes = (value) => {
  if (value == null || Number.isNaN(Number(value))) return '';
  const bytes = Number(value);
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const size = bytes / (1024 ** exponent);
  return `${size < 10 ? size.toFixed(1) : Math.round(size)} ${units[exponent]}`;
};

export default function InstructorExamenes() {
  const [examenes, setExamenes] = useState([]);
  const [preguntas, setPreguntas] = useState([]);
  const [archivosExamen, setArchivosExamen] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [importPreview, setImportPreview] = useState<any>(null);
  const [uploading, setUploading] = useState(false);
  const [archivoToDelete, setArchivoToDelete] = useState(null);
  const [deleteArchivoLoading, setDeleteArchivoLoading] = useState(false);
  const [selectedExamen, setSelectedExamen] = useState(null);
  const [showPreguntaForm, setShowPreguntaForm] = useState(false);
  const cancelUploadRef = useRef(false);
  const abortRef = useRef(/** @type {AbortController | null} */ (null));
  const fileInputRef = useRef(null);
  const loadVersion = useRef(0);
  const { toast } = useToast();

  const [formPregunta, setFormPregunta] = useState({
    enunciado: '',
    opcion_a: '',
    opcion_b: '',
    opcion_c: '',
    opcion_d: '',
    respuesta_correcta: 'a',
  });

  const [formArchivos, setFormArchivos] = useState({
    categoria: 'A1/A3',
    archivo_preguntas: null,
  });

  useEffect(() => {
    void loadData();
    const refresh = () => { void loadData(true); };
    window.addEventListener('focus', refresh);
    return () => { loadVersion.current++; window.removeEventListener('focus', refresh); };
  }, []);

  const loadData = async (silent = false) => {
    const request = ++loadVersion.current;
    if (!silent) setLoading(true);
    const { values, failed } = await loadResources({
      Exámenes: () => examenesService.examenes.list(),
      Preguntas: () => examenesService.preguntas.list(),
      Archivos: () => examenesService.archivos.list(),
    });
    if (request !== loadVersion.current) return;
    if (values.Exámenes) setExamenes(values.Exámenes);
    if (values.Preguntas) setPreguntas(values.Preguntas);
    if (values.Archivos) setArchivosExamen(values.Archivos);
    setLoadError(failed.length ? `No se pudieron actualizar: ${failed.join(', ')}.` : '');
    setLoading(false);
  };

  const handleUploadArchivoPreguntas = async () => {
    if (!formArchivos.archivo_preguntas) return;

    const nombreArchivo = formArchivos.archivo_preguntas.name;
    const yaExiste = archivosExamen.some(
      (a) => a.nombre_archivo === nombreArchivo || a.archivo_nombre_original === nombreArchivo,
    );
    if (yaExiste) {
      toast({ title: 'Examen duplicado', description: 'Este archivo ya está registrado.', variant: 'destructive' });
      return;
    }

    cancelUploadRef.current = false;
    abortRef.current = new AbortController();
    setUploading(true);
    try {
      const uploadPregs = await examenesService.uploadArchivo(formArchivos.archivo_preguntas, {
        signal: abortRef.current.signal,
      });
      if (cancelUploadRef.current) return;

      const metadata = {
        original_name: uploadPregs.original_name || nombreArchivo,
        content_type: uploadPregs.content_type,
        size: uploadPregs.size,
        path: uploadPregs.path,
        sha256: uploadPregs.sha256,
      };

      const res = await examenesService.importarExamenPDF({
        fileUrl: uploadPregs.file_url,
        categoria: formArchivos.categoria,
        metadata,
        signal: abortRef.current.signal,
      });
      if (cancelUploadRef.current) return;

      if (res.data?.error || !res.data?.preguntas?.length) {
        toast({ title: 'No se puede importar', description: res.data?.error || 'No hay preguntas válidas con cuatro opciones y una solución.', variant: 'destructive' });
      } else {
        setImportPreview({ result: res.data, fileUrl: uploadPregs.file_url, categoria: formArchivos.categoria, metadata });
      }

      setFormArchivos({ categoria: 'A1/A3', archivo_preguntas: null });
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err) {
      if (cancelUploadRef.current || err?.code === 'ERR_CANCELED' || err?.name === 'CanceledError') {
        return;
      }
      toast({ title: 'Error al subir el examen', description: extractErrorMessage(err), variant: 'destructive' });
    } finally {
      abortRef.current = null;
      setUploading(false);
    }
  };

  const confirmImport = async () => {
    if (!importPreview) return;
    setUploading(true);
    try {
      const result = await examenesService.importarExamenPDF({ ...importPreview, confirm: true, previewToken: importPreview.result.preview_token });
      if (!result.data?.examenes_creados?.length) throw new Error(result.data?.error || 'No se pudieron confirmar los borradores.');
      setImportPreview(null);
      toast({ title: 'Borradores creados', description: 'Revisa los simulacros antes de publicarlos.' });
      await loadData(); window.dispatchEvent(new Event('uasspain:academic-resources-changed'));
    } catch (error) { toast({ title: 'Error al confirmar', description: extractErrorMessage(error), variant: 'destructive' }); }
    finally { setUploading(false); }
  };

  const publishDraft = async (id: string) => {
    try {
      await examenesService.examenes.update(id, { activo: true });
      await loadData(); window.dispatchEvent(new Event('uasspain:academic-resources-changed'));
    } catch (error) { toast({ title: 'No se pudo publicar', description: extractErrorMessage(error), variant: 'destructive' }); }
  };

  const handleAddPregunta = async (e) => {
    e.preventDefault();
    if (!selectedExamen || !formPregunta.enunciado || !formPregunta.opcion_a || !formPregunta.opcion_b || !formPregunta.opcion_c) return;

    setUploading(true);
    try {
      const nueva = await examenesService.preguntas.create({
        examen_id: selectedExamen.id,
        categoria: selectedExamen.categoria,
        ...formPregunta,
        orden: preguntas.filter((p) => p.examen_id === selectedExamen.id).length,
      });
      setPreguntas((prev) => [...prev, nueva]);
      setFormPregunta({
        enunciado: '',
        opcion_a: '',
        opcion_b: '',
        opcion_c: '',
        opcion_d: '',
        respuesta_correcta: 'a',
      });
    } catch (err) {
      toast({ title: 'Error al crear la pregunta', description: extractErrorMessage(err), variant: 'destructive' });
    } finally {
      setUploading(false);
    }
  };

  const handleDeletePregunta = async (id) => {
    if (!window.confirm('¿Eliminar esta pregunta?')) return;
    try {
      await examenesService.preguntas.delete(id);
      setPreguntas((prev) => prev.filter((p) => p.id !== id));
    } catch (err) {
      toast({ title: 'Error al eliminar la pregunta', description: extractErrorMessage(err), variant: 'destructive' });
    }
  };

  const preguntasExamen = selectedExamen ? preguntas.filter((p) => p.examen_id === selectedExamen.id) : [];

  const examenIdInArchivo = (archivo, examenId) => {
    const ids = (archivo.examen_id || '').split(',').map((s) => s.trim()).filter(Boolean);
    return ids.includes(examenId);
  };

  const handleDeleteArchivo = (archivo) => {
    const examenIds = (archivo.examen_id || '').split(',').map((id) => id.trim()).filter(Boolean);
    const preguntasRelacionadas = preguntas.filter((p) => examenIds.includes(p.examen_id));
    setArchivoToDelete({ archivo, examenIds, preguntasRelacionadas });
  };

  const handlePreviewArchivo = (archivo) => {
    const url = getSafeUrl(archivo.archivo_url);
    if (url === '#') {
      toast({ title: 'Visualización no disponible', description: 'No se pudo abrir el archivo.', variant: 'destructive' });
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const handleDownloadArchivo = (archivo) => {
    const url = getSafeUrl(archivo.archivo_url);
    if (url === '#') {
      toast({ title: 'Descarga no disponible', description: 'No se pudo resolver la URL del archivo.', variant: 'destructive' });
      return;
    }
    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.download = archivo.nombre_archivo || 'examen.pdf';
    link.click();
  };

  const confirmDeleteArchivo = async () => {
    if (!archivoToDelete) return;
    setDeleteArchivoLoading(true);
    const { archivo, examenIds, preguntasRelacionadas } = archivoToDelete;
    try {
      await Promise.all(preguntasRelacionadas.map((p) => examenesService.preguntas.delete(p.id)));
      await Promise.all(examenIds.map((id) => examenesService.examenes.delete(id)));
      await examenesService.archivos.delete(archivo.id);
      setArchivosExamen((prev) => prev.filter((a) => a.id !== archivo.id));
      setExamenes((prev) => prev.filter((e) => !examenIds.includes(e.id)));
      setPreguntas((prev) => prev.filter((p) => !examenIds.includes(p.examen_id)));
      if (selectedExamen && examenIds.includes(selectedExamen.id)) {
        setSelectedExamen(null);
      }
      toast({ title: 'Simulacro eliminado', description: 'El archivo y los exámenes asociados se han eliminado.' });
    } catch (err) {
      console.error('Error eliminando simulacro:', err);
      toast({ title: 'Error', description: 'No se pudo eliminar el simulacro completamente.', variant: 'destructive' });
      await loadData(true);
    } finally {
      setDeleteArchivoLoading(false);
      setArchivoToDelete(null);
      window.dispatchEvent(new Event('uasspain:academic-resources-changed'));
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="space-y-8">
      {importPreview && <PanelModal label="Previsualización de la importación" onClose={() => { if (!uploading) setImportPreview(null); }} className="glass-card max-w-4xl p-6">
        <h2 className="font-heading text-xl">Revisar preguntas antes de importar</h2>
        <p>{importPreview.categoria} · {importPreview.result.total_validas} válidas · {importPreview.result.total_errores} rechazadas</p>
        <div className="max-h-[60vh] overflow-auto space-y-4 my-4">
          {importPreview.result.preguntas.map((question, index) => <article key={index} className="border border-border-subtle p-3">
            <p>{index + 1}. {question.enunciado}</p>
            {Object.entries(question.opciones).map(([key, text]) => <p key={key}>{key.toUpperCase()}. {String(text)}{key === question.respuesta_correcta ? ' · Correcta' : ''}</p>)}
          </article>)}
          {importPreview.result.errores.map((error, index) => <p key={'error-'+index} className="text-warning">{error.numero ? 'Pregunta '+error.numero+': ' : ''}{error.motivo}</p>)}
        </div>
        <button type="button" disabled={uploading} onClick={() => void confirmImport()} className="text-primary">Confirmar importación en borrador</button>
        <button type="button" disabled={uploading} onClick={() => setImportPreview(null)} className="ml-4">Cancelar importación</button>
      </PanelModal>}
      <DataLoadNotice error={loadError} retry={loadData} />
      {/* Subir Archivos de Exámenes */}
      <div className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-6">
          {/* Card 1: Archivo de Examen */}
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass-card p-6">
            <h3 className="font-heading text-base font-bold text-foreground mb-4 flex items-center gap-2">
              <Upload className="w-4 h-4 text-primary" />
              Archivo de Examen
            </h3>
            <label htmlFor="archivo_preguntas" className="block text-xs font-mono uppercase tracking-widest text-muted-foreground mb-3">
              PDF, DOC, DOCX
            </label>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.doc,.docx"
              id="archivo_preguntas"
              onChange={(e) => setFormArchivos((prev) => ({ ...prev, archivo_preguntas: e.target.files?.[0] || null }))}
              className="w-full text-sm text-muted-foreground file:mr-3 file:px-3 file:py-1.5 file:border file:border-primary/30 file:bg-primary/10 file:text-brand-cyan-text file:text-xs file:font-bold file:cursor-pointer hover:file:bg-primary/20"
            />
            {formArchivos.archivo_preguntas && (
              <p className="text-xs text-primary mt-2">📄 {formArchivos.archivo_preguntas.name}</p>
            )}
          </motion.div>

          {/* Card 2: Categoría */}
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="glass-card p-6">
            <h3 className="font-heading text-base font-bold text-foreground mb-4">Categoría</h3>
            <select
              aria-label="Categoría del examen"
              value={formArchivos.categoria}
              onChange={(e) => setFormArchivos((prev) => ({ ...prev, categoria: e.target.value }))}
              className="w-full bg-background border border-border-subtle rounded px-3 py-2 text-sm text-foreground focus:border-transparent focus:outline-none [&>option]:bg-card [&>option]:text-foreground"
            >
              {CATEGORIAS.map((cat) => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </motion.div>
        </div>

        {/* Botón Subir */}
        <motion.button
          onClick={handleUploadArchivoPreguntas}
          disabled={uploading || !formArchivos.archivo_preguntas}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-primary text-primary-foreground font-bold uppercase tracking-widest text-xs hover:bg-primary/80 transition-all duration-300 disabled:opacity-50"
        >
          {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
          {uploading ? 'Analizando archivo...' : 'Subir Examen'}
        </motion.button>

        {uploading && (
          <motion.button
            type="button"
            onClick={() => {
              cancelUploadRef.current = true;
              abortRef.current?.abort();
              abortRef.current = null;
              setUploading(false);
            }}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full px-4 py-2 border border-danger-border text-danger text-xs font-bold uppercase tracking-widest hover:bg-danger hover:text-danger-foreground transition-all duration-200"
          >
            Cancelar Subida
          </motion.button>
        )}

        {/* Lista de Simulacros Subidos por Categoría */}
        {archivosExamen.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
            <h4 className="font-heading text-base font-bold text-foreground mb-4">Simulacros Subidos</h4>
            {CATEGORIAS.map((cat) => {
              const archivosCat = archivosExamen.filter((a) => a.categoria === cat || (!a.categoria && a.descripcion?.includes(cat)));
              if (archivosCat.length === 0) return null;
              return (
                <div key={cat} className="mb-6">
                  <h5 className="font-semibold text-sm text-foreground mb-3 uppercase tracking-wider">{cat}</h5>
                  <div className="space-y-3">
                    {archivosCat.map((arch, i) => (
                      <motion.div
                        key={arch.id}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.05 }}
                        className="glass-card p-4 flex items-start justify-between gap-4"
                      >
                        <div className="flex items-start gap-3 flex-1">
                          <FileText className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold text-foreground">{arch.descripcion}</p>
                            {arch.nombre_archivo && (
                              <p className="text-xs text-muted-foreground mt-1 break-all">Archivo: {arch.nombre_archivo}</p>
                            )}
                            <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground mt-1">
                              {arch.archivo_tamano ? <span>{formatBytes(arch.archivo_tamano)}</span> : null}
                              {arch.archivo_content_type ? <span>{arch.archivo_content_type}</span> : null}
                              {arch.num_examenes ? <span>{arch.num_examenes} simulacro(s)</span> : null}
                            </div>
                            <div className="flex gap-2 mt-2 text-xs">
                              <span className="text-primary font-mono">📄 Preguntas</span>
                              {arch.archivo_respuestas_url && <span className="text-primary font-mono">📋 Respuestas</span>}
                            </div>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => handlePreviewArchivo(arch)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold border border-border-subtle text-muted-foreground hover:border-primary/40 hover:text-brand-cyan-text transition-all duration-200"
                          >
                            <ExternalLink className="w-3 h-3" />
                            Abrir
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDownloadArchivo(arch)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold border border-primary/30 bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground transition-all duration-200"
                          >
                            <Download className="w-3 h-3" />
                            Descargar
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteArchivo(arch)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-danger border border-danger-border bg-danger-soft/60 hover:bg-danger hover:text-danger-foreground transition-all duration-200"
                          >
                            <Trash2 className="w-3 h-3" />
                            Eliminar
                          </button>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                </div>
              );
            })}
          </motion.div>
        )}
      </div>

      <AlertDialog
        open={Boolean(archivoToDelete)}
        onOpenChange={(open) => {
          if (!open && !deleteArchivoLoading) {
            setArchivoToDelete(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar este simulacro?</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminará el archivo <span className="font-semibold">{archivoToDelete?.archivo?.nombre_archivo}</span> y {archivoToDelete?.examenIds?.length || 0} examen(es) asociados.
              Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteArchivoLoading}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteArchivo} disabled={deleteArchivoLoading}>
              {deleteArchivoLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Eliminar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Lista Exámenes */}
      <div>
        <h3 className="font-heading text-lg font-bold text-foreground mb-4">Simulacros Disponibles</h3>
        {examenes.filter((ex) => archivosExamen.some((a) => examenIdInArchivo(a, ex.id))).length === 0 ? (
          <div className="text-center py-12 glass-card">
            <FileText className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">No hay simulacros creados aún.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {examenes.filter((ex) => archivosExamen.some((a) => examenIdInArchivo(a, ex.id))).map((ex) => {
              const conteo = preguntas.filter((p) => p.examen_id === ex.id).length;
              const tieneArchivos = archivosExamen.some((a) => examenIdInArchivo(a, ex.id));
              return (
                <motion.div
                  key={ex.id}
                  onClick={() => setSelectedExamen(ex)}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`glass-card min-w-0 break-words p-5 cursor-pointer transition-all duration-200 ${
                    selectedExamen?.id === ex.id ? 'border border-primary/50 bg-primary/10' : 'border border-border-subtle hover:border-primary/30'
                  }`}
                >
                  <p className="font-heading text-sm font-bold text-foreground">{ex.nombre}</p>
                  <p className="text-xs text-muted-foreground mt-1">Categoría {ex.categoria}</p>
                  {!ex.activo && <button type="button" onClick={event => { event.stopPropagation(); void publishDraft(ex.id); }} className="text-primary underline mt-2">Publicar borrador</button>}
                  <div className="flex gap-3 mt-3 text-xs">
                    {tieneArchivos && <span className="text-primary font-mono">📎 Archivos</span>}
                    {conteo > 0 && <span className="text-primary font-mono">❓ {conteo} preguntas</span>}
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>

      {/* Gestionar Preguntas Manuales */}
      {selectedExamen && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass-card p-8">
          <h3 className="font-heading text-lg font-bold text-foreground mb-2">
            Preguntas Manuales — {selectedExamen.nombre}
          </h3>
          <p className="text-xs text-muted-foreground mb-6">{preguntasExamen.length}/{selectedExamen.num_preguntas}</p>

          {!showPreguntaForm ? (
            <button
              onClick={() => setShowPreguntaForm(true)}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-primary/10 border border-primary/30 text-primary text-xs font-bold uppercase tracking-widest hover:bg-primary hover:text-primary-foreground transition-all duration-200 mb-6"
            >
              <Plus className="w-3.5 h-3.5" />
              Añadir Pregunta Manual
            </button>
          ) : (
            <form onSubmit={handleAddPregunta} className="space-y-5 mb-6 p-5 border border-primary/20 bg-primary/5">
              <div>
                <label htmlFor="instructorexamenes-field-1" className="block text-xs font-mono uppercase tracking-widest text-muted-foreground mb-2">
                  Enunciado
                </label>
                <textarea id="instructorexamenes-field-1"
                  value={formPregunta.enunciado}
                  onChange={(e) => setFormPregunta((prev) => ({ ...prev, enunciado: e.target.value }))}
                  placeholder="Escribe la pregunta..."
                  className="w-full bg-surface-muted border border-border-subtle rounded px-3 py-2 text-sm text-foreground focus:border-transparent focus:outline-none h-20"
                  required
                />
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {['a', 'b', 'c', 'd'].map((opt) => (
                  <div key={opt}>
                    <label htmlFor={`instructorexamenes-answer-${opt}`} className="block text-xs font-mono uppercase tracking-widest text-muted-foreground mb-2">
                      Opción {opt.toUpperCase()}
                    </label>
                    <input id={`instructorexamenes-answer-${opt}`}
                      type="text"
                      value={formPregunta[`opcion_${opt}`]}
                      onChange={(e) => setFormPregunta((prev) => ({ ...prev, [`opcion_${opt}`]: e.target.value }))}
                      placeholder={`Respuesta ${opt}`}
                      className="w-full bg-surface-muted border border-border-subtle rounded px-3 py-2 text-sm text-foreground focus:border-transparent focus:outline-none"
                      required
                    />
                  </div>
                ))}
              </div>

              <div>
                <label htmlFor="instructorexamenes-field-3" className="block text-xs font-mono uppercase tracking-widest text-muted-foreground mb-2">
                  Respuesta Correcta
                </label>
                <select id="instructorexamenes-field-3"
                  value={formPregunta.respuesta_correcta}
                  onChange={(e) => setFormPregunta((prev) => ({ ...prev, respuesta_correcta: e.target.value }))}
                  className="w-full bg-background border border-border-subtle rounded px-3 py-2 text-sm text-foreground focus:border-transparent focus:outline-none [&>option]:bg-card [&>option]:text-foreground"
                >
                  <option value="a">Opción A</option>
                  <option value="b">Opción B</option>
                  <option value="c">Opción C</option>
                  <option value="d">Opción D</option>
                </select>
              </div>

              <div className="flex gap-3">
                <button
                  type="submit"
                  disabled={uploading}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-primary text-primary-foreground font-bold uppercase tracking-widest text-xs hover:bg-primary/80 transition-all duration-300 disabled:opacity-50"
                >
                  {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                  {uploading ? 'Guardando...' : 'Guardar Pregunta'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowPreguntaForm(false)}
                  className="flex-1 px-4 py-2 border border-border-subtle text-muted-foreground text-xs font-bold uppercase tracking-widest hover:border-primary/30 hover:text-brand-cyan-text transition-all duration-200"
                >
                  Cancelar
                </button>
              </div>
            </form>
          )}

          {/* Lista Preguntas */}
          {preguntasExamen.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              No hay preguntas manuales aún.
            </div>
          ) : (
            <div className="space-y-4">
              {preguntasExamen.map((preg, i) => (
                <motion.div
                  key={preg.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className="border border-border-subtle rounded p-4 bg-surface-subtle"
                >
                  <div className="flex justify-between items-start gap-3 mb-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-1">Pregunta {i + 1}</p>
                      <p className="text-sm text-foreground font-semibold">{preg.enunciado}</p>
                    </div>
                    <button
                      type="button" aria-label="Eliminar pregunta" onClick={() => handleDeletePregunta(preg.id)}
                      className="shrink-0 text-danger hover:text-danger transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="space-y-1.5 text-xs">
                    {['a', 'b', 'c', 'd'].map((opt) => (
                      <p
                        key={opt}
                        className={`px-2 py-1.5 rounded ${
                          preg.respuesta_correcta === opt
                            ? 'bg-primary/20 text-primary font-semibold'
                            : 'text-muted-foreground'
                        }`}
                      >
                        {opt.toUpperCase()}) {preg[`opcion_${opt}`]}
                      </p>
                    ))}
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </motion.div>
      )}
    </motion.div>
  );
}
