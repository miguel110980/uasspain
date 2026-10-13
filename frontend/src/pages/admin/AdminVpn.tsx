import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { ShieldCheck, Wifi, RefreshCw, AlertTriangle, CheckCircle2, Clock, Activity, Server } from 'lucide-react';
import apiClient from '@/api/apiClient';
import endpoints from '@/api/endpoints';
import BackupDestinationForm, { BACKUP_SLOTS } from '@/components/admin/BackupDestinationForm';

const STATE_MAP = {
  connected: { label: 'Conectada', tone: 'emerald', icon: CheckCircle2 },
  disconnected: { label: 'Desconectada', tone: 'red', icon: AlertTriangle },
  unknown: { label: 'Estado desconocido', tone: 'amber', icon: AlertTriangle },
};

export default function AdminVpn() {
  const [vpnData, setVpnData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastChecked, setLastChecked] = useState(null);
  const [servers, setServers] = useState([]);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [res, destinations] = await Promise.all([apiClient.get(endpoints.vpn.status), apiClient.get(endpoints.backups.servers)]);
      setVpnData(res.data);
      setServers(destinations.data);
      setLastChecked(new Date());
    } catch (err) {
      setError(err?.response?.data?.detail || 'No se pudo obtener el estado de la VPN.');
      setVpnData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const state = vpnData?.state || 'unknown';
  const stateInfo = STATE_MAP[state] || STATE_MAP.unknown;
  const StateIcon = stateInfo.icon;

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-heading text-xl font-bold text-foreground flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-primary" /> VPN WireGuard
          </h2>
          <p className="text-xs text-muted-foreground mt-1">Monitorización del estado del túnel WireGuard. La VPN es gestionada externamente por el sistema operativo.</p>
        </div>
        <button onClick={load} disabled={loading} className="inline-flex items-center gap-2 rounded border border-primary/20 bg-primary/10 px-3 py-2 text-sm text-primary disabled:opacity-50">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Actualizar
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
                <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Estado</span>
              </div>
              <p className={`text-base font-semibold ${stateInfo.tone === 'emerald' ? 'text-success' : stateInfo.tone === 'red' ? 'text-danger' : 'text-warning'}`}>
                {stateInfo.label}
              </p>
            </div>

            <div className="glass-card p-4">
              <div className="flex items-center gap-2 mb-2">
                <Wifi className="w-4 h-4 text-primary" />
                <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Interfaz</span>
              </div>
              <p className="text-base font-semibold text-foreground">{vpnData.interface || '—'}</p>
              {vpnData.ip_address ? (
                <p className="text-xs text-muted-foreground mt-1">IP: {vpnData.ip_address}</p>
              ) : vpnData.listen_port ? (
                <p className="text-xs text-muted-foreground mt-1">Puerto: {vpnData.listen_port}/udp</p>
              ) : null}
            </div>

            <div className="glass-card p-4">
              <div className="flex items-center gap-2 mb-2">
                <Server className="w-4 h-4 text-primary" />
                <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Peers</span>
              </div>
              <p className="text-base font-semibold text-foreground">{vpnData.peers_count ?? 'No disponible'}</p>
              <p className="text-xs text-muted-foreground mt-1">Activos: {vpnData.active_peers ?? 'No disponible'}</p>
            </div>

            <div className="glass-card p-4">
              <div className="flex items-center gap-2 mb-2">
                <Activity className="w-4 h-4 text-primary" />
                <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Último handshake</span>
              </div>
              <p className="text-base font-semibold text-foreground">
                {vpnData.last_handshake != null ? `${vpnData.last_handshake}s atrás` : '—'}
              </p>
            </div>
          </div>

          <div className="glass-card p-4 text-sm text-muted-foreground space-y-2">
            <p>Anfitrión: {vpnData.host_platform || 'No identificado'} · Agente: {vpnData.agent_state || 'NOT_RUN'}</p>
            <p>WireGuard: {vpnData.wireguard_installed == null ? 'No verificado' : vpnData.wireguard_installed ? 'Instalado' : 'No instalado'} · Servicio: {vpnData.service_state || 'No disponible'}</p>
            <p>Preparación: {vpnData.preparation_state || 'NOT_RUN'}</p>
            {vpnData.error && <p role="status">{vpnData.error}</p>}
          </div>

          {vpnData.peers?.length > 0 && <section className="glass-card p-4 space-y-3" aria-label="Peers WireGuard"><h3 className="font-heading font-bold text-foreground">Peers observados</h3>{vpnData.peers.map(peer => <div className="text-sm text-muted-foreground break-all" key={peer.public_key}><p>Clave pública: {peer.public_key}</p><p>Endpoint: {peer.endpoint || 'No disponible'} · Recepción: {peer.rx_bytes} bytes · Envío: {peer.tx_bytes} bytes</p><p>Handshake UTC: {peer.latest_handshake ? new Date(peer.latest_handshake * 1000).toISOString() : 'Sin handshake'}</p></div>)}</section>}
          <section className="space-y-3" aria-label="Monitorización de destinos"><h3 className="font-heading text-lg font-bold text-foreground">Destinos de backup</h3><div className="grid xl:grid-cols-3 gap-4">{BACKUP_SLOTS.map(slot => <BackupDestinationForm key={slot.role} {...slot} server={servers.find(s => s.role === slot.role)} onSaved={load} operationBusy={loading} />)}</div></section>

          {lastChecked ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Clock className="w-3 h-3" />
              Última comprobación: {lastChecked.toLocaleTimeString('es-ES')}
            </div>
          ) : null}
        </>
      ) : null}
    </motion.div>
  );
}
