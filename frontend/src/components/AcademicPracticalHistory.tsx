import { useCallback, useEffect, useRef, useState } from 'react';
import { usePanelAuthContext } from '@/context/PanelAuthContext';
import examenesService from '@/services/examenesService';
import { extractErrorMessage } from '@/lib/errors';

type Practical = { id: string; categoria: string; nota: number; observaciones: string; fecha: string; instructor_nombre: string };
export default function AcademicPracticalHistory({ studentId }: { studentId: string }) {
  const { user } = usePanelAuthContext();
  const editable = user?.session_role === 'admin' || user?.session_role === 'instructor';
  const [rows, setRows] = useState<Practical[]>([]);
  const [error, setError] = useState('');
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ categoria: 'A1/A3', nota: '', observaciones: '' });
  const version = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++version.current;
    try {
      const items = await examenesService.resultadosPractico.listAll({ alumno_id: studentId });
      if (request !== version.current) return;
      setRows(items as Practical[]); setError('');
    } catch (err) { if (request === version.current) setError(extractErrorMessage(err, 'No se pudo actualizar el historial práctico.')); }
  }, [studentId]);
  useEffect(() => { setRows([]); setPage(0); void refresh(); return () => { version.current++; }; }, [refresh]);
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); if (editing === null) return;
    const nota = Number(draft.nota);
    if (!draft.nota || !Number.isFinite(nota) || nota < 0 || nota > 10) { setError('La nota debe estar entre 0 y 10.'); return; }
    setBusy(true); version.current++;
    try {
      const payload = { ...draft, nota, alumno_id: studentId };
      if (editing) await examenesService.resultadosPractico.update(editing, payload);
      else await examenesService.resultadosPractico.create(payload);
      setEditing(null); await refresh();
    } catch (err) { setError(extractErrorMessage(err, 'No se pudo guardar la evaluación práctica.')); }
    finally { setBusy(false); }
  };
  const begin = (row?: Practical) => {
    setEditing(row?.id || '');
    setDraft(row ? { categoria: row.categoria, nota: String(row.nota), observaciones: row.observaciones } : { categoria: 'A1/A3', nota: '', observaciones: '' });
  };
  return <section aria-label="Historial de evaluaciones prácticas" className="glass-card p-5 space-y-4 mt-6">
    <h3 className="font-heading text-lg">Evaluaciones prácticas y observaciones</h3>
    <button type="button" onClick={() => void refresh()} className="text-primary underline">Actualizar historial práctico</button>
    {editable && <button type="button" onClick={() => begin()} className="ml-3 text-primary underline">Añadir evaluación práctica</button>}
    {error && <p role="alert" className="text-danger">{error}</p>}
    {editing !== null && <form onSubmit={save} className="space-y-3">
      <label className="block">Categoría práctica<select value={draft.categoria} onChange={e => setDraft({ ...draft, categoria: e.target.value })} className="block bg-card border p-2">{['A1/A3','A2','STS'].map(value => <option key={value}>{value}</option>)}</select></label>
      <label className="block">Nota práctica<input type="number" min="0" max="10" step="0.1" required value={draft.nota} onChange={e => setDraft({ ...draft, nota: e.target.value })} className="block bg-card border p-2" /></label>
      <label className="block">Observaciones académicas<textarea maxLength={10000} value={draft.observaciones} onChange={e => setDraft({ ...draft, observaciones: e.target.value })} className="block bg-card border p-2 w-full" /></label>
      <button disabled={busy} type="submit" className="text-primary">Guardar evaluación práctica</button>
      <button disabled={busy} type="button" onClick={() => setEditing(null)} className="ml-3">Cancelar</button>
    </form>}
    {!rows.length && <p>No hay evaluaciones prácticas registradas.</p>}
    {rows.slice(page * 20, (page + 1) * 20).map(row => <article key={row.id} className="border border-border-subtle p-3 break-words">
      <p>{row.categoria} · {row.nota}/10 · {row.fecha ? new Date(row.fecha).toLocaleDateString('es-ES') : 'Sin fecha'}</p>
      <p className="text-sm text-muted-foreground">Autor: {row.instructor_nombre || 'No disponible'}</p>
      <p className="whitespace-pre-wrap">{row.observaciones}</p>
      {editable && <button type="button" onClick={() => begin(row)} className="text-primary underline">Editar evaluación práctica</button>}
    </article>)}
    <div className="flex gap-4 items-center"><button disabled={page === 0} onClick={() => setPage(value => value - 1)}>Anteriores</button><span>{rows.length} evaluaciones</span><button disabled={(page + 1) * 20 >= rows.length} onClick={() => setPage(value => value + 1)}>Siguientes</button></div>
  </section>;
}
