import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Send, Loader2, MessageCircle, Trash2, X } from 'lucide-react';
import conexionesService from '@/services/conexionesService';
import { sanitizeInput } from '@/lib/sanitize';
import ChatExportPdfButton from '@/components/chat/ChatExportPdfButton';
import { usePanelAuthContext } from '@/context/PanelAuthContext';
import { profileDisplayName } from '@/lib/staffChat';

export default function AlumnoChat({ alumnoId, alumnoNombre }) {
  const { profile } = usePanelAuthContext();
  const instructorNombre = profileDisplayName(profile);
  const [mensajes, setMensajes] = useState([]);
  const [texto, setTexto] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [instructorConectado, setInstructorConectado] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [clearing, setClearing] = useState(false);
  const bottomRef = useRef(null);
  const scrollContainerRef = useRef(null);
  const isAtBottomRef = useRef(true);
  const [newMessageCount, setNewMessageCount] = useState(0);

  useEffect(() => {
    if (!alumnoId) return undefined;
    loadMensajes();
    loadEstadoInstructor();
    const onVisible = () => {
      if (document.visibilityState === 'visible') loadMensajes();
    };
    document.addEventListener('visibilitychange', onVisible);
    const unsubscribeChat = conexionesService.subscribeChatRoom(alumnoId, (event) => {
      const payload = conexionesService.parseWsPayload(event);
      if (payload?.type === 'mensaje' && payload?.data) {
        const msg = payload.data;
        if (msg.remitente !== 'alumno') {
          setMensajes((prev) => {
            if (prev.some((m) => m.id === msg.id)) return prev;
            return [...prev, msg];
          });
          setNewMessageCount((c) => c + 1);
        }
      } else if (event.type === 'poll') {
        loadMensajes();
      }
    });
    const unsubscribeConexion = conexionesService.subscribeConexiones((event) => {
      const payload = conexionesService.parseWsPayload(event);
      if (payload?.type === 'conexion' || event.type === 'poll') loadEstadoInstructor();
    });
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      unsubscribeChat();
      unsubscribeConexion();
    };
  }, [alumnoId]);

  const loadEstadoInstructor = async () => {
    const data = await conexionesService.conexiones.filter({ alumno_id: alumnoId }, '-fecha_conexion', 1);
    setInstructorConectado(data.length > 0 && !data[0].fecha_desconexion);
  };

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const threshold = 80;
    isAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
    if (isAtBottomRef.current) setNewMessageCount(0);
  }, []);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    setNewMessageCount(0);
  }, []);

  const loadMensajes = async () => {
    if (!alumnoId) return;
    try {
      const data = await conexionesService.mensajes.filter(
        { alumno_id: String(alumnoId) },
        'created_date',
      );
      setMensajes(Array.isArray(data) ? data : []);
      setError('');
      const noLeidos = data.filter((m) => m.remitente === 'instructor' && !m.leido_alumno);
      noLeidos.forEach((m) => conexionesService.mensajes.update(m.id, { leido_alumno: true }));
    } catch {
      setError('No se pudieron cargar los mensajes. Inténtalo de nuevo.');
    } finally {
      setLoading(false);
    }
  };

  const handleSend = async (e) => {
    e.preventDefault();
    const contenido = sanitizeInput(texto, 'message');
    if (!contenido.trim()) return;
    setSending(true);
    setError('');
    try {
      const created = await conexionesService.mensajes.create({
        alumno_nombre: alumnoNombre,
        remitente: 'alumno',
        contenido,
      });
      setTexto('');
      setMensajes((prev) => {
        if (prev.some((m) => m.id === created.id)) return prev;
        return [...prev, created];
      });
      scrollToBottom();
      loadMensajes();
    } catch {
      setError('No se pudo enviar el mensaje. Comprueba tu conexión e inténtalo de nuevo.');
    } finally {
      setSending(false);
    }
  };

  const handleClearChat = async () => {
    if (!alumnoId || clearing) return;
    setClearing(true);
    setError('');
    try {
      await conexionesService.mensajes.clearChat(alumnoId);
      setMensajes([]);
      setShowClearConfirm(false);
    } catch (err) {
      const msg = err?.response?.data?.detail || err?.message || 'No se pudo limpiar la conversación.';
      setError(msg);
    } finally {
      setClearing(false);
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
      <div className="mb-8">
        <div className="inline-flex items-center gap-2 mb-3 px-3 py-1.5 border border-primary/20 bg-primary/5 text-primary text-xs font-mono uppercase tracking-widest">
          Chat
        </div>
        <h2 className="font-heading text-2xl font-bold text-foreground tracking-tight">Chat con el Instructor</h2>
        <p className="text-sm text-muted-foreground mt-1">Escribe tus dudas y el instructor te responderá aquí.</p>
        {error && <p className="text-sm text-destructive mt-2">{error}</p>}
      </div>

      <div className="glass-card flex flex-col md:flex-row h-[60vh]">
        <div className="md:w-56 shrink-0 border-b md:border-b-0 md:border-r border-border-subtle p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-primary font-bold shrink-0">
              I
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground truncate">Instructor</p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className={`w-2 h-2 rounded-full ${instructorConectado ? 'bg-success' : 'bg-muted-foreground/40'}`} />
                <span className="text-xs text-muted-foreground">{instructorConectado ? 'Conectado' : 'Desconectado'}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex items-center justify-between gap-2 px-4 py-2 border-b border-border-subtle">
            <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Conversación</p>
            <div className="flex items-center gap-2">
              <ChatExportPdfButton
                title="Chat con instructor — UASSPAIN"
                participantA={alumnoNombre || 'Alumno'}
                participantB="Instructor"
                messages={mensajes}
                mapMessage={(m) => ({
                  author: m.remitente === 'instructor' ? 'Instructor' : (alumnoNombre || 'Alumno'),
                  content: m.contenido || m.texto,
                  created_date: m.created_date,
                })}
              />
              <button
                type="button"
                onClick={() => setShowClearConfirm(true)}
                disabled={!mensajes.length}
                title="Limpiar conversación"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-mono uppercase tracking-widest border border-border-subtle text-muted-foreground hover:border-danger/40 hover:text-danger transition-colors rounded-sm disabled:opacity-40 disabled:pointer-events-none"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Limpiar
              </button>
            </div>
          </div>
          <div
            ref={scrollContainerRef}
            onScroll={handleScroll}
            className="flex-1 overflow-y-auto p-6 space-y-4 relative"
          >
            {loading ? (
              <div className="flex items-center justify-center h-full">
                <Loader2 className="w-6 h-6 text-primary animate-spin" />
              </div>
            ) : mensajes.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <MessageCircle className="w-10 h-10 text-muted-foreground mb-3" />
                <p className="text-sm text-muted-foreground">Aún no hay mensajes. Escribe al instructor.</p>
              </div>
            ) : (
              mensajes.map((m) => (
                <div key={m.id} className={`flex ${m.remitente === 'alumno' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[75%] px-4 py-2.5 text-sm rounded-sm ${
                      m.remitente === 'alumno'
                        ? 'bg-primary/10 border border-primary/20 text-foreground'
                        : 'bg-surface-muted border border-border-subtle text-foreground'
                    }`}
                  >
                    <p className="whitespace-pre-wrap break-words">{m.contenido || m.texto}</p>
                    <p className="text-[10px] text-muted-foreground/60 mt-1 font-mono">
                      {new Date(m.created_date).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
              ))
            )}
            <div ref={bottomRef} />
            {newMessageCount > 0 && (
              <button
                type="button"
                onClick={scrollToBottom}
                className="sticky bottom-2 left-1/2 -translate-x-1/2 z-10 bg-primary text-primary-foreground text-xs font-bold px-4 py-1.5 rounded-full shadow-lg hover:bg-primary/90 transition-all"
              >
                {newMessageCount} {newMessageCount === 1 ? 'nuevo mensaje' : 'nuevos mensajes'}
              </button>
            )}
          </div>

          <form onSubmit={handleSend} className="border-t border-border-subtle p-4 flex items-center gap-3">
            <input
              type="text"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder="Escribe un mensaje..."
              className="flex-1 bg-surface-muted border border-border-subtle focus:border-transparent text-foreground placeholder:text-muted-foreground/40 px-4 py-2.5 text-sm outline-none transition-colors rounded-sm"
            />
            <button
              type="submit"
              disabled={sending || !texto.trim()}
              className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-5 py-2.5 font-bold uppercase tracking-tighter text-xs hover:bg-primary/80 transition-all duration-300 disabled:opacity-50"
            >
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </form>
        </div>
      </div>

      {showClearConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
          <div className="w-full max-w-sm glass-card p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-heading text-lg font-bold text-foreground">Limpiar chat</h3>
              <button onClick={() => setShowClearConfirm(false)} className="text-muted-foreground hover:text-foreground">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-muted-foreground">
              ¿Quieres limpiar esta conversación?
            </p>
            <p className="text-xs text-muted-foreground">
              Se eliminarán los mensajes de este chat. Esta acción no se puede deshacer.
            </p>
            {error && (
              <p className="text-xs text-danger bg-danger-soft border border-danger-border px-3 py-2 rounded-sm">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => setShowClearConfirm(false)}
                className="px-4 py-2 text-xs font-bold uppercase tracking-widest border border-border-subtle text-muted-foreground hover:text-foreground transition-all"
              >
                Cancelar
              </button>
              <button
                onClick={handleClearChat}
                disabled={clearing}
                className="px-4 py-2 text-xs font-bold uppercase tracking-widest bg-danger-soft border border-danger-border text-danger hover:bg-danger/20 transition-all disabled:opacity-50"
              >
                {clearing ? <Loader2 className="w-4 h-4 animate-spin inline mr-1" /> : null}
                Limpiar chat
              </button>
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
}