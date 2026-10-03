import { windowBoundUrl } from '@/lib/windowSession';
import { useEffect, useState } from 'react';
import apiClient from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';

type Peer = { connection: RTCPeerConnection; candidates: RTCIceCandidateInit[] };
type Signal = { type: string; peer_id?: string; sender_id?: string; to?: string; sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit };

export function useWebrtc(callId: string) {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const [status, setStatus] = useState('Conectando…');
  const [error, setError] = useState('');
  useEffect(() => {
    let disposed = false;
    let stream: MediaStream | null = null;
    let socket: WebSocket | null = null;
    let ownId = '';
    let reconnect: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    let processing = Promise.resolve();
    const peers = new Map<string, Peer>();
    const removePeer = (id: string) => {
      peers.get(id)?.connection.close();
      peers.delete(id);
      if (!disposed) setRemoteStreams(previous => {
        const next = { ...previous }; delete next[id]; return next;
      });
    };
    const release = () => {
      for (const id of peers.keys()) removePeer(id);
      stream?.getTracks().forEach(track => track.stop());
    };
    const send = (signal: Signal) => {
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(signal));
    };
    const peer = (id: string, config: RTCConfiguration) => {
      const existing = peers.get(id);
      if (existing) return existing;
      const connection = new RTCPeerConnection(config);
      const entry: Peer = { connection, candidates: [] };
      peers.set(id, entry);
      stream?.getTracks().forEach(track => connection.addTrack(track, stream!));
      connection.onicecandidate = event => {
        if (event.candidate) send({ type: 'ice_candidate', to: id, candidate: event.candidate.toJSON() });
      };
      connection.ontrack = event => {
        if (!disposed) setRemoteStreams(previous => ({ ...previous, [id]: event.streams[0] || new MediaStream([event.track]) }));
      };
      connection.onconnectionstatechange = () => {
        if (disposed) return;
        if (connection.connectionState === 'connected') setStatus('Conectado');
        if (connection.connectionState === 'failed') {
          setError('No se pudo conectar con un participante. Comprueba la red o vuelve a entrar.');
          removePeer(id);
        }
      };
      return entry;
    };
    const connect = async () => {
      try {
        const response = await apiClient.get<RTCConfiguration>('/api/videollamadas/ice/');
        if (disposed) return;
        const config = response.data;
        const current = new WebSocket(windowBoundUrl(endpoints.ws.videollamada(callId)));
        socket = current;
        current.onmessage = event => {
          processing = processing.then(async () => {
            if (disposed || socket !== current) return;
            const signal: Signal = JSON.parse(event.data);
            if (signal.type === 'welcome') {
              ownId = signal.peer_id || '';
              setStatus('Esperando participantes…');
              return;
            }
            const id = signal.sender_id;
            if (!id || id === ownId || (signal.to && signal.to !== ownId)) return;
            if (signal.type === 'hangup') { removePeer(id); return; }
            const entry = peer(id, config);
            if (signal.type === 'join' || signal.type === 'pong') {
              if (ownId < id && entry.connection.signalingState === 'stable') {
                await entry.connection.setLocalDescription(await entry.connection.createOffer());
                send({ type: 'offer', to: id, sdp: entry.connection.localDescription?.toJSON() });
              } else if (signal.type === 'join') send({ type: 'pong', to: id });
            } else if ((signal.type === 'offer' || signal.type === 'answer') && signal.sdp) {
              await entry.connection.setRemoteDescription(signal.sdp);
              for (const candidate of entry.candidates.splice(0)) await entry.connection.addIceCandidate(candidate);
              if (signal.type === 'offer') {
                await entry.connection.setLocalDescription(await entry.connection.createAnswer());
                send({ type: 'answer', to: id, sdp: entry.connection.localDescription?.toJSON() });
              }
            } else if (signal.type === 'ice_candidate' && signal.candidate) {
              if (entry.connection.remoteDescription) await entry.connection.addIceCandidate(signal.candidate);
              else entry.candidates.push(signal.candidate);
            }
          }).catch(() => { if (!disposed) setError('No se pudo negociar la conexión. Vuelve a entrar en la llamada.'); });
        };
        current.onerror = () => current.close();
        current.onclose = () => {
          if (disposed || socket !== current) return;
          for (const id of peers.keys()) removePeer(id);
          if (++attempts <= 3) {
            setStatus('Reconectando…');
            reconnect = setTimeout(() => { void connect(); }, 2000);
          } else {
            release();
            setError('La llamada ha finalizado o la conexión no está disponible.');
          }
        };
      } catch {
        if (!disposed) { release(); setError('No tienes acceso a la llamada o no se pudo conectar.'); }
      }
    };
    const start = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        if (disposed) { release(); return; }
        setLocalStream(stream);
        await connect();
      } catch {
        if (!disposed) setError('Permite el acceso a cámara y micrófono para entrar en la llamada.');
      }
    };
    void start();
    return () => { disposed = true; clearTimeout(reconnect); socket?.close(); release(); };
  }, [callId]);
  return { localStream, remoteStreams, status, error };
}
