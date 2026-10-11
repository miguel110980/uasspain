import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Edit3, Eye, EyeOff, Loader2, Plus, Save, Shield, Trash2 } from 'lucide-react';
import contentService, { type ManagedService, type ServiceInput, type ServiceNode } from '@/services/contentService';
import { ServicePresentation } from '@/lib/servicePresentation';
import { SERVICE_ICONS } from '@/lib/serviceIcons';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';

const empty = (): ServiceInput => ({ title: '', slug: '', short_description: '', description: '', icon: 'Shield', coordinate: '', image_url: '', action_href: '', status: 'draft', sort_order: 0, presentation: {}, seo: {} });
const field = 'w-full min-w-0 mt-2 bg-surface-muted border border-border rounded px-3 py-2 text-sm focus-visible:outline-primary';
const errorText = (error: unknown) => (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'No se pudo completar la operación. Vuelve a intentarlo.';
function textNodes(nodes: ServiceNode[], prefix = ''): { path: string; value: string }[] {
  return nodes.flatMap((node, i) => { const path = prefix ? `${prefix}.${i}` : String(i); return typeof node === 'string' ? (node.trim() ? [{ path, value: node }] : []) : textNodes(node.children, path); });
}
function changeText(nodes: ServiceNode[], path: number[], text: string): ServiceNode[] {
  return nodes.map((node, index) => index !== path[0] ? node : path.length === 1 ? text : typeof node === 'string' ? node : { ...node, children: changeText(node.children, path.slice(1), text) });
}

export default function AdminServicios({ active = true }: { active?: boolean }) {
  const query = useQuery({ queryKey: ['admin', 'services'], queryFn: contentService.adminServices, enabled: active, staleTime: 0, retry: false });
  const services = query.data || [];
  const imageQuery = useQuery({ queryKey: ['admin', 'content-images'], queryFn: contentService.adminImages, enabled: active, staleTime: 0, retry: false });
  const [form, setForm] = useState<ServiceInput>(empty);
  const [editing, setEditing] = useState<ManagedService | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [preview, setPreview] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ManagedService | null>(null);
  const reset = () => { setForm(empty()); setEditing(null); setFile(null); setPreview(false); };
  const edit = (service: ManagedService) => {
    const { title, slug, short_description, description, icon, coordinate, image_url, action_href, status, sort_order, presentation, seo } = service;
    setEditing(service); setForm({ title, slug, short_description, description, icon, coordinate, image_url, action_href, status, sort_order, presentation: structuredClone(presentation), seo: { ...seo } }); setFile(null); setError(''); setNotice('');
  };
  const run = async (action: () => Promise<void>) => {
    if (lock.current) return; lock.current = true; setBusy(true); setError(''); setNotice('');
    try { await action(); await query.refetch(); }
    catch (err) { setError(errorText(err)); }
    finally { lock.current = false; setBusy(false); }
  };
  const save = (event: React.FormEvent) => {
    event.preventDefault(); void run(async () => {
      const input = { ...form, action_href: form.action_href || `/servicios/${form.slug}` };
      let saved = editing ? await contentService.updateService(editing.id, input, editing.version) : await contentService.createService(input);
      // Keep the committed record in the form if a subsequent upload fails;
      // retrying never creates a second service or repeats a stale update.
      edit(saved);
      if (file) { saved = await contentService.uploadServiceImage(saved.id, file, saved.version); edit(saved); }
      setNotice('Servicio guardado correctamente.');
    });
  };
  const move = (index: number, delta: number) => void run(async () => {
    const target = index + delta; if (target < 0 || target >= services.length) return;
    const ordered = [...services]; [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
    await contentService.reorder('services', ordered.map((service, sort_order) => ({ id: service.id, version: service.version, sort_order })));
  });
  const changed = editing && services.find(service => service.id === editing.id)?.version !== editing.version;
  const previewService = { ...editing, ...form, id: editing?.id || 'preview', version: editing?.version || 1 } as ManagedService;
  const resources = [...new Set([...(imageQuery.data || []).map(image => image.url), ...services.map(s => s.image_url)].filter(Boolean))];
  return <div className="space-y-6 min-w-0 break-words">
    <div><h2 className="font-heading text-xl font-bold flex items-center gap-2"><Shield className="w-5 h-5 text-primary" />Servicios</h2><p className="text-xs text-muted-foreground mt-1">Gestiona los servicios y su visibilidad pública.</p></div>
    {(error || query.isError) && <div role="alert" className="border border-danger/30 bg-danger/10 text-danger text-sm p-3 rounded">{error || errorText(query.error)} <button onClick={() => void query.refetch()} className="underline">Actualizar listado</button></div>}
    {notice && <p role="status" className="text-sm text-success">{notice}</p>}
    {changed && <p role="alert" className="text-warning text-sm">Otro administrador ha cambiado este servicio. Tu edición se conserva; revisa la versión actual antes de guardar.</p>}
    <form onSubmit={save} aria-label={editing ? 'Editar servicio' : 'Nuevo servicio'} className="glass-card p-5 space-y-4">
      <div className="flex flex-wrap justify-between gap-2"><h3 className="font-heading font-bold min-w-0 max-w-full break-words">{editing ? `Editar ${editing.title}` : 'Nuevo servicio'}</h3><button type="button" disabled={busy} onClick={reset} className="text-sm text-primary"><Plus className="inline w-4 h-4" />Nuevo servicio</button></div>
      <fieldset disabled={busy} className="space-y-4 min-w-0">
        <div className="grid md:grid-cols-2 gap-4"><label className="text-sm">Título<input required maxLength={180} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} className={field} /></label><label className="text-sm">Slug<input required pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={180} value={form.slug} onChange={e => setForm({ ...form, slug: e.target.value, action_href: form.action_href === `/servicios/${form.slug}` ? `/servicios/${e.target.value}` : form.action_href })} className={field} /></label></div>
        <label className="block text-sm">Descripción corta<textarea maxLength={600} rows={3} value={form.short_description} onChange={e => setForm({ ...form, short_description: e.target.value })} className={field} /></label>
        <label className="block text-sm">Descripción completa<textarea maxLength={100000} rows={6} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className={field} /></label>
        <div className="grid md:grid-cols-3 gap-4"><label className="text-sm">Icono<select value={form.icon} onChange={e => setForm({ ...form, icon: e.target.value })} className={field}>{Object.keys(SERVICE_ICONS).map(icon => <option key={icon}>{icon}</option>)}</select></label><label className="text-sm">Coordenada<input maxLength={80} value={form.coordinate} onChange={e => setForm({ ...form, coordinate: e.target.value })} className={field} /></label><label className="text-sm">Orden<input type="number" min={0} max={2147483647} value={form.sort_order} onChange={e => setForm({ ...form, sort_order: Number(e.target.value) })} className={field} /></label></div>
        <label className="block text-sm">Enlace de acción<input maxLength={600} value={form.action_href} onChange={e => setForm({ ...form, action_href: e.target.value })} placeholder={`/servicios/${form.slug || 'slug'}`} className={field} /></label>
        <div className="grid md:grid-cols-2 gap-4"><label className="text-sm">Estado<select value={form.status} onChange={e => setForm({ ...form, status: e.target.value as 'draft' | 'published' })} className={field}><option value="draft">Borrador</option><option value="published">Publicado</option></select></label><label className="text-sm">Imagen<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={e => { const selected = e.target.files?.[0]; if (selected && (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(selected.type) || selected.size === 0 || selected.size > 10 * 1024 * 1024)) { setError('Selecciona una imagen válida de hasta 10 MB.'); e.target.value = ''; return; } setFile(selected || null); }} className={field} /></label></div>
        <label className="block text-sm">Reutilizar imagen<select value={form.image_url} onChange={e => { setForm({ ...form, image_url: e.target.value }); setFile(null); }} className={field}><option value="">Sin imagen</option>{[...new Set([...resources, form.image_url].filter(Boolean))].map(url => <option key={url} value={url}>{url}</option>)}</select></label>
        {form.image_url && <img src={form.image_url} alt="Imagen actual del servicio" className="max-h-40 max-w-full object-contain" />}
        <details><summary className="cursor-pointer text-sm">Contenido complementario y SEO</summary><div className="space-y-4 mt-4">
          {(['title', 'description', 'keywords'] as const).map(key => <label key={key} className="block text-sm">SEO {key}<input maxLength={600} value={form.seo?.[key] || ''} onChange={e => setForm({ ...form, seo: { ...form.seo, [key]: e.target.value } })} className={field} /></label>)}
          {textNodes(form.presentation?.layout || []).map(({ path, value }, index) => <label key={path} className="block text-sm">Texto complementario {index + 1}<textarea rows={2} value={value} onChange={e => setForm({ ...form, presentation: { ...form.presentation, layout: changeText(form.presentation?.layout || [], path.split('.').map(Number), e.target.value) } })} className={field} /></label>)}
        </div></details>
      </fieldset>
      <div className="flex flex-wrap gap-3"><button disabled={busy || changed} className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-xs font-bold uppercase rounded disabled:opacity-50">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}Guardar servicio</button><button type="button" onClick={() => setPreview(!preview)} className="px-4 py-2 border border-border rounded text-sm"><Eye className="inline w-4 h-4 mr-2" />Vista previa</button></div>
    </form>
    {preview && <section aria-label="Vista previa del servicio" className="border border-border overflow-hidden"><ServicePresentation service={previewService} /></section>}
    <h3 className="font-heading font-bold">Servicios guardados ({services.length})</h3>
    <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4" aria-busy={query.isFetching}>{query.isPending ? <Loader2 className="w-6 h-6 animate-spin" aria-label="Cargando servicios" /> : services.map((service, index) => <article key={service.id} className="glass-card p-5 min-w-0 space-y-3"><h4 className="font-heading font-bold">{service.title}</h4><p className="text-sm text-muted-foreground line-clamp-3">{service.short_description}</p><span className={`text-xs ${service.status === 'published' ? 'text-success' : 'text-warning'}`}>{service.status === 'published' ? 'Publicado' : 'Borrador'}</span><div className="flex flex-wrap gap-2"><button disabled={busy} onClick={() => edit(service)} className="border border-border rounded px-3 py-2 text-xs"><Edit3 className="inline w-3.5 h-3.5 mr-1" />Editar</button><button disabled={busy} onClick={() => void run(async () => { await contentService.updateService(service.id, { status: service.status === 'published' ? 'draft' : 'published' }, service.version); })} className="border border-border rounded px-3 py-2 text-xs">{service.status === 'published' ? <EyeOff className="inline w-3.5 h-3.5 mr-1" /> : <Eye className="inline w-3.5 h-3.5 mr-1" />}{service.status === 'published' ? 'Despublicar' : 'Publicar'}</button><button disabled={busy || index === 0} onClick={() => move(index, -1)} aria-label={`Subir ${service.title}`} className="border border-border rounded p-2 disabled:opacity-30"><ArrowUp className="w-4 h-4" /></button><button disabled={busy || index === services.length - 1} onClick={() => move(index, 1)} aria-label={`Bajar ${service.title}`} className="border border-border rounded p-2 disabled:opacity-30"><ArrowDown className="w-4 h-4" /></button><button disabled={busy} onClick={() => setPendingDelete(service)} className="border border-danger/30 text-danger rounded px-3 py-2 text-xs"><Trash2 className="inline w-3.5 h-3.5 mr-1" />Eliminar</button></div></article>)}</div>
    <AlertDialog open={Boolean(pendingDelete)} onOpenChange={open => !open && !busy && setPendingDelete(null)}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Eliminar servicio</AlertDialogTitle><AlertDialogDescription>Se retirará únicamente “{pendingDelete?.title}” de la web. Los otros servicios se conservarán.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel><AlertDialogAction disabled={busy} onClick={event => { event.preventDefault(); void run(async () => { if (!pendingDelete) return; await contentService.deleteService(pendingDelete.id, pendingDelete.version); if (editing?.id === pendingDelete.id) reset(); setPendingDelete(null); setNotice('Servicio eliminado.'); }); }} className="bg-destructive text-destructive-foreground">Eliminar servicio</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div>;
}
