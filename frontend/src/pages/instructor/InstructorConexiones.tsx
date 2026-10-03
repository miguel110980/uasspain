import { useEffect, useState } from 'react';
import conexionesService from '@/services/conexionesService';
import { ROLE_LABELS } from '@/lib/roles';

/** Shared presence excludes private access logs and session-management actions. */
export default function InstructorConexiones() {
  const [records, setRecords] = useState([]);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const rows = await conexionesService.sesionesActivas();
        if (active) { setRecords(rows); setError(''); }
      } catch { if (active) setError('No se pudieron actualizar las conexiones.'); }
    };
    void load();
    const timer = setInterval(load, 15000);
    const unsubscribe = conexionesService.subscribeConexiones(() => { void load(); });
    return () => { active = false; clearInterval(timer); unsubscribe(); };
  }, []);
  return <section aria-label="Conexiones activas" className="glass-card p-5">
    <h2 className="font-heading text-xl mb-4">Conexiones activas ({records.length})</h2>
    {error && <p role="alert" className="text-danger">{error}</p>}
    <p className="text-sm text-muted-foreground mb-4">Administradores, instructores y alumnos conectados.</p>
    <div className="overflow-x-auto"><table className="w-full text-sm">
      <thead><tr className="text-left border-b border-border-subtle"><th className="p-3">Nombre</th><th>Rol</th><th>Conectado desde</th><th>Estado</th></tr></thead>
      <tbody>{records.map(record => <tr key={record.id} className="border-b border-border-subtle">
        <td className="p-3">{record.nombre_completo}</td><td>{ROLE_LABELS[record.rol] || record.rol}</td>
        <td>{new Date(record.fecha_hora).toLocaleString('es-ES')}</td><td className="text-success">Conectado</td>
      </tr>)}</tbody>
    </table></div>
    {!records.length && !error && <p className="text-muted-foreground mt-4">No hay conexiones activas.</p>}
  </section>;
}
