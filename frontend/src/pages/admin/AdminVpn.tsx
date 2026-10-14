import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { ShieldCheck, Wifi, RefreshCw, AlertTriangle, CheckCircle2, Clock, Activity, Server } from 'lucide-react';
import apiClient from '@/api/apiClient';
import endpoints from '@/api/endpoints';
import BackupDestinationForm, { BACKUP_SLOTS } from '@/components/admin/BackupDestinationForm';
import AdminInfrastructure from '@/pages/admin/AdminInfrastructure';
import { extractErrorMessage } from '@/lib/errors';
import { INFORMATION_UNAVAILABLE, infrastructureMessage, infrastructureState, platformLabel } from '@/lib/infrastructure';

const STATE_MAP = {
  connected: { label: 'Conectada', tone: 'emerald', icon: CheckCircle2 },
  disconnected: { label: 'Desconectada', tone: 'red', icon: AlertTriangle },
  unknown: { label: 'Estado desconocido', tone: 'amber', icon: AlertTriangle },
  not_configured: { label: 'Pendiente de configuración', tone: 'amber', icon: AlertTriangle },
};

export default function AdminVpn({ active = true, onNavigate = null }) {
  const [vpnData, setVpnData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastChecked, setLastChecked] = useState(null);
  const [servers, setServers] = useState([]);
  const loadVersion = useRef(0);

  const load = async () => {
    const version = ++loadVersion.current;
    setLoading(true);
    setError('');
    try {
      const [res, destinations] = await Promise.all([apiClient.get(endpoints.vpn.status), apiClient.get(endpoints.backups.servers)]);
      if (version !== loadVersion.current) return;
      setVpnData(res.data);
      setServers(destinations.data);
      setLastChecked(new Date());
    } catch (err) {
      if (version !== loadVersion.current) return;
      setError(infrastructureMessage(extractErrorMessage(err, 'No se pudo obtener el estado de la VPN.')));
      setVpnData(null);
    } finally {
      if (version === loadVersion.current) setLoading(false);
    }
  };

  useEffect(() => { if (!active) return; void load(); const timer = setInterval(() => void load(), 30000); return () => { clearInterval(timer); loadVersion.current++; }; }, [active]);

  const verifiedObservation = vpnData?.agent_state === 'VERIFIED';
  const state = !verifiedObservation ? 'unknown' : vpnData?.preparation_state === 'NOT_CONFIGURED' ? 'not_configured' : vpnData?.state || 'unknown';
  const stateInfo = STATE_MAP[state] || STATE_MAP.unknown;
  const StateIcon = stateInfo.icon;

  return (
    <motion.div role="region" aria-label="Conexiones VPN" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-5 min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-heading text-xl font-bold text-foreground flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-primary shrink-0" /> Conexión segura WireGuard
          </h2>
          <p className="text-xs text-muted-foreground mt-1">Monitorización del estado del túnel WireGuard. La VPN es gestionada externamente por el sistema operativo.</p>
        </div>
        <button onClick={load} disabled={loading} className="inline-flex items-center gap-2 rounded border border-primary/20 bg-primary/10 px-3 py-2 text-sm text-primary disabled:opacity-50">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Actualizar estado
        </button>
      </div>

      {error ? (
        <div className="rounded border border-danger-border bg-danger-soft p-3 text-sm text-danger/80">{error}</div>
      ) : null}

      {loading && !vpnData ? (
        <div className="text-sm text-muted-foreground">Consultando estado de la VPN...</div>
      ) : vpnData ? (
        <>
          <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-4">
            <div className="glass-card p-4">
              <div className="flex items-center gap-2 mb-2">
                <StateIcon className={`w-4 h-4 ${stateInfo.tone === 'emerald' ? 'text-success' : stateInfo.tone === 'red' ? 'text-danger' : 'text-warning'}`} />
                <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Estado de la conexión</span>
              </div>
              <p className={`text-base font-semibold ${stateInfo.tone === 'emerald' ? 'text-success' : stateInfo.tone === 'red' ? 'text-danger' : 'text-warning'}`}>
                {stateInfo.label}
              </p>
            </div>

            <div className="glass-card p-4">
              <div className="flex items-center gap-2 mb-2">
                <Wifi className="w-4 h-4 text-primary" />
                <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Adaptador de red VPN</span>
              </div>
              <p className="text-base font-semibold text-foreground break-words">{verifiedObservation && vpnData.interface ? vpnData.interface : INFORMATION_UNAVAILABLE}</p>
              {verifiedObservation && vpnData.ip_address && !vpnData.error ? (
                <p className="text-xs text-muted-foreground mt-1">IP: {vpnData.ip_address}</p>
              ) : null}{verifiedObservation && vpnData.listen_port ? (
                <p className="text-xs text-muted-foreground mt-1">Puerto: {vpnData.listen_port}/udp</p>
              ) : null}
            </div>

            <div className="glass-card p-4">
              <div className="flex items-center gap-2 mb-2">
                <Server className="w-4 h-4 text-primary" />
                <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Equipos VPN autorizados</span>
              </div>
              <p className="text-base font-semibold text-foreground">{verifiedObservation ? vpnData.peers_count ?? INFORMATION_UNAVAILABLE : INFORMATION_UNAVAILABLE}</p>
              <p className="text-xs text-muted-foreground mt-1">Conexiones activas verificadas: {verifiedObservation ? vpnData.active_peers ?? INFORMATION_UNAVAILABLE : INFORMATION_UNAVAILABLE}</p>
            </div>

            <div className="glass-card p-4">
              <div className="flex items-center gap-2 mb-2">
                <Activity className="w-4 h-4 text-primary" />
                <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Último intercambio de claves</span>
              </div>
              <p className="text-base font-semibold text-foreground">
                {verifiedObservation && vpnData.last_handshake != null ? `${vpnData.last_handshake}s atrás` : infrastructureMessage('Handshake unavailable')}
              </p>
            </div>
          </div>

          <div className="glass-card p-4 text-sm text-muted-foreground space-y-2">
            <p>Equipo que gestiona la VPN: {platformLabel(vpnData.host_platform)} · Servicio de supervisión VPN: {infrastructureState(vpnData.agent_state)}</p>
            <p>WireGuard: {vpnData.wireguard_installed == null ? 'Pendiente de comprobación' : vpnData.wireguard_installed ? 'Instalado' : 'No instalado'} · Servicio: {infrastructureState(vpnData.service_state || 'unavailable')}</p>
            <p>Estado de configuración: {infrastructureState(vpnData.preparation_state)}</p>
            {vpnData.error && <p role="status" className="break-words">{infrastructureMessage(vpnData.error)}</p>}
          </div>

          {verifiedObservation && vpnData.peers?.length > 0 && <section className="glass-card p-4 space-y-3" aria-label="Equipos VPN autorizados"><h3 className="font-heading font-bold text-foreground">Equipos VPN autorizados</h3>{vpnData.peers.map(peer => <div className="text-sm text-muted-foreground break-all" key={peer.public_key}><p>Clave pública del equipo: {peer.public_key}</p><p>Dirección del equipo: {peer.endpoint || INFORMATION_UNAVAILABLE} · Recepción: {peer.rx_bytes} bytes · Envío: {peer.tx_bytes} bytes</p><p>Último intercambio de claves (UTC): {peer.latest_handshake > 0 ? new Date(peer.latest_handshake * 1000).toISOString() : infrastructureMessage('Handshake unavailable')}</p></div>)}</section>}
          <section className="space-y-3" aria-label="Conectividad con servidores externos"><h3 className="font-heading text-lg font-bold text-foreground">Conectividad con servidores externos</h3><p className="text-sm text-muted-foreground">La verificación del almacenamiento se realiza en Copias de seguridad. Una configuración guardada no acredita una conexión activa.</p><div className="grid xl:grid-cols-3 gap-4">{BACKUP_SLOTS.filter(slot => slot.role !== 'local').map(slot => <BackupDestinationForm key={slot.role} {...slot} server={servers.find(server => server.role === slot.role)} onSaved={load} operationBusy={loading} readOnly />)}</div><a className="inline-block rounded border border-border-subtle px-3 py-2 text-sm" href="/admin?section=backups" onClick={event => { if (onNavigate) { event.preventDefault(); onNavigate('backups'); } }}>Abrir Copias de seguridad</a></section>

          {lastChecked ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Clock className="w-3 h-3" />
              Última comprobación: {lastChecked.toLocaleTimeString('es-ES')}
            </div>
          ) : null}
        </>
      ) : null}
      <AdminInfrastructure view="vpn" active={active} onNavigate={onNavigate} observation={vpnData} />
    </motion.div>
  );
}
