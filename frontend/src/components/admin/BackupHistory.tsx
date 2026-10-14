import { backupState, backupDuration } from '@/lib/backups';
import { backupDisplayName, infrastructureMessage } from '@/lib/infrastructure';

const LABELS = { create: 'Creación', transfer: 'Transferencia', integrity: 'Validación de integridad', recovery: 'Prueba de recuperación', restore: 'Restauración' };

export default function BackupHistory({ history, total, page, setPage, date, button, loading, busy, clear, servers }) {
  const destination = (value) => value === 'auto' ? 'Origen automático' : ['local', 'external_1', 'external_2'].includes(value) ? backupDisplayName('', value) : servers.find(server => server.id === value)?.name || (value ? 'Origen registrado' : 'Servidores previstos');
  const message = (value) => value ? infrastructureMessage(value, 'La operación registró un error. Revisa el estado de sus servidores.') : '';
  return <section id="backup-history" aria-label="Historial de copias" className="glass-card p-4 space-y-4 scroll-mt-4 min-w-0">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-heading font-semibold">Historial de copias</h3><button className={button} disabled={busy || !history.some(operation => operation.finished_at)} onClick={() => clear(history.filter(operation => operation.finished_at).map(operation => operation.id))}>Limpiar historial</button></div>
    {!history.length && !loading && <p className="text-sm text-muted-foreground">No hay operaciones en el historial.</p>}
    <div className="overflow-x-auto max-w-full" tabIndex={0} aria-label="Tabla del historial"><table className="w-full text-sm text-left"><thead><tr>{['Fecha', 'Operación', 'Copia', 'Servidor', 'Estado', 'Duración', 'Resultado'].map(label => <th key={label} className="px-3 py-2 whitespace-nowrap">{label}</th>)}</tr></thead><tbody>{history.map(operation => <tr key={operation.id} className="border-t border-border-subtle">
      <td className="px-3 py-2 whitespace-nowrap">{date(operation.started_at)}</td><td className="px-3 py-2">{LABELS[operation.operation_type] || operation.operation_type}</td><td className="px-3 py-2 text-xs">{operation.backup_job_id || 'Sin copia asociada'}</td><td className="px-3 py-2">{destination(operation.destination)}</td><td className="px-3 py-2">{backupState(operation)}</td><td className="px-3 py-2 whitespace-nowrap">{operation.finished_at ? backupDuration(operation.duration_milliseconds) : 'En proceso'}</td><td className="px-3 py-2"><span>{message(operation.message) || (['completed', 'success'].includes(operation.status) ? 'Operación finalizada' : operation.finished_at ? 'Consulta los detalles' : 'En proceso')}</span><details className="mt-1"><summary className="cursor-pointer focus-visible:outline-primary">Ver detalles</summary><dl className="text-xs space-y-1"><dt>Identificador de operación</dt><dd>{operation.id}</dd><dt>Finalización</dt><dd>{date(operation.finished_at)}</dd><dt>Estado registrado</dt><dd>{backupState(operation)}</dd></dl></details></td>
    </tr>)}</tbody></table></div>
    <div className="flex flex-wrap items-center justify-between gap-2"><button className={button} disabled={page === 0} onClick={() => setPage(page - 1)}>Anterior</button><span className="text-sm">Página {page + 1} · {total || 0} operaciones</span><button className={button} disabled={(page + 1) * 10 >= (total || 0)} onClick={() => setPage(page + 1)}>Siguiente</button></div>
  </section>;
}
