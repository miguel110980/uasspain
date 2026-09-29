import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { BookOpen, Edit3, ImagePlus, Loader2, Plus, Save, Trash2 } from 'lucide-react';
import contentService, { type Course, type CourseSection, type CourseStatus } from '@/services/contentService';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

type CourseForm = { name: string; slug: string; short_description: string; description: string; introduction: string; syllabus: string; status: CourseStatus; sort_order: number };

const EMPTY: CourseForm = { name: '', slug: '', short_description: '', description: '', introduction: '', syllabus: '', status: 'upcoming', sort_order: 0 };

export default function AdminCursos() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [form, setForm] = useState<CourseForm>({ ...EMPTY });
  const [editing, setEditing] = useState<Course | null>(null);
  const [section, setSection] = useState({ title: '', body: '', sort_order: 0 });
  const [editingSection, setEditingSection] = useState<CourseSection | null>(null);
  const [cover, setCover] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [pendingDelete, setPendingDelete] = useState<Course | null>(null);
  const coverRef = useRef<HTMLInputElement>(null);

  const load = async () => { setLoading(true); try { setCourses(await contentService.adminCourses()); setError(''); } catch (err) { setError(err?.response?.data?.detail || 'No se pudieron cargar los cursos.'); } finally { setLoading(false); } };
  useEffect(() => { load(); }, []);
  const reset = () => { setEditing(null); setForm({ ...EMPTY }); setSection({ title: '', body: '', sort_order: 0 }); setEditingSection(null); setCover(null); };
  const selectCourse = (course: Course) => { setEditing(course); setForm({ name: course.name, slug: course.slug, short_description: course.short_description || '', description: course.description || '', introduction: course.introduction || '', syllabus: course.syllabus || '', status: course.status, sort_order: course.sort_order || 0 }); setSection({ title: '', body: '', sort_order: course.sections?.length || 0 }); setEditingSection(null); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const saveCourse = async (event: React.FormEvent) => {
    event.preventDefault(); setSaving(true); setError('');
    try {
      const course = editing ? await contentService.updateCourse(editing.id, form) : await contentService.createCourse(form);
      if (cover) await contentService.uploadCourseCover(course.id, cover);
      reset(); await load();
    } catch (err) { setError(err?.response?.data?.detail || 'No se pudo guardar el curso.'); }
    finally { setSaving(false); }
  };
  const saveSection = async (event: React.FormEvent) => {
    event.preventDefault(); if (!editing) return;
    try { if (editingSection) await contentService.updateSection(editing.id, editingSection.id, section); else await contentService.createSection(editing.id, section); await load(); const fresh = (await contentService.adminCourses()).find((item) => item.id === editing.id); if (fresh) selectCourse(fresh); }
    catch (err) { setError(err?.response?.data?.detail || 'No se pudo guardar la sección.'); }
  };
  const removeSection = async (item: CourseSection) => { if (!editing || !window.confirm(`Eliminar únicamente la sección “${item.title}”?`)) return; try { await contentService.deleteSection(editing.id, item.id); const next = { ...editing, sections: (editing.sections || []).filter((value) => value.id !== item.id) }; setEditing(next); setCourses((current) => current.map((course) => course.id === next.id ? next : course)); } catch (err) { setError(err?.response?.data?.detail || 'No se pudo eliminar la sección.'); } };
  const confirmDelete = async () => { if (!pendingDelete) return; try { await contentService.deleteCourse(pendingDelete.id); setCourses((current) => current.filter((course) => course.id !== pendingDelete.id)); if (editing?.id === pendingDelete.id) reset(); } catch (err) { setError(err?.response?.data?.detail || 'No se pudo eliminar el curso.'); } finally { setPendingDelete(null); } };

  return <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
    <div><h2 className="font-heading text-xl font-bold flex items-center gap-2"><BookOpen className="w-5 h-5 text-primary" /> Formación / Cursos</h2><p className="text-xs text-muted-foreground mt-1">Cursos dinámicos con una plantilla pública compartida.</p></div>
    {error && <div role="alert" className="border border-danger/30 bg-danger/10 text-danger text-sm p-3 rounded">{error}</div>}
    <form onSubmit={saveCourse} className="glass-card p-5 space-y-4">
      <div className="flex justify-between"><h3 className="font-heading font-bold">{editing ? `Editar ${editing.name}` : 'Nuevo curso'}</h3>{editing && <button type="button" onClick={reset} className="text-xs text-muted-foreground hover:text-primary">Cancelar edición</button>}</div>
      <div className="grid md:grid-cols-2 gap-3"><input required maxLength={180} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Nombre" className="bg-surface-muted border border-border rounded px-3 py-2 text-sm" /><input maxLength={180} value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase() })} placeholder="slug-opcional" className="bg-surface-muted border border-border rounded px-3 py-2 text-sm" /></div>
      <textarea maxLength={320} rows={2} value={form.short_description} onChange={(e) => setForm({ ...form, short_description: e.target.value })} placeholder="Descripción breve" className="w-full bg-surface-muted border border-border rounded px-3 py-2 text-sm" />
      <textarea rows={4} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Descripción completa" className="w-full bg-surface-muted border border-border rounded px-3 py-2 text-sm" />
      <div className="grid md:grid-cols-2 gap-3"><textarea rows={4} value={form.introduction} onChange={(e) => setForm({ ...form, introduction: e.target.value })} placeholder="Introducción" className="bg-surface-muted border border-border rounded px-3 py-2 text-sm" /><textarea rows={4} value={form.syllabus} onChange={(e) => setForm({ ...form, syllabus: e.target.value })} placeholder="Temario" className="bg-surface-muted border border-border rounded px-3 py-2 text-sm" /></div>
      <div className="flex flex-wrap gap-3 items-center"><select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as CourseStatus })} className="bg-surface-muted border border-border rounded px-3 py-2 text-sm"><option value="upcoming">Próximamente</option><option value="published">Publicado</option></select><input type="number" min="0" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) })} className="w-24 bg-surface-muted border border-border rounded px-3 py-2 text-sm" aria-label="Orden" /><input ref={coverRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="sr-only" onChange={(e) => setCover(e.target.files?.[0] || null)} /><button type="button" onClick={() => coverRef.current?.click()} className="inline-flex items-center gap-2 px-3 py-2 border border-border rounded text-xs"><ImagePlus className="w-4 h-4" />{cover ? cover.name : 'Portada opcional'}</button><button disabled={saving} className="ml-auto inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-xs font-bold uppercase rounded disabled:opacity-50">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}Guardar</button></div>
    </form>
    {editing && <form onSubmit={saveSection} className="glass-card p-5 space-y-3"><h3 className="font-heading font-bold">Secciones de {editing.name}</h3><div className="grid md:grid-cols-[1fr_100px] gap-3"><input required value={section.title} onChange={(e) => setSection({ ...section, title: e.target.value })} placeholder="Título de sección" className="bg-surface-muted border border-border rounded px-3 py-2 text-sm" /><input type="number" min="0" value={section.sort_order} onChange={(e) => setSection({ ...section, sort_order: Number(e.target.value) })} className="bg-surface-muted border border-border rounded px-3 py-2 text-sm" /></div><textarea rows={5} value={section.body} onChange={(e) => setSection({ ...section, body: e.target.value })} placeholder="Contenido de la sección" className="w-full bg-surface-muted border border-border rounded px-3 py-2 text-sm" /><button className="inline-flex items-center gap-2 px-3 py-2 border border-primary/30 text-primary rounded text-xs"><Plus className="w-4 h-4" />{editingSection ? 'Guardar sección' : 'Añadir sección'}</button><div className="space-y-2">{(editing.sections || []).map((item) => <div key={item.id} className="flex gap-3 items-start p-3 border border-border rounded"><span className="text-xs font-mono text-primary">{item.sort_order}</span><div className="flex-1"><p className="font-medium text-sm">{item.title}</p><p className="text-xs text-muted-foreground line-clamp-2 whitespace-pre-wrap">{item.body}</p></div><button type="button" onClick={() => { setEditingSection(item); setSection({ title: item.title, body: item.body, sort_order: item.sort_order }); }} aria-label="Editar sección"><Edit3 className="w-4 h-4" /></button><button type="button" onClick={() => removeSection(item)} className="text-danger" aria-label="Eliminar sección"><Trash2 className="w-4 h-4" /></button></div>)}</div></form>}
    <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">{loading ? <Loader2 className="animate-spin text-primary" /> : courses.map((course) => <article key={course.id} className="glass-card overflow-hidden">{course.cover_image_url && <img src={course.cover_image_url} alt="" loading="lazy" className="w-full aspect-video object-cover" />}<div className="p-5"><div className="flex justify-between gap-2"><h3 className="font-heading font-bold">{course.name}</h3><span className={`text-[10px] uppercase font-bold ${course.status === 'published' ? 'text-success' : 'text-warning'}`}>{course.status === 'published' ? 'Publicado' : 'Próximamente'}</span></div><p className="text-sm text-muted-foreground mt-2 line-clamp-3">{course.short_description}</p><p className="text-[10px] font-mono text-muted-foreground mt-2">/{course.slug} · {(course.sections || []).length} secciones</p><div className="flex gap-2 mt-4"><button onClick={() => selectCourse(course)} className="inline-flex items-center gap-1 px-3 py-1.5 border border-border rounded text-xs"><Edit3 className="w-3.5 h-3.5" />Editar</button><button onClick={() => setPendingDelete(course)} className="ml-auto inline-flex items-center gap-1 px-3 py-1.5 border border-danger/30 text-danger rounded text-xs"><Trash2 className="w-3.5 h-3.5" />Eliminar</button></div></div></article>)}</div>
    <AlertDialog open={Boolean(pendingDelete)} onOpenChange={(open) => !open && setPendingDelete(null)}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Eliminar curso</AlertDialogTitle><AlertDialogDescription>Se eliminará únicamente “{pendingDelete?.name}”, sus secciones y su portada gestionada.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction onClick={confirmDelete} className="bg-danger text-white hover:bg-danger/90">Eliminar curso</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </motion.div>;
}
