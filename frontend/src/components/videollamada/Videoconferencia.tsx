import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { PhoneOff, Video, Mic, MicOff, VideoOff } from 'lucide-react';
import { useWebrtc } from '@/hooks/useWebrtc';

function StreamVideo({ stream, muted = false, label }: { stream: MediaStream; muted?: boolean; label: string }) {
  const video = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    const element = video.current;
    if (element) element.srcObject = stream;
    return () => { if (element) element.srcObject = null; };
  }, [stream]);
  return <video ref={video} autoPlay playsInline muted={muted} aria-label={label} className="w-full h-full max-h-[70vh] object-contain bg-black" />;
}

export default function Videoconferencia({ callId, displayName, onColgar }: {
  callId: string; displayName: string; onColgar: () => void;
}) {
  const { localStream, remoteStreams, status, error, moderator } = useWebrtc(callId);
  const [mic, setMic] = useState(true);
  const [camera, setCamera] = useState(true);
  const toggleMic = () => {
    localStream?.getAudioTracks().forEach(track => { track.enabled = !mic; });
    setMic(!mic);
  };
  const toggleCamera = () => {
    localStream?.getVideoTracks().forEach(track => { track.enabled = !camera; });
    setCamera(!camera);
  };
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      role="dialog" aria-modal="true" aria-label="Videollamada UASSPAIN"
      className="fixed inset-0 z-[60] bg-background/98 backdrop-blur-xl flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-6 py-3 border-b border-border-subtle bg-card/80">
        <div className="flex items-center gap-3">
          <Video className="w-5 h-5 text-primary" />
          <div>
            <h3 className="font-heading text-sm font-bold text-foreground">Videollamada en curso</h3>
            <p role="status" className="text-xs text-muted-foreground">{status}</p>
            <p className="text-xs text-primary">{moderator ? 'Moderador' : 'Participante'}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={toggleMic} disabled={!localStream} aria-label={mic ? 'Silenciar micrófono' : 'Activar micrófono'}
            className="p-2 border border-border-subtle text-foreground">{mic ? <Mic /> : <MicOff />}</button>
          <button onClick={toggleCamera} disabled={!localStream} aria-label={camera ? 'Apagar cámara' : 'Activar cámara'}
            className="p-2 border border-border-subtle text-foreground">{camera ? <Video /> : <VideoOff />}</button>
          <button onClick={onColgar} className="flex items-center gap-2 bg-danger text-white px-4 py-2 font-bold text-xs">
            <PhoneOff className="w-4 h-4" /> Colgar
          </button>
        </div>
      </div>
      {error && <p role="alert" className="text-danger px-6 py-3">{error}</p>}
      <div className="flex-1 overflow-auto p-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
        {localStream && <div><StreamVideo stream={localStream} muted label="Tu cámara" /><p className="text-sm text-foreground">{displayName} (tú)</p></div>}
        {Object.entries(remoteStreams).map(([id, remote], index) => (
          <div key={id}><StreamVideo stream={remote} label={`Cámara participante ${index + 1}`} /><p className="text-sm text-foreground">Participante {index + 1}</p></div>
        ))}
      </div>
    </motion.div>
  );
}
