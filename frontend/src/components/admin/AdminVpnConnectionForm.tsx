import SuccessNotice from '@/components/ui/SuccessNotice';
import { useEffect, useRef, useState } from 'react';
import apiClient from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';
import { extractErrorMessage } from '@/lib/errors';
import { INFORMATION_UNAVAILABLE, infrastructureMessage, mergeInfrastructureDraft, vpnDraftFromObservation } from '@/lib/infrastructure';

const field = 'w-full min-w-0 rounded-sm border border-border-subtle bg-surface-muted px-3 py-2 text-sm text-foreground';
const button = 'max-w-full whitespace-normal rounded-sm border border-border-subtle px-4 py-2 text-sm text-foreground disabled:opacity-50';
const initial = { host_platform: '', server_name: '', server_address: '', installation: '', timezone: '', step: 0, vpn: { interface: '', address: '', port: 0, public_key: '', peers: [] }, paths: [], reserved_networks: [] };
export default function AdminVpnConnectionForm({ active = true, observation = null }) {
  const [config, setConfig] = useState<any>(initial), [runtime, setRuntime] = useState<any>(null), [vpn, setVpn] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const baseConfig = useRef<any>(null), draft = useRef(config);
  draft.current = config;
  const load = async () => {
    setBusy(true); setError('');
    try { const [settings, status] = await Promise.all([apiClient.get('/api/infrastructure/'), apiClient.get(endpoints.vpn.status)]);
      if (!settings.data.config || !Number.isInteger(settings.data.revision)) throw new Error('No se pudo consultar la configuración guardada.');
      const fresh = settings.data.config;
      const next = baseConfig.current ? mergeInfrastructureDraft(baseConfig.current, draft.current, fresh, 'vpn') : structuredClone(fresh);
      if (!baseConfig.current) next.vpn = vpnDraftFromObservation(next.vpn, status.data);
      baseConfig.current = structuredClone(fresh); setRuntime(settings.data); setConfig(next); setVpn(status.data);
    } catch (e) { setError(infrastructureMessage(extractErrorMessage(e, 'No se pudo cargar la infraestructura.'))); } finally { setBusy(false); }
  };
  useEffect(() => { if (active) void load(); }, [active]);
  const save = async (value = config) => {
    if (!baseConfig.current) throw new Error('Consulta la configuración guardada antes de modificarla.');
    const fresh = (await apiClient.get('/api/infrastructure/')).data;
    const merged = mergeInfrastructureDraft(baseConfig.current, value, fresh.config, 'vpn');
    const { data } = await apiClient.put('/api/infrastructure/', { expected_revision: fresh.revision, config: merged });
    baseConfig.current = structuredClone(data.config); setConfig(data.config); setNotice('Configuración guardada; las comprobaciones siguen pendientes.'); return data;
  };
  const run = async (action) => { if (busy) return; setBusy(true); setError(''); setNotice(''); try { await action(); } catch (e) { setError(infrastructureMessage(extractErrorMessage(e, 'No se pudo completar la operación.'))); } finally { setBusy(false); } };
  const exportConfig = async () => { const { data } = await apiClient.get('/api/infrastructure/export/'); const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = 'UASSpain-infraestructura-publica.json'; a.click(); URL.revokeObjectURL(url); };
  const input = (label, value, update, type = 'text') => <label className="block min-w-0 space-y-1"><span className="text-sm text-foreground">{label}</span><input disabled={busy} className={field} type={type} value={value} autoComplete="off" onChange={e => update(e.target.value)} /></label>;
  const vpnPatch = (key, value) => setConfig({ ...config, vpn: { ...config.vpn, [key]: value } });
  const peerPatch = (i, key, value) => vpnPatch('peers', config.vpn.peers.map((p, n) => n === i ? { ...p, [key]: value } : p));
  const reloadSaved = () => { if (baseConfig.current && JSON.stringify(draft.current) !== JSON.stringify(baseConfig.current) && !window.confirm('¿Descartar los cambios sin guardar y cargar la configuración guardada?')) return; baseConfig.current = null; void load(); };
  const observedVpn = observation || vpn;
  if (runtime?.enabled === false) return <section className="glass-card p-4 space-y-3" aria-label="Configuración VPN temporalmente deshabilitada"><h3 className="font-heading font-bold">Configuración VPN temporalmente deshabilitada</h3><p className="text-sm text-muted-foreground">La configuración guardada se conserva. La supervisión de la conexión sigue mostrando los datos disponibles.</p></section>;
  return <section className="glass-card p-4 sm:p-6 min-w-0 space-y-4" aria-label="Configuración de conexión VPN">
    <h3 className="font-heading text-lg font-bold text-foreground">Configuración de conexión VPN</h3>
    <p className="text-sm text-muted-foreground">Los datos públicos detectados completan los campos vacíos. Revisa los cambios y guarda la configuración; las claves privadas y la activación de WireGuard se gestionan en cada equipo.</p>
    {error && <p role="alert" className="text-sm text-danger break-words">{error}</p>}{notice && <SuccessNotice message={notice} onDismiss={() => setNotice('')} />}
    <div className="grid gap-4 md:grid-cols-2">
      <label className="block min-w-0 space-y-1 text-sm">Adaptador de red de WireGuard<input className={field} disabled={busy} list="wireguard-adapters" value={config.vpn.interface} autoComplete="off" onChange={event => vpnPatch('interface', event.target.value)} /><datalist id="wireguard-adapters">{observedVpn?.agent_state === 'VERIFIED' && observedVpn.interfaces?.map(name => <option key={name} value={name} />)}</datalist></label>
      {input('Dirección IP interna de la VPN', config.vpn.address, value => vpnPatch('address', value))}
      {input('Puerto de conexión WireGuard (UDP)', config.vpn.port || '', value => vpnPatch('port', Number(value)), 'number')}
      {input('Clave pública de este equipo', config.vpn.public_key, value => vpnPatch('public_key', value))}
    </div>
    <p className="text-xs text-muted-foreground">Incluye el prefijo de red en la dirección IP, por ejemplo /30. No se generan claves ni se modifica el túnel al guardar.</p>
    <p className="text-sm text-muted-foreground">Adaptadores VPN detectados: {observedVpn?.agent_state === 'VERIFIED' && observedVpn.interfaces?.length ? observedVpn.interfaces.join(', ') : INFORMATION_UNAVAILABLE}</p>
    {observedVpn?.error && <p role="status" className="text-sm text-warning break-words">{infrastructureMessage(observedVpn.error)}</p>}
    {config.vpn.peers.map((peer, index) => <fieldset className="border border-border-subtle p-3 space-y-3 min-w-0" disabled={busy} key={index}>
      <legend className="text-sm">Equipo autorizado {index + 1}</legend>
      {input('Clave pública del equipo autorizado', peer.public_key, value => peerPatch(index, 'public_key', value))}
      {input('Dirección del equipo autorizado (IP o dominio y puerto)', peer.endpoint, value => peerPatch(index, 'endpoint', value))}
      {input('Redes permitidas (CIDR, separadas por coma)', peer.allowed_ips.join(', '), value => peerPatch(index, 'allowed_ips', value.split(',').map(item => item.trim()).filter(Boolean)))}
      {input('Intervalo para mantener la conexión (segundos)', peer.keepalive, value => peerPatch(index, 'keepalive', Number(value)), 'number')}
      <button className={button} type="button" onClick={() => vpnPatch('peers', config.vpn.peers.filter((_, item) => item !== index))}>Retirar equipo de la configuración</button>
    </fieldset>)}
    <button className={button} type="button" disabled={busy || !runtime} onClick={() => vpnPatch('peers', [...config.vpn.peers, { public_key: '', endpoint: '', allowed_ips: [], keepalive: 0 }])}>Añadir equipo autorizado</button>
    <p className="text-sm text-muted-foreground">Permite sólo las redes necesarias y revisa posibles conflictos con las redes de la empresa.</p>
    <div className="flex flex-wrap gap-3"><button type="button" className={button} disabled={busy || !runtime} onClick={() => void run(() => save())}>{busy ? 'Guardando…' : 'Guardar configuración'}</button><button type="button" className={button} disabled={busy || !runtime} onClick={() => void run(exportConfig)}>Descargar configuración de conexión</button><button type="button" className={button} disabled={busy} onClick={reloadSaved}>Recargar configuración guardada</button></div>
    <p className="text-xs text-muted-foreground">La descarga contiene la configuración pública guardada; no incluye claves privadas ni cambios sin guardar.</p>
  </section>;
}
