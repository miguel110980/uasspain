import SuccessNotice from '@/components/ui/SuccessNotice';
import React, { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { ArrowDown, ArrowUp, BookOpen, Edit3, Loader2, Plus, Save, Trash2 } from 'lucide-react';
import contentService, { type Course, type CourseStatus } from '@/services/contentService';
import { COURSE_CATEGORIES, courseCategoryLabel, type CourseCategory } from '@/lib/courseCategories';
import { COURSE_MODALITIES, courseModalityLabel, type CourseModality } from '@/lib/courseModalities';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';

type Topic = { key: string; id?: string; title: string; body: string };
type CourseForm = { name: string; description: string; category: CourseCategory; modality: CourseModality; duration: string; status: CourseStatus; topics: Topic[] };
const emptyForm = (): CourseForm => ({ name: '', description: '', category: 'other', modality: 'online', duration: '', status: 'upcoming', topics: [] });
const fieldClass = 'w-full min-w-0 mt-2 bg-surface-muted border border-border rounded px-3 py-2 text-sm focus-visible:outline-primary';
const errorText = (error: unknown, fallback: string) => (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail || fallback;

export default function AdminCursos({ active = true }: { active?: boolean }) {
  const queryClient = useQueryClient();
  const { data: courses = [], isPending: loading, isFetching, isError, error: loadError, refetch } = useQuery({
    queryKey: ['admin', 'courses'], queryFn: contentService.adminCourses, enabled: active,
    staleTime: 0, refetchOnWindowFocus: true, refetchInterval: 30_000, retry: false,
  });
  const setCourses = (update: (current: Course[]) => Course[]) => queryClient.setQueryData<Course[]>(['admin', 'courses'], current => update(current || []));
  const [form, setForm] = useState<CourseForm>(emptyForm);
  const [editing, setEditing] = useState<Course | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pendingDelete, setPendingDelete] = useState<Course | null>(null);
  const savingLock = useRef(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const load = async () => {
    const result = await refetch();
    if (!result.isError) setError('');
  };
  const displayError = error || (isError ? errorText(loadError, 'No se pudieron cargar los cursos.') : '');
  const reset = () => { setEditing(null); setForm(emptyForm()); };
  const selectCourse = (course: Course) => {
    const description = [...new Set([course.introduction?.trim(), course.description?.trim() || course.short_description?.trim()].filter(Boolean))].join('\n\n');
    const topics: Topic[] = (course.sections || []).map(topic => ({ key: topic.id, id: topic.id, title: topic.title, body: topic.body }));
    if (course.syllabus?.trim()) topics.unshift({ key: crypto.randomUUID(), title: 'Temario', body: course.syllabus.trim() });
    setEditing(course); setForm({ name: course.name, description, category: course.category, modality: course.modality, duration: course.duration, status: course.status, topics });
    setError(''); setNotice(''); nameRef.current?.focus();
  };
  const changeTopic = (key: string, patch: Partial<Topic>) => setForm(current => ({ ...current, topics: current.topics.map(topic => topic.key === key ? { ...topic, ...patch } : topic) }));
  const moveTopic = (index: number, delta: number) => setForm(current => {
    const topics = [...current.topics]; const target = index + delta;
    if (target >= 0 && target < topics.length) [topics[index], topics[target]] = [topics[target], topics[index]];
    return { ...current, topics };
  });
  const saveCourse = async (event: React.FormEvent) => {
    event.preventDefault(); if (savingLock.current) return;
    if (!form.name.trim() || !form.description.trim() || form.topics.some(topic => !topic.title.trim())) {
      setError('Introduce un nombre, una descripción y un título para cada tema.'); return;
    }
    savingLock.current = true; setSaving(true); setError(''); setNotice('');
    try {
      const payload = { name: form.name.trim(), description: form.description.trim(), category: form.category, modality: form.modality, duration: form.duration.trim(), status: form.status,
        sections: form.topics.map((topic, sort_order) => ({ ...(topic.id ? { id: topic.id } : {}), title: topic.title.trim(), body: topic.body.trim(), sort_order })), introduction: '', syllabus: '' };
      const course = editing ? await contentService.updateCourse(editing.id, payload, editing.version) : await contentService.createCourse(payload);
      setCourses(current => [...current.filter(item => item.id !== course.id), course].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)));
      reset(); setNotice('Curso guardado correctamente.');
    } catch (err) { setError(errorText(err, 'No se pudo guardar el curso. Vuelve a intentarlo.')); }
    finally { savingLock.current = false; setSaving(false); }
  };
  const moveCourse = async (index: number, delta: number) => {
    if (savingLock.current) return; const target = index + delta; if (target < 0 || target >= courses.length) return;
    savingLock.current = true; setSaving(true); setError('');
    try { const ordered = [...courses]; [ordered[index], ordered[target]] = [ordered[target], ordered[index]]; await contentService.reorder('courses', ordered.map((course, sort_order) => ({ id: course.id, version: course.version, sort_order }))); await load(); }
    catch (err) { setError(errorText(err, 'No se pudo actualizar el orden.')); }
    finally { savingLock.current = false; setSaving(false); }
  };
  const toggleCourse = async (course: Course) => {
    if (savingLock.current) return; savingLock.current = true; setSaving(true); setError('');
    try { await contentService.updateCourse(course.id, { status: course.status === 'published' ? 'draft' : 'published' }, course.version); await load(); }
    catch (err) { setError(errorText(err, 'No se pudo cambiar el estado.')); }
    finally { savingLock.current = false; setSaving(false); }
  };
  const confirmDelete = async () => {
    if (!pendingDelete || deleting) return; setDeleting(true); setError(''); setNotice('');
    try {
      await contentService.deleteCourse(pendingDelete.id, pendingDelete.version);
      setCourses(current => current.filter(course => course.id !== pendingDelete.id));
      if (editing?.id === pendingDelete.id) reset();
      setPendingDelete(null); setNotice('Curso eliminado correctamente.');
    } catch (err) { setError(errorText(err, 'No se pudo eliminar el curso. Vuelve a intentarlo.')); }
    finally { setDeleting(false); }
  };
  return <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-6 min-w-0 break-words">
    <div><h2 className="font-heading text-xl font-bold flex items-center gap-2"><BookOpen className="w-5 h-5 text-primary shrink-0" />Formación / Cursos</h2><p className="text-xs text-muted-foreground mt-1">Gestiona el contenido y la publicación de tus cursos.</p></div>
    {displayError && <div role="alert" className="border border-danger/30 bg-danger/10 text-danger text-sm p-3 rounded">{displayError}{!saving && <button type="button" onClick={load} className="underline ml-2">Actualizar listado</button>}</div>}
    {notice && <SuccessNotice message={notice} onDismiss={() => setNotice('')} />}
    <form onSubmit={saveCourse} className="glass-card p-5 space-y-5" aria-label={editing ? 'Editar curso' : 'Nuevo curso'}>
      <div className="flex flex-wrap justify-between gap-3"><h3 className="font-heading font-bold">{editing ? `Editar ${editing.name}` : 'Nuevo curso'}</h3>{editing && <button type="button" disabled={saving} onClick={reset} className="text-xs text-muted-foreground hover:text-brand-cyan-text">Cancelar edición</button>}</div>
      <fieldset disabled={saving} className="space-y-5 min-w-0">
        <div className="grid md:grid-cols-2 gap-4">
          <label className="block text-sm font-medium" htmlFor="course-name">Nombre del curso<input ref={nameRef} id="course-name" required maxLength={180} value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} className={fieldClass} /></label>
          <div><label htmlFor="course-category" className="block text-sm font-medium">Categoría</label><select id="course-category" required value={form.category} onChange={event => setForm({ ...form, category: event.target.value as CourseCategory })} className={fieldClass}>{COURSE_CATEGORIES.map(category => <option key={category.value} value={category.value}>{category.label}</option>)}</select></div>
        </div>
        <label className="block text-sm font-medium" htmlFor="course-description">Descripción<textarea id="course-description" required maxLength={100000} rows={5} value={form.description} onChange={event => setForm({ ...form, description: event.target.value })} className={fieldClass} /></label>
        <fieldset className="space-y-3 min-w-0"><legend className="text-sm font-medium mb-2">Temario</legend>
          {form.topics.map((topic, index) => <div key={topic.key} className="border border-border rounded p-3 space-y-3 min-w-0">
            <label htmlFor={`topic-${topic.key}`} className="block text-sm">Tema {index + 1}<input id={`topic-${topic.key}`} required maxLength={180} value={topic.title} onChange={event => changeTopic(topic.key, { title: event.target.value })} className={fieldClass} /></label>
            <label htmlFor={`topic-body-${topic.key}`} className="block text-xs text-muted-foreground">Contenido del tema {index + 1}<textarea id={`topic-body-${topic.key}`} rows={3} maxLength={100000} value={topic.body} onChange={event => changeTopic(topic.key, { body: event.target.value })} className={fieldClass} /></label>
            <div className="flex flex-wrap gap-2"><button type="button" disabled={index === 0} onClick={() => moveTopic(index, -1)} aria-label={`Subir tema ${index + 1}`} className="p-2 border border-border rounded disabled:opacity-40"><ArrowUp className="w-4 h-4" /></button><button type="button" disabled={index === form.topics.length - 1} onClick={() => moveTopic(index, 1)} aria-label={`Bajar tema ${index + 1}`} className="p-2 border border-border rounded disabled:opacity-40"><ArrowDown className="w-4 h-4" /></button><button type="button" onClick={() => setForm(current => ({ ...current, topics: current.topics.filter(item => item.key !== topic.key) }))} aria-label={`Eliminar tema ${index + 1}`} className="inline-flex items-center gap-2 px-3 py-2 border border-danger/30 text-danger rounded text-xs"><Trash2 className="w-4 h-4" />Eliminar</button></div>
          </div>)}
          <button type="button" disabled={form.topics.length >= 100} onClick={() => setForm(current => ({ ...current, topics: [...current.topics, { key: crypto.randomUUID(), title: '', body: '' }] }))} className="inline-flex items-center gap-2 px-3 py-2 border border-primary/30 text-primary rounded text-xs"><Plus className="w-4 h-4" />Añadir tema</button>
        </fieldset>
        <div className="grid md:grid-cols-3 gap-4">
          <div><label htmlFor="course-modality" className="block text-sm font-medium">Modalidad</label><select id="course-modality" required value={form.modality} onChange={event => setForm({ ...form, modality: event.target.value as CourseModality })} className={fieldClass}>{COURSE_MODALITIES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></div>
          <label htmlFor="course-duration" className="block text-sm font-medium">Duración<input id="course-duration" type="text" maxLength={120} value={form.duration} onChange={event => setForm({ ...form, duration: event.target.value })} placeholder="Ej. 40 horas o 3 semanas" className={fieldClass} /></label>
          <div><label htmlFor="course-status" className="block text-sm font-medium">Estado</label><select id="course-status" required value={form.status} onChange={event => setForm({ ...form, status: event.target.value as CourseStatus })} aria-describedby="course-status-help" className={fieldClass}><option value="draft">Borrador</option><option value="upcoming">Próximamente</option><option value="published">Publicado</option></select><p id="course-status-help" className="mt-2 text-xs text-muted-foreground">Borrador queda oculto. Publicado muestra el contenido completo; Próximamente muestra un aviso hasta su publicación.</p></div>
        </div>
      </fieldset>
      <button disabled={saving || loading} className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-xs font-bold uppercase rounded disabled:opacity-50">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}Guardar</button>
    </form>
    <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-heading font-bold">Cursos guardados ({courses.length})</h3><button type="button" disabled={isFetching || saving} onClick={() => void load()} className="inline-flex items-center gap-2 px-3 py-2 border border-border rounded text-xs disabled:opacity-50">{isFetching && <Loader2 className="w-3.5 h-3.5 animate-spin" />}Actualizar cursos</button></div>
    <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4" aria-busy={isFetching}>{loading ? <Loader2 aria-label="Cargando cursos" className="animate-spin text-primary" /> : courses.length === 0 ? <p className="text-sm text-muted-foreground">Todavía no hay cursos guardados.</p> : courses.map((course, index) => <article key={course.id} className="glass-card p-5 min-w-0 space-y-3">
      <h3 className="font-heading font-bold">{course.name}</h3><p className="text-sm text-muted-foreground line-clamp-3">{course.description || course.short_description}</p>
      <dl className="text-xs space-y-2"><div><dt className="inline text-muted-foreground">Categoría: </dt><dd className="inline">{courseCategoryLabel(course.category)}</dd></div><div><dt className="inline text-muted-foreground">Modalidad: </dt><dd className="inline">{courseModalityLabel(course.modality)}</dd></div><div><dt className="inline text-muted-foreground">Duración: </dt><dd className="inline">{course.duration || 'Sin especificar'}</dd></div><div><dt className="inline text-muted-foreground">Estado: </dt><dd className={`inline font-bold ${course.status === 'published' ? 'text-success' : 'text-warning'}`}>{course.status === 'published' ? 'Publicado' : course.status === 'draft' ? 'Borrador' : 'Próximamente'}</dd></div></dl>
      <div className="flex flex-wrap gap-2"><button disabled={saving} onClick={() => selectCourse(course)} className="inline-flex items-center gap-1 px-3 py-1.5 border border-border rounded text-xs"><Edit3 className="w-3.5 h-3.5" />Editar</button><button disabled={saving} onClick={() => void toggleCourse(course)} className="px-3 py-1.5 border border-border rounded text-xs">{course.status === 'published' ? 'Despublicar' : 'Publicar'}</button><button disabled={saving || index === 0} onClick={() => void moveCourse(index, -1)} aria-label={`Subir ${course.name}`} className="border border-border rounded p-2"><ArrowUp className="w-4 h-4" /></button><button disabled={saving || index === courses.length - 1} onClick={() => void moveCourse(index, 1)} aria-label={`Bajar ${course.name}`} className="border border-border rounded p-2"><ArrowDown className="w-4 h-4" /></button><button disabled={saving || deleting} onClick={() => setPendingDelete(course)} className="inline-flex items-center gap-1 px-3 py-1.5 border border-danger/30 text-danger rounded text-xs"><Trash2 className="w-3.5 h-3.5" />Eliminar</button></div>
    </article>)}</div>
    <AlertDialog open={Boolean(pendingDelete)} onOpenChange={open => !open && !deleting && setPendingDelete(null)}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Eliminar curso</AlertDialogTitle><AlertDialogDescription>Se eliminará “{pendingDelete?.name}” y su temario. Esta acción no se puede deshacer.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel><AlertDialogAction disabled={deleting} onClick={event => { event.preventDefault(); void confirmDelete(); }} className="bg-destructive text-destructive-foreground hover:bg-danger/90">{deleting ? 'Eliminando…' : 'Eliminar curso'}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </motion.div>;
}
