import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import conexionesService from '@/services/conexionesService';
import { Video, Phone, Loader2, VideoIcon, Bell, User } from 'lucide-react';
import Videoconferencia from '@/components/videollamada/Videoconferencia';

export default function AlumnoVideo({ alumnoId, alumnoNombre }) {
  const [llamadaActiva, setLlamadaActiva] = useState(null);
  const [enLlamada, setEnLlamada] = useState(false);
  const [loading, setLoading] = useState(true);
  const [iniciando, setIniciando] = useState(false);
  const [callError, setCallError] = useState('');

  useEffect(() => {
    if (!alumnoId) return;
    let mounted = true;
    const load = async () => {
      try {
        const activas = await conexionesService.videollamadas.filter({ alumno_id: alumnoId, estado: 'activa' });
        if (mounted) {
          setLlamadaActiva(previous => activas.find(call => call.id === previous?.id) || activas[0] || null);
          if (!activas.length) setEnLlamada(false);
          setLoading(false);
        }
      } catch {
        if (mounted) setLoading(false);
      }
    };
    load();
    const unsubscribe = conexionesService.subscribeVideollamadas(() => load());
    return () => { mounted = false; unsubscribe(); };
  }, [alumnoId]);

  const handleIniciar = async () => {
    setIniciando(true);
    try {
      const nueva = await conexionesService.videollamadas.create({
        alumno_id: alumnoId,
        alumno_nombre: alumnoNombre,
        estado: 'activa',
        iniciada_por: 'alumno',
      });
      setLlamadaActiva(nueva);
      setEnLlamada(true);
    } catch {
      setCallError('No se pudo iniciar la llamada. Comprueba tu conexión y contacta con tu instructor.');
    } finally {
      setIniciando(false);
    }
  };

  const handleColgar = async () => {
    setEnLlamada(false);
    if (llamadaActiva) {
      try {
        await conexionesService.videollamadas.update(llamadaActiva.id, { estado: 'finalizada' });
      } catch { /* noop */ }
      setLlamadaActiva(null);
    }
  };

  const handleUnirse = () => {
    setEnLlamada(true);
  };

  if (enLlamada && llamadaActiva) {
    return (
      <Videoconferencia
        callId={llamadaActiva.id}
        displayName={alumnoNombre}
        onColgar={handleColgar}
      />
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  const llamadaEntrante = llamadaActiva && llamadaActiva.iniciada_por === 'instructor';

  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="max-w-2xl">
      <div className="mb-8">
        <div className="inline-flex items-center gap-2 mb-3 px-3 py-1.5 border border-primary/20 bg-primary/5 text-primary text-xs font-mono uppercase tracking-widest">
          <Video className="w-3.5 h-3.5" /> Videollamada
        </div>
        <h2 className="font-heading text-2xl font-bold text-foreground tracking-tight">Videoconferencia</h2>
        <p className="text-sm text-muted-foreground mt-1">Comunicación por vídeo con tu instructor.</p>
      </div>

      {/* Llamada entrante */}
      {callError && <p role="alert" className="text-sm text-danger mb-4">{callError}</p>}
      <AnimatePresence>
        {llamadaEntrante && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="glass-card p-8 mb-6 border-primary/30 relative overflow-hidden"
          >
            <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
            <div className="flex flex-col items-center text-center">
              <div className="relative mb-4">
                <div className="w-16 h-16 flex items-center justify-center bg-primary/10 border border-primary/30 rounded-full">
                  <Bell className="w-7 h-7 text-primary" />
                </div>
                <div className="absolute inset-0 rounded-full border border-primary/20 animate-ping" />
              </div>
              <h3 className="font-heading text-lg font-bold text-foreground mb-1">Llamada entrante</h3>
              <p className="text-sm text-muted-foreground mb-6">Tu instructor te está llamando. ¿Deseas unirte?</p>
              <button
                onClick={handleUnirse}
                className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-8 py-3 font-bold uppercase tracking-tighter text-sm hover:bg-primary/80 transition-all duration-300"
              >
                <Video className="w-4 h-4" />
                Unirse a la llamada
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Estado actual */}
      {!llamadaEntrante && (
        <div className="glass-card p-8">
          <div className="flex flex-col items-center text-center">
            <div className="w-16 h-16 flex items-center justify-center bg-surface-muted border border-border-subtle rounded-full mb-4">
              <VideoIcon className="w-7 h-7 text-muted-foreground" />
            </div>

            {llamadaActiva ? (
              <>
                <h3 className="font-heading text-lg font-bold text-foreground mb-1">Llamada activa</h3>
                <p className="text-sm text-muted-foreground mb-6">Tienes una videollamada en curso. Puedes volver a unirte.</p>
                <button
                  onClick={handleUnirse}
                  className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-8 py-3 font-bold uppercase tracking-tighter text-sm hover:bg-primary/80 transition-all duration-300"
                >
                  <Phone className="w-4 h-4" />
                  Reunirse
                </button>
              </>
            ) : (
              <>
                <h3 className="font-heading text-lg font-bold text-foreground mb-1">Sin llamadas activas</h3>
                <p className="text-sm text-muted-foreground mb-6">Puedes iniciar una videollamada para hablar con tu instructor.</p>
                <button
                  onClick={handleIniciar}
                  disabled={iniciando}
                  className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-8 py-3 font-bold uppercase tracking-tighter text-sm hover:bg-primary/80 transition-all duration-300 disabled:opacity-50"
                >
                  {iniciando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Video className="w-4 h-4" />}
                  {iniciando ? 'Iniciando...' : 'Iniciar videollamada'}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Info */}
      <div className="mt-6 flex items-start gap-3 text-xs text-muted-foreground/70 px-4">
        <User className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        <p>La videoconferencia se abre en una ventana a pantalla completa. Permite el acceso a cámara y micrófono cuando el navegador lo solicite. Cuando finalices, pulsa «Colgar» para cerrar la sala.</p>
      </div>
    </motion.div>
  );
}
