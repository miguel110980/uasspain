import { windowBoundUrl } from '@/lib/windowSession';
import { useEffect, useState } from 'react';
import apiClient from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';

type Peer = { connection: RTCPeerConnection; candidates: RTCIceCandidateInit[] };
type Signal = { type: string; peer_id?: string; sender_id?: string; to?: string; moderator?: boolean; sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit };

export function useWebrtc(callId: string) {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const [status, setStatus] = useState('Conectando…');
  const [error, setError] = useState('');
  const [moderator, setModerator] = useState(false);
  useEffect(() => {
    let disposed = false;
    let stream: MediaStream | null = null;
    let socket: WebSocket | null = null;
    let ownId = '';
    let reconnect: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    let terminal = false;
    let connecting = false;
    let generation = 0;
    let audioEnabled = true;
    let videoEnabled = true;
    let processing = Promise.resolve();
    const peers = new Map<string, Peer>();
    setLocalStream(null);
    setRemoteStreams({});
    setError('');
    setStatus('Conectando…');
    setModerator(false);
    const removePeer = (id: string) => {
      peers.get(id)?.connection.close();
      peers.delete(id);
      if (!disposed) setRemoteStreams(previous => {
        const next = { ...previous }; delete next[id]; return next;
      });
    };
    const release = () => {
      for (const id of peers.keys()) removePeer(id);
      if (stream) {
        audioEnabled = stream.getAudioTracks()[0]?.enabled ?? audioEnabled;
        videoEnabled = stream.getVideoTracks()[0]?.enabled ?? videoEnabled;
      }
      stream?.getTracks().forEach(track => track.stop());
      stream = null;
      if (!disposed) setLocalStream(null);
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
        if (!disposed && peers.get(id)?.connection === connection && event.candidate) send({ type: 'ice_candidate', to: id, candidate: event.candidate.toJSON() });
      };
      connection.ontrack = event => {
        if (!disposed && peers.get(id)?.connection === connection) setRemoteStreams(previous => ({ ...previous, [id]: event.streams[0] || new MediaStream([event.track]) }));
      };
      connection.onconnectionstatechange = () => {
        if (disposed || peers.get(id)?.connection !== connection) return;
        if (connection.connectionState === 'connected') setStatus('Conectado');
        if (connection.connectionState === 'failed') {
          setError('No se pudo conectar con un participante. Comprueba la red o vuelve a entrar.');
          removePeer(id);
        }
      };
      return entry;
    };
    const retry = () => {
      if (disposed || terminal) return;
      clearTimeout(reconnect);
      if (!navigator.onLine) {
        release();
        setStatus('Sin conexión. Esperando reconexión…');
        return;
      }
      if (++attempts > 3) {
        terminal = true;
        release();
        setError('La llamada ha finalizado o la conexión no está disponible. Vuelve a entrar.');
        return;
      }
      setStatus('Reconectando…');
      reconnect = setTimeout(() => { void connect(); }, 2000);
    };
    const connect = async () => {
      if (disposed || terminal || connecting || socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return;
      if (!navigator.onLine) { setStatus('Sin conexión. Esperando reconexión…'); return; }
      const currentGeneration = generation;
      connecting = true;
      try {
        const response = await apiClient.get<RTCConfiguration>('/api/videollamadas/ice/');
        if (disposed || currentGeneration !== generation || !navigator.onLine) return;
        if (!stream) {
          try {
            const acquired = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
            if (disposed || currentGeneration !== generation || !navigator.onLine) { acquired.getTracks().forEach(track => track.stop()); return; }
            acquired.getAudioTracks().forEach(track => { track.enabled = audioEnabled; });
            acquired.getVideoTracks().forEach(track => { track.enabled = videoEnabled; });
            stream = acquired;
          } catch (failure) {
            if (disposed || currentGeneration !== generation) return;
            terminal = true;
            const name = failure instanceof DOMException ? failure.name : '';
            setError(name === 'NotReadableError' ? 'La cámara o el micrófono están ocupados o no se pueden utilizar. Cierra la otra llamada y vuelve a entrar.' : name === 'NotFoundError' ? 'No se encuentra cámara o micrófono. Comprueba los dispositivos y vuelve a entrar.' : 'Permite el acceso a cámara y micrófono para entrar en la llamada.');
            release();
            return;
          }
          if (disposed) { release(); return; }
          setLocalStream(stream);
        }
        const config = response.data;
        const current = new WebSocket(windowBoundUrl(endpoints.ws.videollamada(callId)));
        socket = current;
        current.onmessage = event => {
          processing = processing.then(async () => {
            if (disposed || socket !== current) return;
            const signal: Signal = JSON.parse(event.data);
            if (signal.type === 'welcome') {
              attempts = 0;
              setError('');
              ownId = signal.peer_id || '';
              setModerator(signal.moderator === true);
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
                if (disposed || socket !== current) return;
                send({ type: 'offer', to: id, sdp: entry.connection.localDescription?.toJSON() });
              } else if (signal.type === 'join') send({ type: 'pong', to: id });
            } else if ((signal.type === 'offer' || signal.type === 'answer') && signal.sdp) {
              await entry.connection.setRemoteDescription(signal.sdp);
              if (disposed || socket !== current) return;
              for (const candidate of entry.candidates.splice(0)) await entry.connection.addIceCandidate(candidate);
              if (signal.type === 'offer') {
                await entry.connection.setLocalDescription(await entry.connection.createAnswer());
                if (disposed || socket !== current) return;
                send({ type: 'answer', to: id, sdp: entry.connection.localDescription?.toJSON() });
              }
            } else if (signal.type === 'ice_candidate' && signal.candidate) {
              if (entry.connection.remoteDescription) await entry.connection.addIceCandidate(signal.candidate);
              else entry.candidates.push(signal.candidate);
            }
          }).catch(() => { if (!disposed && socket === current) setError('No se pudo negociar la conexión. Vuelve a entrar en la llamada.'); });
        };
        current.onerror = () => current.close();
        current.onclose = (event) => {
          if (disposed || socket !== current) return;
          for (const id of peers.keys()) removePeer(id);
          if (event.code === 1008) {
            terminal = true;
            release();
            setError('La sesión ha finalizado.');
            void apiClient.get(endpoints.auth.me).catch(() => {});
            return;
          }
          retry();
        };
      } catch (failure) {
        if (disposed || terminal || currentGeneration !== generation) return;
        const status = (failure as { response?: { status?: number } })?.response?.status;
        if (status === 401 || status === 403) {
          terminal = true;
          release();
          setError('No tienes acceso a la llamada o tu sesión ha finalizado.');
        } else retry();
      } finally {
        connecting = false;
        if (!disposed && !terminal && currentGeneration !== generation && navigator.onLine) retry();
      }
    };
    const offline = () => {
      if (disposed || terminal) return;
      clearTimeout(reconnect);
      generation++;
      const previous = socket;
      socket = null;
      previous?.close();
      release();
      setStatus('Sin conexión. Esperando reconexión…');
    };
    const online = () => { if (!disposed && !terminal) { attempts = 0; retry(); } };
    window.addEventListener('offline', offline);
    window.addEventListener('online', online);
    void connect();
    return () => { disposed = true; generation++; clearTimeout(reconnect); window.removeEventListener('offline', offline); window.removeEventListener('online', online); socket?.close(); release(); };
  }, [callId]);
  return { localStream, remoteStreams, status, error, moderator };
}
