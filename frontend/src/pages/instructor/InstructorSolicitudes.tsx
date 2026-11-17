import { useCallback, useEffect, useRef, useState } from 'react';
import apiClient from '@/api/apiClient';
import { extractErrorMessage } from '@/lib/errors';

type RequestRow = { id: string; nombre: string; apellidos: string; email: string; created_date: string };

export default function InstructorSolicitudes() {
  const [rows, setRows] = useState<RequestRow[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [loading, setLoading] = useState(true);
  const version = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++version.current;
    try {
      const response = await apiClient.get('/api/registration-requests/');
      if (request !== version.current) return;
      setRows(response.data);
      setError('');
    } catch (err) { if (request === version.current) setError(extractErrorMessage(err, 'No se pudieron actualizar las solicitudes.')); }
    finally { if (request === version.current) setLoading(false); }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30000);
    return () => { version.current++; window.clearInterval(timer); };
  }, [refresh]);

  const resolve = async (id: string, decision: 'approve' | 'reject') => {
    setBusy(id);
    version.current++;
    try {
      await apiClient.post(`/api/registration-requests/${id}/resolve/`, { decision });
      await refresh();
    } catch (err) {
      setError(extractErrorMessage(err, 'No se pudo resolver la solicitud. Actualiza para comprobar si otro instructor ya la atendió.'));
    } finally { setBusy(''); }
  };

  return <section aria-label="Solicitudes de acceso" className="glass-card p-6 space-y-4">
    <h2 className="font-heading text-xl">Solicitudes de acceso</h2>
    <p className="text-sm text-muted-foreground">Solicitudes con correo verificado. Cualquier instructor autorizado puede resolverlas. Aprobar no asigna al alumno a un instructor.</p>
    <button type="button" onClick={() => void refresh()} className="text-primary underline">Actualizar solicitudes</button>
    {error && <p role="alert" className="text-danger">{error}</p>}
    {loading ? <p role="status">Cargando solicitudes…</p> : !rows.length ? <p>No hay solicitudes pendientes con correo verificado.</p> :
      rows.map(row => <article key={row.id} className="border border-border-subtle p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 break-words"><p>{row.nombre} {row.apellidos}</p><p className="text-sm text-muted-foreground">{row.email}</p></div>
        <div className="flex gap-3">
          <button type="button" disabled={!!busy} onClick={() => void resolve(row.id, 'approve')} className="text-primary disabled:opacity-50">Aprobar</button>
          <button type="button" disabled={!!busy} onClick={() => void resolve(row.id, 'reject')} className="text-danger disabled:opacity-50">Rechazar</button>
        </div>
      </article>)}
  </section>;
}
