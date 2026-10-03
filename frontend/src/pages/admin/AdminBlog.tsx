import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Edit3, Eye, EyeOff, ImagePlus, Loader2, Newspaper, Plus, Save, Trash2, X } from 'lucide-react';
import contentService, { type BlogPost, type ContentStatus } from '@/services/contentService';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

type BlogForm = { title: string; body: string; status: ContentStatus; sort_order: number };

const EMPTY: BlogForm = { title: '', body: '', status: 'published', sort_order: 0 };
const MAX_IMAGES = 12;
const MAX_BYTES = 10 * 1024 * 1024;

export default function AdminBlog() {
  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [form, setForm] = useState<BlogForm>({ ...EMPTY });
  const [editing, setEditing] = useState<BlogPost | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [pendingDelete, setPendingDelete] = useState<BlogPost | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const previews = useMemo(() => files.map((file) => ({ file, url: URL.createObjectURL(file) })), [files]);
  useEffect(() => () => previews.forEach(({ url }) => URL.revokeObjectURL(url)), [previews]);

  const load = async () => {
    setLoading(true);
    try { setPosts(await contentService.adminPosts()); setError(''); }
    catch (err) { setError(err?.response?.data?.detail || 'No se pudieron cargar las publicaciones.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const reset = () => { setForm({ ...EMPTY }); setEditing(null); setFiles([]); if (inputRef.current) inputRef.current.value = ''; };
  const chooseFiles = (event: React.ChangeEvent<HTMLInputElement>) => {
    const incoming = Array.from(event.target.files || []);
    const valid = incoming.filter((file) => file.type.startsWith('image/') && file.size > 0 && file.size <= MAX_BYTES);
    setFiles((current) => [...current, ...valid].slice(0, MAX_IMAGES));
    event.target.value = '';
    if (valid.length !== incoming.length) setError('Se omitieron imágenes vacías, no válidas o mayores de 10 MB.');
  };
  const edit = (post: BlogPost) => {
    setEditing(post);
    setForm({ title: post.title || '', body: post.body, status: post.status, sort_order: post.sort_order || 0 });
    setFiles([]);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.body.trim()) { setError('Escribe el contenido de la publicación.'); return; }
    if ((editing?.images.length || 0) + files.length > MAX_IMAGES) { setError(`Máximo ${MAX_IMAGES} imágenes por publicación.`); return; }
    setSaving(true); setError('');
    try {
      const post = editing
        ? await contentService.updatePost(editing.id, form)
        : await contentService.createPost(form);
      for (const file of files) await contentService.addPostImage(post.id, file, form.title || 'Imagen de la publicación');
      reset(); await load();
    } catch (err) { setError(err?.response?.data?.detail || 'No se pudo guardar la publicación.'); }
    finally { setSaving(false); }
  };
  const removeExistingImage = async (postId: string, imageId: string) => {
    try { await contentService.deletePostImage(postId, imageId); await load(); if (editing?.id === postId) setEditing((current) => current ? { ...current, images: current.images.filter((image) => image.id !== imageId) } : null); }
    catch (err) { setError(err?.response?.data?.detail || 'No se pudo eliminar la imagen.'); }
  };
  const togglePublished = async (post: BlogPost) => {
    try { await contentService.updatePost(post.id, { status: post.status === 'published' ? 'draft' : 'published' }); await load(); }
    catch (err) { setError(err?.response?.data?.detail || 'No se pudo cambiar el estado.'); }
  };
  const confirmDelete = async () => {
    if (!pendingDelete) return;
    try { await contentService.deletePost(pendingDelete.id); setPosts((current) => current.filter((post) => post.id !== pendingDelete.id)); if (editing?.id === pendingDelete.id) reset(); }
    catch (err) { setError(err?.response?.data?.detail || 'No se pudo eliminar la publicación.'); }
    finally { setPendingDelete(null); }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
      <div><h2 className="font-heading text-xl font-bold flex items-center gap-2"><Newspaper className="w-5 h-5 text-primary" /> Blog / Publicaciones</h2><p className="text-xs text-muted-foreground mt-1">Publica bloques independientes con texto y fotografías opcionales.</p></div>
      {error && <div role="alert" className="border border-danger/30 bg-danger/10 text-danger text-sm p-3 rounded">{error}</div>}
      <form onSubmit={save} className="glass-card p-5 space-y-4">
        <div className="flex items-center justify-between"><h3 className="font-heading font-bold">{editing ? 'Editar publicación' : 'Nueva publicación'}</h3>{editing && <button type="button" onClick={reset} className="text-xs text-muted-foreground hover:text-primary">Cancelar edición</button>}</div>
        <input aria-label="Título de la publicación" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} maxLength={180} placeholder="Título opcional" className="w-full bg-surface-muted border border-border rounded px-3 py-2 text-sm" />
        <textarea aria-label="Contenido de la publicación" value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} maxLength={50000} rows={7} placeholder="Escribe o pega el texto de la publicación…" className="w-full bg-surface-muted border border-border rounded px-3 py-2 text-sm resize-y" required />
        <div className="flex flex-wrap gap-3 items-center">
          <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple onChange={chooseFiles} className="sr-only" />
          <button type="button" onClick={() => inputRef.current?.click()} aria-label="Añadir imágenes" className="w-11 h-11 border border-dashed border-primary/50 text-primary rounded flex items-center justify-center hover:bg-primary/10"><Plus className="w-6 h-6" /></button>
          <span className="text-xs text-muted-foreground"><ImagePlus className="inline w-4 h-4 mr-1" />Imágenes opcionales · {files.length + (editing?.images.length || 0)}/{MAX_IMAGES}</span>
          <select aria-label="Estado de la publicación" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as ContentStatus })} className="ml-auto bg-surface-muted border border-border rounded px-3 py-2 text-sm"><option value="published">Publicado</option><option value="draft">Borrador</option></select>
        </div>
        {(editing?.images.length || previews.length > 0) && <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
          {editing?.images.map((image) => <div key={image.id} className="relative aspect-video"><img src={image.url} alt={image.alt_text || ''} className="w-full h-full object-cover rounded border border-border" /><button type="button" onClick={() => removeExistingImage(editing.id, image.id)} className="absolute -top-2 -right-2 bg-danger text-white rounded-full p-1" aria-label="Quitar imagen"><X className="w-3 h-3" /></button></div>)}
          {previews.map(({ file, url }, index) => <div key={`${file.name}-${file.lastModified}-${index}`} className="relative aspect-video"><img src={url} alt="Vista previa" className="w-full h-full object-cover rounded border border-border" /><button type="button" onClick={() => setFiles((current) => current.filter((_, i) => i !== index))} className="absolute -top-2 -right-2 bg-danger text-white rounded-full p-1" aria-label="Quitar selección"><X className="w-3 h-3" /></button></div>)}
        </div>}
        <div className="flex gap-2"><button disabled={saving} className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-xs font-bold uppercase tracking-widest rounded disabled:opacity-50">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}{editing ? 'Guardar cambios' : 'Publicar'}</button><button type="button" onClick={reset} className="px-4 py-2 border border-border text-xs uppercase rounded">Restablecer</button></div>
      </form>
      <div className="space-y-4">
        <h3 className="font-heading font-bold">Bloques publicados</h3>
        {loading ? <Loader2 className="w-6 h-6 animate-spin text-primary" /> : posts.length === 0 ? <div className="glass-card p-8 text-center text-sm text-muted-foreground">No hay publicaciones.</div> : posts.map((post) => <article key={post.id} className="glass-card p-5">
          <div className="flex flex-col md:flex-row gap-4"><div className="flex-1 min-w-0"><div className="flex items-center gap-2 mb-2"><span className={`text-[10px] uppercase font-bold px-2 py-1 border rounded ${post.status === 'published' ? 'text-success border-success/30' : 'text-warning border-warning/30'}`}>{post.status === 'published' ? 'Publicado' : 'Borrador'}</span><span className="text-[10px] text-muted-foreground">{new Date(post.created_at).toLocaleString('es-ES')}</span></div>{post.title && <h4 className="font-heading font-bold mb-2">{post.title}</h4>}<p className="text-sm text-muted-foreground whitespace-pre-wrap line-clamp-5">{post.body}</p></div>{post.images.length > 0 && <div className="grid grid-cols-3 gap-2 md:w-64">{post.images.slice(0, 6).map((image) => <img key={image.id} src={image.url} alt={image.alt_text || ''} loading="lazy" className="aspect-square w-full object-cover rounded" />)}</div>}</div>
          <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-border"><button onClick={() => edit(post)} className="inline-flex items-center gap-1 px-3 py-1.5 border border-border rounded text-xs hover:text-primary"><Edit3 className="w-3.5 h-3.5" />Editar</button><button onClick={() => togglePublished(post)} className="inline-flex items-center gap-1 px-3 py-1.5 border border-border rounded text-xs hover:text-primary">{post.status === 'published' ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}{post.status === 'published' ? 'Despublicar' : 'Publicar'}</button><button onClick={() => setPendingDelete(post)} className="inline-flex items-center gap-1 px-3 py-1.5 border border-danger/30 text-danger rounded text-xs ml-auto"><Trash2 className="w-3.5 h-3.5" />Eliminar</button></div>
        </article>)}
      </div>
      <AlertDialog open={Boolean(pendingDelete)} onOpenChange={(open) => !open && setPendingDelete(null)}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Eliminar esta publicación</AlertDialogTitle><AlertDialogDescription>Se eliminará únicamente “{pendingDelete?.title || pendingDelete?.body.slice(0, 60)}” y sus imágenes asociadas.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction onClick={confirmDelete} className="bg-danger text-white hover:bg-danger/90">Eliminar bloque</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    </motion.div>
  );
}
