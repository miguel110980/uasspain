import React from 'react';
import { motion } from 'framer-motion';
import { PhoneOff, Video } from 'lucide-react';

export default function Videoconferencia({ roomName, displayName, onColgar }) {
  const jitsiUrl = `https://meet.jit.si/${roomName}#config.prejoinPageEnabled=false&config.startWithVideoMuted=false&config.startAudioMuted=false&userInfo.displayName=${encodeURIComponent(displayName || 'Usuario')}`;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[60] bg-background/98 backdrop-blur-xl flex flex-col"
    >
      {/* Barra superior */}
      <div className="flex items-center justify-between px-4 sm:px-6 py-3 border-b border-border-subtle bg-card/80">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 flex items-center justify-center bg-primary/10 border border-primary/20 rounded-sm">
            <Video className="w-4 h-4 text-primary" />
          </div>
          <div>
            <h3 className="font-heading text-sm font-bold text-foreground leading-none">Videollamada en curso</h3>
            <p className="text-[10px] text-muted-foreground font-mono mt-1">Sala: {roomName}</p>
          </div>
        </div>
        <button
          onClick={onColgar}
          className="inline-flex items-center gap-2 bg-danger/90 hover:bg-danger text-white px-4 sm:px-6 py-2 font-bold uppercase tracking-tighter text-xs transition-all duration-200"
        >
          <PhoneOff className="w-4 h-4" />
          Colgar
        </button>
      </div>

      {/* Iframe Jitsi */}
      <div className="flex-1 bg-black">
        <iframe
          src={jitsiUrl}
          allow="camera; microphone; fullscreen; display-capture; autoplay; clipboard-write"
          className="w-full h-full border-0"
          title="Videollamada UASSPAIN"
        />
      </div>
    </motion.div>
  );
}