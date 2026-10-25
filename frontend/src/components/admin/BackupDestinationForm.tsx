import SuccessNotice from '@/components/ui/SuccessNotice';
import { useState } from 'react';
import { Settings2, X } from 'lucide-react';
import PanelModal from '@/components/ui/PanelModal';
import apiClient from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';
import { extractErrorMessage } from '@/lib/errors';
import { BACKUP_SLOTS, availableStorage, backupDisplayName, infrastructureMessage } from '@/lib/infrastructure';

export { BACKUP_SLOTS };

export default function BackupDestinationForm({ role, label, server, onSaved, operationBusy = false, readOnly = false }) {
  const [form, setForm] = useState(null);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const local = form?.type === 'local';
  const steps = local ? ['Nombre', 'Tipo de destino', 'Carpeta'] : ['Nombre', 'Tipo de destino', 'Dirección', 'Usuario', 'Carpeta'];
  const control = 'w-full min-w-0 rounded-md border border-border-subtle bg-card px-3 py-2 text-sm text-foreground focus-visible:outline-primary';
  const button = 'max-w-full whitespace-normal rounded-md border border-border-subtle px-3 py-2 text-sm focus-visible:outline-primary disabled:opacity-50';
  const open = () => {
    setError(''); setStep(0);
    setForm({ name: server?.name || label, type: server ? (server.transfer_protocol === 'sftp' ? 'external' : 'local') : role === 'local' ? 'local' : 'external',
      sftp_host: server?.sftp_host || '', sftp_user: server?.sftp_user || '', sftp_remote_path: server?.sftp_remote_path || '',
      sftp_port: server?.sftp_port || 22, vpn_ip: server?.vpn_ip || '', smb_share: server?.smb_share || '', localStorage: server?.smb_share ? 'custom' : 'default' });
  };
  const run = async (action) => {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try { await action(); await onSaved(); }
    catch (err) { setError(infrastructureMessage(extractErrorMessage(err, 'No se pudo completar la operación.'))); }
    finally { setBusy(false); }
  };
  const save = () => run(async () => {
    const payload = { name: form.name.trim(), role, transfer_protocol: local ? server?.transfer_protocol === 'smb' ? 'smb' : 'copy' : 'sftp', is_active: false,
      ...(local ? { smb_share: form.localStorage === 'custom' ? form.smb_share : '' }
        : { sftp_host: form.sftp_host.trim(), sftp_user: form.sftp_user.trim(), sftp_remote_path: form.sftp_remote_path.trim(), sftp_port: Number(form.sftp_port), ...(form.vpn_ip ? { vpn_ip: form.vpn_ip.trim() } : {}) }) };
    if (server?.id) await apiClient.put(endpoints.backups.serverDetail(server.id), payload);
    else await apiClient.post(endpoints.backups.servers, payload);
    setNotice('Destino guardado. Prueba la conexión antes de activarlo.'); setForm(null);
  });
  const test = () => run(async () => {
    const { data } = await apiClient.post(endpoints.backups.testConnection, { server_id: server.id }, { timeout: 40000 });
    if (!data.ok) { setError(data.detail || 'No se pudo conectar.'); return; }
    setNotice('Conexión correcta.');
  });
  const toggle = () => run(async () => {
    await apiClient.put(endpoints.backups.serverDetail(server.id), { is_active: !server.is_active }, { timeout: 40000 });
    setNotice(server.is_active ? 'Destino desactivado.' : 'Destino activado.');
  });
  const field = (key, title, type = 'text') => <label className="block space-y-1" key={key}><span className="text-sm">{title}</span><input autoComplete="off" required className={control} type={type} value={form[key]} min={type === 'number' ? 1 : undefined} max={type === 'number' ? 65535 : undefined} onChange={event => setForm({ ...form, [key]: event.target.value })} /></label>;
  const state = !server ? 'Pendiente de configuración' : server.status === 'offline' ? 'Conexión no disponible' : server.is_active ? 'Servicio habilitado' : 'Configuración guardada';
  return <article className="glass-card p-4 min-w-0 space-y-3" aria-label={label}>
    <div className="flex flex-wrap justify-between gap-2"><h4 className="font-heading font-semibold break-words">{backupDisplayName(server?.name, role)}</h4><span className={`text-xs ${server?.status === 'offline' ? 'text-danger' : server?.is_active ? 'text-success' : 'text-muted-foreground'}`}>{state}</span></div>
    <p className="text-sm text-muted-foreground">{label} · {server?.transfer_protocol === 'sftp' || role !== 'local' ? 'Servidor externo' : 'Almacenamiento local'}</p>
    <p className="text-sm break-all">{server?.sftp_host || (role === 'local' ? 'Esta instalación' : 'Dirección del servidor pendiente')}</p>
    <dl className="text-xs text-muted-foreground space-y-1">
      <div><dt className="inline">Habilitado: </dt><dd className="inline">{server?.is_active ? 'Sí' : 'No'}</dd></div>
      <div><dt className="inline">Configuración: </dt><dd className="inline">{server ? 'Guardada' : 'Pendiente'}</dd></div>
      <div><dt className="inline">Conexión: </dt><dd className="inline">{server?.status === 'offline' ? 'No disponible en la última comprobación' : server?.configuration_validated ? 'Verificada en la última comprobación' : 'Pendiente de comprobación'}</dd></div>
      <div><dt className="inline">Última comprobación: </dt><dd className="inline">{server?.connection_checked_at ? new Date(server.connection_checked_at).toLocaleString('es-ES') : 'Sin comprobar'}</dd></div>
      <div><dt className="inline">Última copia realizada correctamente: </dt><dd className="inline">{server?.last_backup ? new Date(server.last_backup).toLocaleString('es-ES') : 'Sin evidencia'}</dd></div>
      <div><dt className="inline">Espacio de almacenamiento disponible: </dt><dd className="inline">{availableStorage(server)}</dd></div>
      {server?.error && <div className="text-danger break-words"><dt className="inline">Error: </dt><dd className="inline">{infrastructureMessage(server.error)}</dd></div>}
    </dl>
    {!readOnly && <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={busy || operationBusy} onClick={open}><Settings2 className="inline w-4 h-4 mr-1" />Configurar</button><button type="button" className={button} disabled={busy || operationBusy || !server} onClick={test}>Verificar conexión con el servidor</button><label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" aria-label={`Servicio habilitado: ${label}`} checked={Boolean(server?.is_active)} disabled={busy || operationBusy || !server || (!server.is_active && !server.configuration_validated)} onChange={toggle} />Servicio habilitado</label></div>}
    {busy ? <p role="status" className="text-sm">Comprobando destino…</p> : notice && <SuccessNotice message={notice} onDismiss={() => setNotice('')} />}{error && !form && <p role="alert" className="text-sm text-danger">{error}</p>}
    {!readOnly && form && <PanelModal label={`Configurar ${label}`} onClose={() => !busy && setForm(null)}>
      <div className="flex items-start justify-between gap-3"><h3 className="font-heading text-lg">Configurar destino</h3><button type="button" aria-label="Cerrar" className={button} disabled={busy} onClick={() => setForm(null)}><X className="w-4 h-4" /></button></div>
      <p className="text-sm text-muted-foreground my-3" aria-live="polite">Paso {step + 1} de {steps.length}: {steps[step]}</p>
      <form aria-label={`Asistente ${label}`} className="space-y-4" onSubmit={event => { event.preventDefault(); if (step === steps.length - 1) void save(); else setStep(step + 1); }}>
        {step === 0 && field('name', 'Nombre del destino')}
        {step === 1 && <label className="block space-y-1"><span className="text-sm">Tipo de destino</span><select className={control} value={form.type} onChange={event => setForm({ ...form, type: event.target.value })}><option value="local" disabled={role !== 'local'}>Copias de seguridad locales</option><option value="external">Servidor externo de copias</option></select></label>}
        {!local && step === 2 && field('sftp_host', 'Servidor o dirección')}
        {!local && step === 3 && field('sftp_user', 'Usuario')}
        {step === steps.length - 1 && (local ? <><label className="block space-y-1"><span className="text-sm">Almacenamiento local</span><select className={control} value={form.localStorage} onChange={event => setForm({ ...form, localStorage: event.target.value })}><option value="default">Almacenamiento de esta instalación</option><option value="custom">Carpeta preparada por el sistema</option></select></label>{form.localStorage === 'custom' && field('smb_share', 'Carpeta donde guardar las copias')}<p className="text-xs text-muted-foreground">Las copias se guardarán cifradas en el almacenamiento seleccionado.</p></>
          : <>{field('sftp_remote_path', 'Carpeta donde guardar las copias')}<p className="text-sm">{server?.key_configured ? 'Clave configurada.' : 'Clave no configurada.'} {server?.identity_configured ? 'Identidad del servidor configurada.' : 'Identidad del servidor no configurada.'}</p><p className="text-xs text-muted-foreground">La configuración de seguridad la gestiona el sistema. Guarda el destino y prueba la conexión antes de activarlo.</p><details className="rounded-md border border-border-subtle p-3"><summary className="cursor-pointer text-sm focus-visible:outline-primary">Opciones avanzadas</summary><div className="mt-3 space-y-3">{field('sftp_port', 'Puerto', 'number')}<label className="block space-y-1"><span className="text-sm">Dirección de la conexión privada (opcional)</span><input className={control} value={form.vpn_ip} onChange={event => setForm({ ...form, vpn_ip: event.target.value })} /></label></div></details></>)}
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2"><button type="button" disabled={busy} className={button} onClick={() => step ? setStep(step - 1) : setForm(null)}>{step ? 'Volver' : 'Cancelar'}</button><button type="submit" disabled={busy} className={`${button} bg-primary/10 text-primary`}>{busy ? 'Guardando…' : step === steps.length - 1 ? 'Guardar' : 'Continuar'}</button></div>
      </form>
    </PanelModal>}
  </article>;
}
