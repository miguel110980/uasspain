import { useEffect, useState } from 'react';
import apiClient from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';

export const BACKUP_SLOTS = [
  { role: 'local', label: 'Servidor local' },
  { role: 'external_1', label: 'Servidor externo 1' },
  { role: 'external_2', label: 'Servidor externo 2' },
] as const;

export default function BackupDestinationForm({ role, label, server, onSaved }) {
  const empty = { name: '', ip_address: '', vpn_ip: '', transfer_protocol: 'sftp', sftp_host: '', sftp_port: 22, sftp_user: '', sftp_remote_path: '', sftp_key_path: '', sftp_known_hosts: '', smb_share: '', is_active: false };
  const [form, setForm] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  useEffect(() => { setForm(server ? { ...empty, ...server, vpn_ip: server.vpn_ip || '' } : empty); }, [server]);
  const save = async (event) => {
    event.preventDefault(); setBusy(true); setNotice('');
    try {
      const payload = { ...form, role, is_offsite: role !== 'local', ...(form.ip_address ? {} : { ip_address: undefined }) };
      if (server?.id) await apiClient.put(endpoints.backups.serverDetail(server.id), payload);
      else await apiClient.post(endpoints.backups.servers, payload);
      setNotice('Destino guardado.'); await onSaved();
    } catch (error) { setNotice(error?.response?.data?.detail || 'No se pudo guardar el destino.'); }
    finally { setBusy(false); }
  };
  const test = async () => {
    setBusy(true); setNotice('Conectando…');
    try {
      const { data } = await apiClient.post(endpoints.backups.testConnection, { server_id: server.id }, { timeout: 35000 });
      setNotice(data.ok ? 'Online · Conexión comprobada.' : `Offline · ${data.detail}`); await onSaved();
    } catch (error) { setNotice(error?.response?.data?.detail || 'Error al comprobar la conexión.'); }
    finally { setBusy(false); }
  };
  const inputClass = 'w-full rounded border border-border-subtle bg-surface-muted px-3 py-2 text-sm text-foreground';
  const field = (key, title, type = 'text') => <label key={key} className="block space-y-1"><span className="text-xs text-muted-foreground">{title}</span><input className={inputClass} value={form[key]} type={type} min={type === 'number' ? 1 : undefined} max={type === 'number' ? 65535 : undefined} onChange={(e) => setForm({ ...form, [key]: type === 'number' ? Number(e.target.value) : e.target.value })} /></label>;
  return <form onSubmit={save} className="glass-card p-5 space-y-4 min-w-0" aria-label={label}>
    <h3 className="font-semibold">{label}</h3>
    <p className="text-xs text-muted-foreground">{server ? `${server.status} · ${server.is_active ? 'Activo' : 'Deshabilitado'}` : 'No configurado'}</p>
    {field('name', 'Nombre')}{field('sftp_host', 'IP/hostname')}{field('ip_address', 'IP (opcional si el hostname resuelve)')}
    <label className="block space-y-1"><span className="text-xs text-muted-foreground">Protocolo</span><select className={inputClass} value={form.transfer_protocol} onChange={(e) => setForm({ ...form, transfer_protocol: e.target.value })}><option value="sftp">SFTP (clave privada)</option>{role === 'local' && <><option value="copy">Directorio montado</option><option value="smb">SMB montado en Docker</option></>}</select></label>
    {form.transfer_protocol === 'sftp' ? <>
      {field('sftp_port', 'Puerto', 'number')}{field('sftp_user', 'Usuario')}{field('sftp_remote_path', 'Ruta destino')}
      {field('vpn_ip', 'IP privada del peer VPN')}{field('sftp_key_path', 'Ruta de la clave privada montada')}{field('sftp_known_hosts', 'Ruta known_hosts montada')}
      <p className="text-xs text-muted-foreground">Autenticación por clave privada montada como secreto. Se verifica la clave del servidor; no se muestra ni se carga la clave privada.</p>
    </> : <>{field('smb_share', 'Ruta destino dentro del contenedor')}<p className="text-xs text-muted-foreground">Requiere un directorio realmente montado. Una ruta UNC de Windows no está disponible directamente en Linux.</p></>}
    <label className="flex gap-2 text-sm"><input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} /> Activo</label>
    <div className="flex flex-wrap gap-2"><button disabled={busy} className="border border-primary/30 rounded px-3 py-2 text-sm text-primary" type="submit">Guardar destino</button><button disabled={busy || !server?.id} className="border border-border-subtle rounded px-3 py-2 text-sm disabled:opacity-50" type="button" onClick={test}>Probar conexión</button></div>
    <p className="text-xs text-muted-foreground">Última comprobación: {server?.last_seen ? new Date(server.last_seen).toLocaleString('es-ES') : 'Sin comprobaciones satisfactorias'}</p>
    <p role="status" className="text-sm break-words">{notice}</p>
  </form>;
}
