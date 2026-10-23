import PanelModal from '@/components/ui/PanelModal';
import DataLoadNotice from '@/components/ui/DataLoadNotice';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Lock, Unlock, X, Loader2, BookOpen, ClipboardList, Shield } from 'lucide-react';
import apiClient from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';
import authService from '@/services/authService';
import { useToast } from '@/components/ui/use-toast';
import { extractErrorMessage } from '@/lib/errors';

type AccessItem = {
  id: string; titulo?: string; nombre?: string; descripcion?: string; categoria: string;
  activo?: boolean; created_date?: string; acceso: boolean; heredado?: boolean;
  editable?: boolean; curso?: { titulo: string } | null;
};
type AccessData = { materiales: AccessItem[]; examenes: AccessItem[] };

export default function InstructorAccesos({ profile, onClose, onChanged = () => {} }) {
  const [data, setData] = useState<AccessData | null>(null);
  const [students, setStudents] = useState([]);
  const [student, setStudent] = useState(profile);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [rosterError, setRosterError] = useState('');
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [tab, setTab] = useState<'materiales' | 'examenes'>('materiales');
  const operation = useRef(false);
  const version = useRef(0);
  const { toast } = useToast();

  const load = useCallback(async (silent = false) => {
    const request = ++version.current;
    if (!silent) setLoading(true);
    try {
      const res = await apiClient.get(endpoints.functions.instructorAccessList(student.id));
      if (request !== version.current) return null;
      setData(res.data); setLoadError('');
      return res.data as AccessData;
    } catch (error) {
      if (request === version.current) setLoadError(extractErrorMessage(error));
      return null;
    } finally { if (request === version.current) setLoading(false); }
  }, [student.id]);

  const loadRoster = useCallback(async () => {
    try {
      const roster = await authService.listProfiles('-created_date', 10_000, { role: 'alumno' });
      setStudents(roster); setRosterError('');
    } catch (error) { setRosterError(extractErrorMessage(error)); }
  }, []);

  useEffect(() => { void loadRoster(); }, [loadRoster]);
  useEffect(() => {
    setData(null); setSelected([]); void load();
    const refresh = () => { if (!operation.current) void load(true); };
    const timer = window.setInterval(refresh, 15_000);
    window.addEventListener('focus', refresh);
    window.addEventListener('uasspain:academic-resources-changed', refresh);
    return () => {
      version.current++;
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('uasspain:academic-resources-changed', refresh);
    };
  }, [load]);

  const items = data?.[tab] ?? [];
  const eligible = (item: AccessItem) => item.editable !== false && item.activo !== false && !item.heredado;
  const change = async (ids: string[], access: boolean) => {
    if (operation.current || ids.length === 0) return;
    const targets = items.filter(item => ids.includes(item.id) && eligible(item));
    if (targets.length !== ids.length) return;
    operation.current = true; setBusy(true); setLoadError('');
    let saved = 0;
    try {
      for (const item of targets) {
        const response = await apiClient.post(endpoints.functions.instructorAccessToggle, {
          alumno_id: student.id, type: tab === 'materiales' ? 'material' : 'examen', item_id: item.id, acceso: access,
        });
        if (response.data.acceso !== access || response.data.item_id !== item.id) throw new Error('El servidor no confirmó el permiso solicitado.');
        saved++;
      }
      const persisted = await load();
      if (!persisted || !targets.every(item => persisted[tab].some(current => current.id === item.id && current.acceso === access))) throw new Error('No se pudo confirmar la persistencia. Actualiza los permisos antes de continuar.');
      setSelected([]);
      toast({ title: access ? 'Acceso concedido' : 'Acceso revocado', description: `${saved} recurso(s) confirmado(s) por el servidor.` });
      onChanged();
    } catch (error) {
      await load();
      setLoadError(`${extractErrorMessage(error)}${saved ? ` ${saved} recurso(s) guardado(s); revisa el estado antes de reintentar.` : ''}`);
    } finally { operation.current = false; setBusy(false); }
  };

  const matches = students.filter(candidate => `${candidate.nombre} ${candidate.apellidos} ${candidate.email} ${candidate.username}`.toLowerCase().includes(search.toLowerCase()));
  const options = matches.some(candidate => candidate.id === student.id) ? matches : [student, ...matches];
  return (
    <PanelModal label="Gestionar accesos" onClose={onClose} className="glass-card max-w-2xl p-6">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="min-w-0">
          <h3 className="font-heading text-lg font-bold text-foreground flex flex-wrap items-center gap-2"><Shield className="w-5 h-5 shrink-0 text-primary" />Gestionar Accesos</h3>
          <p className="text-xs text-muted-foreground mt-0.5 break-words">{student.nombre} {student.apellidos}</p>
        </div>
        <button onClick={onClose} aria-label="Cerrar" className="shrink-0 text-muted-foreground hover:text-brand-cyan-text transition-colors"><X className="w-5 h-5" /></button>
      </div>
      <div className="space-y-2 mb-4">
        <label htmlFor="access-student-search" className="block text-xs text-muted-foreground">Buscar alumno por nombre, apellidos, correo o usuario</label>
        <input id="access-student-search" value={search} disabled={busy} onChange={event => setSearch(event.target.value)} className="w-full bg-surface-muted border border-border-subtle rounded px-3 py-2 text-sm text-foreground" />
        <label htmlFor="access-student" className="block text-xs text-muted-foreground">Alumno seleccionado</label>
        <select id="access-student" disabled={busy} value={student.id} onChange={event => {
          const next = options.find(candidate => candidate.id === event.target.value);
          if (next) setStudent(next);
        }} className="w-full bg-background border border-border-subtle rounded px-3 py-2 text-sm text-foreground">
          {options.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.nombre} {candidate.apellidos} · {candidate.email}</option>)}
        </select>
        <DataLoadNotice error={rosterError} retry={loadRoster} />
      </div>
      <div className="flex flex-wrap gap-2 mb-4">
        {(['materiales', 'examenes'] as const).map(value => (
          <button key={value} disabled={busy} aria-pressed={tab === value} onClick={() => { setTab(value); setSelected([]); }} className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold uppercase tracking-widest border transition-all ${tab === value ? 'text-primary border-primary/30 bg-primary/10' : 'text-muted-foreground border-border-subtle hover:border-primary/20'}`}>
            {value === 'materiales' ? <BookOpen className="w-3.5 h-3.5" /> : <ClipboardList className="w-3.5 h-3.5" />}{value === 'materiales' ? 'Materiales' : 'Exámenes'}
          </button>
        ))}
        <button disabled={busy || loading} onClick={() => void load()} className="px-3 py-1.5 text-xs text-primary border border-primary/30">Actualizar permisos</button>
      </div>
      <DataLoadNotice error={loadError} retry={load} />
      {loading ? <div role="status" className="flex justify-center py-12"><Loader2 className="w-6 h-6 text-primary animate-spin" /><span className="sr-only">Cargando permisos</span></div> : !data ? null : (
        <>
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <label className="flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" disabled={busy || !items.some(eligible)} checked={items.some(eligible) && items.filter(eligible).every(item => selected.includes(item.id))} onChange={event => setSelected(event.target.checked ? items.filter(eligible).map(item => item.id) : [])} />Seleccionar disponibles</label>
            <button disabled={busy || !selected.length} onClick={() => void change(selected, true)} className="px-3 py-1.5 text-xs border border-primary/30 text-primary disabled:opacity-50">Conceder seleccionados</button>
            <button disabled={busy || !selected.length} onClick={() => void change(selected, false)} className="px-3 py-1.5 text-xs border border-danger-border text-danger disabled:opacity-50">Revocar seleccionados</button>
          </div>
          {!items.length ? <p className="text-sm text-muted-foreground text-center py-12">No hay {tab === 'materiales' ? 'materiales' : 'exámenes'} disponibles.</p> : (
            <div className="space-y-2">
              {items.map(item => (
                <div key={item.id} data-resource-id={item.id} className="flex flex-wrap items-center gap-3 border border-border-subtle rounded p-3">
                  <input type="checkbox" aria-label={`Seleccionar ${item.titulo || item.nombre}`} disabled={busy || !eligible(item)} checked={selected.includes(item.id)} onChange={event => setSelected(prev => event.target.checked ? [...prev, item.id] : prev.filter(id => id !== item.id))} />
                  <div className="min-w-0 flex-1 basis-40">
                    <p className="text-sm font-semibold text-foreground break-words">{item.titulo || item.nombre}</p>
                    {item.descripcion && <p className="text-xs text-muted-foreground break-words">{item.descripcion}</p>}
                    <p className="text-xs text-muted-foreground">Categoría {item.categoria} · {item.activo === false ? 'Sin publicar' : 'Publicado'}</p>
                    <p className="text-xs text-muted-foreground">{item.curso ? `Curso: ${item.curso.titulo}` : 'Sin curso asociado'}{item.created_date ? ` · ${new Date(item.created_date).toLocaleDateString('es-ES')}` : ''}</p>
                    {item.heredado && <p className="text-xs text-warning">Bloqueo heredado de categoría; no se puede modificar individualmente.</p>}
                  </div>
                  <button aria-label={`${item.acceso ? 'Revocar' : 'Conceder'} acceso a ${item.titulo || item.nombre}`} disabled={busy || !eligible(item)} onClick={() => void change([item.id], !item.acceso)} className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold uppercase tracking-widest border transition-all disabled:opacity-50 ${item.acceso ? 'text-primary border-primary/30 bg-primary/5' : 'text-danger border-danger-border bg-danger-soft/60'}`}>
                    {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : item.acceso ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}{item.acceso ? 'Permitido' : 'Bloqueado'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </PanelModal>
  );
}
