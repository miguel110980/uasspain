import DataLoadNotice from '@/components/ui/DataLoadNotice';
import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Upload, FileText, Trash2, Loader2, Plus, Download, ExternalLink } from 'lucide-react';
import materialesService from '@/services/materialesService';
import { useToast } from '@/components/ui/use-toast';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { getSafeUrl } from '@/lib/sanitize';
import { loadResources } from '@/lib/loadResources';

const CATEGORIAS = ['A1/A3', 'A2', 'STS', 'Radiofonista'];

const formatBytes = (value) => {
  if (value == null || Number.isNaN(Number(value))) return '';
  const bytes = Number(value);
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const size = bytes / (1024 ** exponent);
  return `${size < 10 ? size.toFixed(1) : Math.round(size)} ${units[exponent]}`;
};

export default function InstructorMaterial() {
  const [materiales, setMateriales] = useState([]);
  const [publicaciones, setPublicaciones] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [materialToDelete, setMaterialToDelete] = useState(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [activeSection, setActiveSection] = useState('material');
  const { toast } = useToast();

  // Form Material
  const [formMaterial, setFormMaterial] = useState({
    titulo: '',
    descripcion: '',
    categoria: 'A1/A3',
    archivo: null,
  });

  // Form BOE
  const [formBOE, setFormBOE] = useState({
    titulo: '',
    resumen: '',
    fecha: new Date().toISOString().split('T')[0],
    url: '',
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    setLoadError('');
    try {
      const { values, failed } = await loadResources({
        Materiales: () => materialesService.materiales.list('-orden'),
        BOE: () => materialesService.publicacionesBoe.list('-fecha_publicacion'),
      });
      if (values.Materiales) setMateriales(values.Materiales);
      if (values.BOE) setPublicaciones(values.BOE);
      setLoadError(failed.length ? `No se pudieron actualizar: ${failed.join(', ')}. Se conservan los últimos datos disponibles.` : '');
    } catch {
      setLoadError('No se pudieron cargar los datos. Vuelve a intentarlo.');
    } finally {
      setLoading(false);
    }
  };

  const handleUploadMaterial = async (e) => {
    e.preventDefault();
    if (!formMaterial.titulo || !formMaterial.categoria || !formMaterial.archivo) return;

    setUploading(true);
    try {
      const uploadRes = await materialesService.uploadArchivo(formMaterial.archivo);

      await materialesService.materiales.create({
        titulo: formMaterial.titulo,
        descripcion: formMaterial.descripcion,
        categoria: formMaterial.categoria,
        tipo: 'pdf',
        archivo_url: uploadRes.file_url || uploadRes.absolute_url,
        archivo_path: uploadRes.path,
        archivo_content_type: uploadRes.content_type,
        archivo_tamano: uploadRes.size,
        archivo_nombre_original: uploadRes.original_name || formMaterial.archivo.name,
        archivo_sha256: uploadRes.sha256 || '',
        orden: materiales.filter((m) => m.categoria === formMaterial.categoria).length,
      });

      setFormMaterial({ titulo: '', descripcion: '', categoria: 'A1/A3', archivo: null });
      await loadData();
      window.dispatchEvent(new Event('uasspain:academic-resources-changed'));
      toast({ title: 'Material subido', description: 'El archivo se ha guardado correctamente.' });
    } catch (err) {
      console.error('Error subiendo material:', err);
      const msg = err?.response?.data?.detail || err?.message || 'No se pudo subir el material. Inténtalo de nuevo.';
      toast({ title: 'Error al subir', description: msg, variant: 'destructive' });
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteMaterial = (material) => {
    setMaterialToDelete(material);
  };

  const confirmDeleteMaterial = async () => {
    if (!materialToDelete) return;
    setDeleteLoading(true);
    try {
      await materialesService.materiales.delete(materialToDelete.id);
      setMateriales((prev) => prev.filter((m) => m.id !== materialToDelete.id));
      toast({ title: 'Material eliminado', description: 'El archivo se ha eliminado correctamente.' });
    } catch (err) {
      console.error('Error eliminando material:', err);
      toast({ title: 'Error al eliminar', description: 'No se pudo eliminar el material.', variant: 'destructive' });
    } finally {
      setDeleteLoading(false);
      setMaterialToDelete(null);
    }
  };

  const handleDownloadMaterial = (material) => {
    const url = getSafeUrl(material.archivo_url);
    if (url === '#') {
      toast({ title: 'Descarga no disponible', description: 'No se pudo resolver la URL del archivo.', variant: 'destructive' });
      return;
    }
    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.download = material.archivo_nombre_original || `${material.titulo}.pdf`;
    link.click();
  };

  const handlePreviewMaterial = (material) => {
    const url = getSafeUrl(material.archivo_url);
    if (url === '#') {
      toast({ title: 'Visualización no disponible', description: 'No se pudo abrir el archivo.', variant: 'destructive' });
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const handleAddBOE = async (e) => {
    e.preventDefault();
    if (!formBOE.titulo || !formBOE.url) return;

    setUploading(true);
    try {
      await materialesService.publicacionesBoe.create({
        titulo: formBOE.titulo,
        resumen: formBOE.resumen,
        fecha_publicacion: formBOE.fecha,
        url: formBOE.url,
      });

      setFormBOE({
        titulo: '',
        resumen: '',
        fecha: new Date().toISOString().split('T')[0],
        url: '',
      });
      await loadData();
    } catch (err) {
      console.error('Error creando publicación:', err);
      toast({ title: 'Error al crear', description: 'No se pudo crear la publicación del BOE.', variant: 'destructive' });
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteBOE = async (id) => {
    if (!window.confirm('¿Eliminar esta publicación?')) return;
    try {
      await materialesService.publicacionesBoe.delete(id);
      setPublicaciones((prev) => prev.filter((p) => p.id !== id));
    } catch (err) {
      console.error('Error eliminando publicación:', err);
      toast({ title: 'Error al eliminar', description: 'No se pudo eliminar la publicación del BOE.', variant: 'destructive' });
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
    <div>
      <DataLoadNotice error={loadError} retry={loadData} />
      {/* Tabs */}
      <div className="flex flex-wrap gap-2 mb-8">
        {[
          { id: 'material', label: 'Material de Estudio', icon: Upload },
          { id: 'boe', label: 'Publicaciones BOE', icon: FileText },
        ].map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveSection(id)}
            className={`flex items-center gap-2 px-5 py-2.5 text-xs font-mono uppercase tracking-widest border transition-all duration-200 ${
              activeSection === id
                ? 'border-primary/50 bg-primary/10 text-primary'
                : 'border-border-subtle text-muted-foreground hover:border-primary/30 hover:text-brand-cyan-text'
            }`}
          >
            <Icon className="w-3.5 h-3.5" /> {label}
          </button>
        ))}
      </div>

      {activeSection === 'material' ? (
        <div className="space-y-8">
          {/* Form Subir Material */}
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass-card p-8">
            <h3 className="font-heading text-lg font-bold text-foreground mb-6 flex items-center gap-2">
              <Plus className="w-5 h-5 text-primary" />
              Subir Nuevo Material
            </h3>

            <form onSubmit={handleUploadMaterial} className="space-y-5">
              <div className="grid sm:grid-cols-2 gap-5">
                <div>
                  <label htmlFor="instructormaterial-field-1" className="block text-xs font-mono uppercase tracking-widest text-muted-foreground mb-2">
                    Título
                  </label>
                  <input id="instructormaterial-field-1"
                    type="text"
                    value={formMaterial.titulo}
                    onChange={(e) => setFormMaterial((prev) => ({ ...prev, titulo: e.target.value }))}
                    placeholder="Ej: Manual A1/A3 — Introducción"
                    className="w-full bg-surface-muted border border-border-subtle rounded px-3 py-2 text-sm text-foreground placeholder-muted-foreground focus:border-transparent focus:outline-none"
                    required
                  />
                </div>

                <div>
                  <label htmlFor="instructormaterial-field-2" className="block text-xs font-mono uppercase tracking-widest text-muted-foreground mb-2">
                    Categoría
                  </label>
                  <select id="instructormaterial-field-2"
                    value={formMaterial.categoria}
                    onChange={(e) => setFormMaterial((prev) => ({ ...prev, categoria: e.target.value }))}
                    className="w-full bg-background border border-border-subtle rounded px-3 py-2 text-sm text-foreground focus:border-transparent focus:outline-none [&>option]:bg-card [&>option]:text-foreground"
                  >
                    {CATEGORIAS.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label htmlFor="instructormaterial-field-3" className="block text-xs font-mono uppercase tracking-widest text-muted-foreground mb-2">
                  Descripción (opcional)
                </label>
                <textarea id="instructormaterial-field-3"
                  value={formMaterial.descripcion}
                  onChange={(e) => setFormMaterial((prev) => ({ ...prev, descripcion: e.target.value }))}
                  placeholder="Ej: Guía introductoria para principiantes..."
                  className="w-full bg-surface-muted border border-border-subtle rounded px-3 py-2 text-sm text-foreground placeholder-muted-foreground focus:border-transparent focus:outline-none h-20"
                />
              </div>

              <div>
                <label htmlFor="instructormaterial-field-4" className="block text-xs font-mono uppercase tracking-widest text-muted-foreground mb-2">
                  Archivo PDF
                </label>
                <input id="instructormaterial-field-4"
                  type="file"
                  accept=".pdf"
                  onChange={(e) => setFormMaterial((prev) => ({ ...prev, archivo: e.target.files?.[0] || null }))}
                  className="w-full text-sm text-muted-foreground file:mr-3 file:px-3 file:py-1.5 file:border file:border-primary/30 file:bg-primary/10 file:text-brand-cyan-text file:text-xs file:font-bold file:cursor-pointer hover:file:bg-primary/20"
                  required
                />
                {formMaterial.archivo && (
                  <p className="text-xs text-primary mt-2">📄 {formMaterial.archivo.name}</p>
                )}
              </div>

              <button
                type="submit"
                disabled={uploading || !formMaterial.titulo || !formMaterial.archivo}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-primary text-primary-foreground font-bold uppercase tracking-widest text-xs hover:bg-primary/80 transition-all duration-300 disabled:opacity-50"
              >
                {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                {uploading ? 'Subiendo...' : 'Subir Material'}
              </button>
            </form>
          </motion.div>

          {/* Lista Material */}
          <div>
            <h3 className="font-heading text-lg font-bold text-foreground mb-4">Material Existente</h3>
            {materiales.length === 0 ? (
              <div className="text-center py-12 glass-card">
                <FileText className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">No hay material subido aún.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {CATEGORIAS.map((cat) => {
                  const matsCat = materiales.filter((m) => m.categoria === cat);
                  if (matsCat.length === 0) return null;

                  return (
                    <div key={cat}>
                      <h4 className="font-semibold text-sm text-foreground mb-3 uppercase tracking-wider">
                        {cat}
                      </h4>
                      <div className="grid gap-3 mb-6">
                        {matsCat.map((mat) => (
                          <motion.div
                            key={mat.id}
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="glass-card p-4 flex items-start justify-between gap-4"
                          >
                            <div className="flex items-start gap-3 flex-1">
                              <FileText className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                              <div className="min-w-0 flex-1">
                                <p className="font-semibold text-sm text-foreground">{mat.titulo}</p>
                                {mat.archivo_nombre_original && (
                                  <p className="text-xs text-muted-foreground mt-1 break-all">
                                    Archivo: {mat.archivo_nombre_original}
                                  </p>
                                )}
                                <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground mt-1">
                                  {mat.archivo_tamano ? <span>{formatBytes(mat.archivo_tamano)}</span> : null}
                                  {mat.archivo_content_type ? <span>{mat.archivo_content_type}</span> : null}
                                </div>
                                {mat.descripcion && (
                                  <p className="text-xs text-muted-foreground mt-1">{mat.descripcion}</p>
                                )}
                              </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-2 shrink-0">
                              <button
                                type="button"
                                onClick={() => handlePreviewMaterial(mat)}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold border border-border-subtle text-muted-foreground hover:border-primary/40 hover:text-brand-cyan-text transition-all duration-200"
                              >
                                <ExternalLink className="w-3 h-3" />
                                Abrir
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDownloadMaterial(mat)}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold border border-primary/30 bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground transition-all duration-200"
                              >
                                <Download className="w-3 h-3" />
                                Descargar
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteMaterial(mat)}
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
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-8">
          {/* Form Añadir BOE */}
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass-card p-8">
            <h3 className="font-heading text-lg font-bold text-foreground mb-6 flex items-center gap-2">
              <Plus className="w-5 h-5 text-primary" />
              Añadir Publicación BOE
            </h3>

            <form onSubmit={handleAddBOE} className="space-y-5">
              <div>
                <label htmlFor="instructormaterial-field-5" className="block text-xs font-mono uppercase tracking-widest text-muted-foreground mb-2">
                  Título
                </label>
                <input id="instructormaterial-field-5"
                  type="text"
                  value={formBOE.titulo}
                  onChange={(e) => setFormBOE((prev) => ({ ...prev, titulo: e.target.value }))}
                  placeholder="Ej: RD 960/2020 — Nuevas normativas UAS"
                  className="w-full bg-surface-muted border border-border-subtle rounded px-3 py-2 text-sm text-foreground placeholder-muted-foreground focus:border-transparent focus:outline-none"
                  required
                />
              </div>

              <div>
                <label htmlFor="instructormaterial-field-6" className="block text-xs font-mono uppercase tracking-widest text-muted-foreground mb-2">
                  Fecha
                </label>
                <input id="instructormaterial-field-6"
                  type="date"
                  value={formBOE.fecha}
                  onChange={(e) => setFormBOE((prev) => ({ ...prev, fecha: e.target.value }))}
                  className="w-full bg-surface-muted border border-border-subtle rounded px-3 py-2 text-sm text-foreground focus:border-transparent focus:outline-none"
                  required
                />
              </div>

              <div>
                <label htmlFor="instructormaterial-field-7" className="block text-xs font-mono uppercase tracking-widest text-muted-foreground mb-2">
                  Resumen (opcional)
                </label>
                <textarea id="instructormaterial-field-7"
                  value={formBOE.resumen}
                  onChange={(e) => setFormBOE((prev) => ({ ...prev, resumen: e.target.value }))}
                  placeholder="Ej: Se actualizan los requisitos de operación en zonas pobladas..."
                  className="w-full bg-surface-muted border border-border-subtle rounded px-3 py-2 text-sm text-foreground placeholder-muted-foreground focus:border-transparent focus:outline-none h-20"
                />
              </div>

              <div>
                <label htmlFor="instructormaterial-field-8" className="block text-xs font-mono uppercase tracking-widest text-muted-foreground mb-2">
                  Enlace al BOE
                </label>
                <input id="instructormaterial-field-8"
                  type="url"
                  value={formBOE.url}
                  onChange={(e) => setFormBOE((prev) => ({ ...prev, url: e.target.value }))}
                  placeholder="https://www.boe.es/..."
                  className="w-full bg-surface-muted border border-border-subtle rounded px-3 py-2 text-sm text-foreground placeholder-muted-foreground focus:border-transparent focus:outline-none"
                  required
                />
              </div>

              <button
                type="submit"
                disabled={uploading || !formBOE.titulo || !formBOE.url}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-primary text-primary-foreground font-bold uppercase tracking-widest text-xs hover:bg-primary/80 transition-all duration-300 disabled:opacity-50"
              >
                {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                {uploading ? 'Añadiendo...' : 'Añadir Publicación'}
              </button>
            </form>
          </motion.div>

          {/* Lista BOE */}
          <div>
            <h3 className="font-heading text-lg font-bold text-foreground mb-4">Publicaciones Existentes</h3>
            {publicaciones.length === 0 ? (
              <div className="text-center py-12 glass-card">
                <FileText className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">No hay publicaciones añadidas aún.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {publicaciones.map((pub) => (
                  <motion.div
                    key={pub.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="glass-card p-4 flex items-start justify-between gap-4"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm text-foreground">{pub.titulo}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {pub.fecha_publicacion
                          ? new Date(pub.fecha_publicacion).toLocaleDateString('es-ES')
                          : '—'}
                      </p>
                      {pub.resumen && (
                        <p className="text-xs text-muted-foreground mt-2">{pub.resumen}</p>
                      )}
                    </div>
                    <button
                      onClick={() => handleDeleteBOE(pub.id)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-danger border border-danger-border bg-danger-soft/60 hover:bg-danger hover:text-danger-foreground transition-all duration-200 shrink-0"
                    >
                      <Trash2 className="w-3 h-3" />
                      Eliminar
                    </button>
                  </motion.div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <AlertDialog
        open={Boolean(materialToDelete)}
        onOpenChange={(open) => {
          if (!open && !deleteLoading) {
            setMaterialToDelete(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar este material?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción eliminará el archivo físico y el registro de <span className="font-semibold">{materialToDelete?.titulo}</span>.
              No se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteLoading}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDeleteMaterial}
              disabled={deleteLoading}
            >
              {deleteLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Eliminar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
