import { usePanelAuthContext } from '@/context/PanelAuthContext';
import { useActiveProfileSessions } from '@/hooks/useActiveProfileSessions';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Send, Loader2, MessageCircle } from 'lucide-react';
import { usePrivateStudentChat } from '@/hooks/usePrivateStudentChat';
import { sanitizeInput } from '@/lib/sanitize';
import ChatExportPdfButton from '@/components/chat/ChatExportPdfButton';

export default function AlumnoChat({ alumnoId, alumnoNombre }) {
  const [texto, setTexto] = useState('');
  const { profile } = usePanelAuthContext();
  const { isOnline } = useActiveProfileSessions();
  const hasInstructor = Boolean(profile?.assigned_instructor_id);
  const instructorName = profile?.assigned_instructor_name || (hasInstructor ? 'Instructor asignado' : 'Sin instructor asignado');
  const instructorConectado = isOnline(profile?.assigned_instructor_id);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const previousMessages = useRef<any[]>([]);
  const [newMessageCount, setNewMessageCount] = useState(0);
  const chat = usePrivateStudentChat(String(alumnoId || ''), 'alumno', {
    enabled:hasInstructor,
    isVisible:() => Boolean(scrollContainerRef.current?.getClientRects().length),
  });
  const { messages:mensajes, loading, sending, error } = chat;
  const handleScroll = useCallback(() => {
    const element = scrollContainerRef.current;
    if (element && element.scrollHeight - element.scrollTop - element.clientHeight < 80) setNewMessageCount(0);
  }, []);
  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior:'smooth', block:'end' });
    setNewMessageCount(0);
  }, []);
  useEffect(() => {
    const element = scrollContainerRef.current;
    const atBottom = !element || element.scrollHeight - element.scrollTop - element.clientHeight < 80;
    const known = new Set(previousMessages.current.map(m => m.id));
    const incoming = mensajes.filter(m => !known.has(m.id) && m.remitente === 'instructor');
    if (incoming.length && previousMessages.current.length && !atBottom) setNewMessageCount(count => count + incoming.length);
    if (atBottom) requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ block:'end' }));
    previousMessages.current = mensajes;
    if (!mensajes.length) setNewMessageCount(0);
  }, [mensajes]);
  const handleSend = async event => {
    event.preventDefault();
    const content = sanitizeInput(texto, 'message');
    if (!content.trim() || sending || !chat.canSend) return;
    try {
      await chat.send(content);
      setTexto(current => current === texto ? '' : current);
    } catch { /* Keep the student's draft and show the actual channel error. */ }
  };
  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
      <div className="mb-8">
        <div className="inline-flex items-center gap-2 mb-3 px-3 py-1.5 border border-primary/20 bg-primary/5 text-primary text-xs font-mono uppercase tracking-widest">
          Chat
        </div>
        <h2 className="font-heading text-2xl font-bold text-foreground tracking-tight">Chat con el Instructor</h2>
        <p className="text-sm text-muted-foreground mt-1">Escribe tus dudas y el instructor te responderá aquí.</p>
        {!hasInstructor && <p role="status" className="text-sm text-muted-foreground mt-2">Aún no tienes un instructor asignado.</p>}{error && <p role="alert" className="text-sm text-destructive mt-2">{error} <button onClick={chat.retry} className="underline">Reintentar</button></p>}
      </div>

      <div className="glass-card flex flex-col md:flex-row h-[60vh]">
        <div className="md:w-56 shrink-0 border-b md:border-b-0 md:border-r border-border-subtle p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-primary font-bold shrink-0">
              I
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground truncate">{instructorName}</p>
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
                participantB={instructorName}
                messages={mensajes}
                mapMessage={(m) => ({
                  author: m.remitente === 'instructor' ? instructorName : (alumnoNombre || 'Alumno'),
                  content: m.contenido || m.texto,
                  created_date: m.created_date,
                })}
              />
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
            <input aria-label="Escribe un mensaje..."
              type="text"
              value={texto} disabled={!chat.canSend}
              onChange={(e) => setTexto(e.target.value)}
              placeholder="Escribe un mensaje..."
              className="flex-1 min-w-0 bg-surface-muted border border-border-subtle focus:border-transparent text-foreground placeholder:text-muted-foreground/40 px-4 py-2.5 text-sm outline-none transition-colors rounded-sm"
            />
            <button
              type="submit"
                  aria-label="Enviar mensaje"
              disabled={sending || !texto.trim() || !chat.canSend}
              className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-5 py-2.5 font-bold uppercase tracking-tighter text-xs hover:bg-primary/80 transition-all duration-300 disabled:opacity-50"
            >
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </form>
        </div>
      </div>
    </motion.div>
  );
}
