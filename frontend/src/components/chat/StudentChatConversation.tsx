import { useEffect, useRef, useState } from 'react';
import { Loader2, Send, Trash2, X } from 'lucide-react';
import { usePrivateStudentChat } from '@/hooks/usePrivateStudentChat';
import { sanitizeInput } from '@/lib/sanitize';
import RoleBadge from '@/components/RoleBadge';
import PanelModal from '@/components/ui/PanelModal';
import ChatExportPdfButton from '@/components/chat/ChatExportPdfButton';

/** Each open student's conversation owns its draft, requests and controls. */
export default function StudentChatConversation({ student, instructorName, onClose, onChanged }) {
  const [draft, setDraft] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const [newMessages, setNewMessages] = useState(0);
  const region = useRef<HTMLElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const previousMessages = useRef<any[]>([]);
  const visible = useRef(false);
  const studentId = String(student.alumnoId);
  const chat = usePrivateStudentChat(studentId, 'instructor', { isVisible: () => visible.current, onChanged });
  const { messages, loading, sending, clearing, error, load } = chat;
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => {
      visible.current = entry.isIntersecting;
      if (entry.isIntersecting) void load();
    });
    if (region.current) observer.observe(region.current);
    return () => observer.disconnect();
  }, [load]);
  useEffect(() => {
    const known = new Set(previousMessages.current.map(message => message.id));
    const incoming = messages.filter(message => !known.has(message.id) && message.remitente === 'alumno');
    const atBottom = !scroll.current || scroll.current.scrollHeight - scroll.current.scrollTop - scroll.current.clientHeight < 80;
    if (incoming.length && previousMessages.current.length && !atBottom) setNewMessages(count => count + incoming.length);
    if (atBottom) requestAnimationFrame(() => scroll.current?.scrollTo({ top:scroll.current.scrollHeight }));
    previousMessages.current = messages;
    if (!messages.length) setNewMessages(0);
  }, [messages]);
  const send = async event => {
    event.preventDefault();
    const content = sanitizeInput(draft, 'message');
    if (!content.trim() || sending) return;
    try {
      await chat.send(content);
      setDraft(current => current === draft ? '' : current);
    } catch { /* The private channel retains the draft and shows the error. */ }
  };
  const clear = async () => {
    try { await chat.clear(); setConfirmClear(false); setNewMessages(0); }
    catch { /* The private channel shows the actual moderation error. */ }
  };
  return (
    <section ref={region} aria-label={`Conversación con ${student.nombre}`} className="glass-card flex flex-col min-w-0 h-[32rem] max-h-[75dvh]">
      <div className="p-3 border-b border-border-subtle flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <h3 className="text-sm font-semibold break-words">{student.nombre}</h3>
          {student.profile && <RoleBadge profile={student.profile} />}
        </div>
        <div className="flex items-center gap-1">
          <ChatExportPdfButton title="Chat con alumno — UASSPAIN" participantA={instructorName} participantB={student.nombre}
            messages={messages} mapMessage={message => ({ author: message.remitente === 'instructor' ? instructorName : student.nombre, content: message.contenido || message.texto, created_date: message.created_date })} />
          <button type="button" aria-label="Limpiar conversación" disabled={!messages.length || clearing || sending}
            onClick={() => setConfirmClear(true)} className="p-2 text-muted-foreground hover:text-danger disabled:opacity-40">
            <Trash2 className="w-4 h-4" />
          </button>
          <button type="button" aria-label={`Cerrar chat con ${student.nombre}`} onClick={onClose} className="p-2 text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
      {error && <div role="alert" className="px-3 pt-2 text-sm text-destructive">{error}
        <button type="button" onClick={chat.retry} className="ml-2 underline">Reintentar</button>
      </div>}
      <div ref={scroll} onScroll={() => {
        const element = scroll.current;
        if (element && element.scrollHeight - element.scrollTop - element.clientHeight < 80) setNewMessages(0);
      }} className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 space-y-3">
        {loading && <Loader2 aria-label="Cargando mensajes" className="w-5 h-5 animate-spin mx-auto" />}
        {!loading && !messages.length && <p className="text-xs text-muted-foreground text-center">Sin mensajes aún.</p>}
        {messages.map(message => <div key={message.id} className={`flex ${message.remitente === 'instructor' ? 'justify-end' : 'justify-start'}`}>
          <div className={`max-w-[85%] px-3 py-2 text-sm rounded-sm ${message.remitente === 'instructor' ? 'bg-primary/10 border border-primary/20' : 'bg-surface-muted border border-border-subtle'}`}>
            <p className="whitespace-pre-wrap break-words">{message.contenido || message.texto}</p>
            <p className="text-[10px] text-muted-foreground/60 mt-1 font-mono">{new Date(message.created_date).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</p>
          </div>
        </div>)}
      </div>
      {newMessages > 0 && <button type="button" onClick={() => { scroll.current?.scrollTo({ top: scroll.current.scrollHeight, behavior: 'smooth' }); setNewMessages(0); }} className="text-xs text-primary p-2">
        {newMessages} {newMessages === 1 ? 'nuevo mensaje' : 'nuevos mensajes'}
      </button>}
      <form onSubmit={send} className="border-t border-border-subtle p-3 flex items-center gap-2">
        <input aria-label="Escribe un mensaje..." placeholder="Escribe un mensaje..." type="text" value={draft} onChange={event => setDraft(event.target.value)}
          className="flex-1 min-w-0 bg-surface-muted border border-border-subtle text-foreground px-3 py-2.5 text-sm rounded-sm" />
        <button type="submit" aria-label="Enviar mensaje" disabled={!chat.canSend || sending || clearing || !draft.trim()} className="bg-primary text-primary-foreground p-3 disabled:opacity-50">
          {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </button>
      </form>
      {confirmClear && <PanelModal label="Limpiar chat" onClose={() => { if (!clearing) setConfirmClear(false); }} className="max-w-sm glass-card p-6 space-y-4">
        <h3 className="font-heading text-lg font-bold">Limpiar chat</h3>
        <p className="text-sm">¿Quieres limpiar la conversación con {student.nombre}?</p>
        <p className="text-xs text-muted-foreground">Se eliminarán sus mensajes. Esta acción no se puede deshacer.</p>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-3">
          <button type="button" disabled={clearing} onClick={() => setConfirmClear(false)} className="px-4 py-2 text-xs border border-border-subtle">Cancelar</button>
          <button type="button" disabled={clearing} onClick={() => void clear()} className="px-4 py-2 text-xs text-danger border border-danger-border">{clearing ? 'Limpiando…' : 'Limpiar chat'}</button>
        </div>
      </PanelModal>}
    </section>
  );
}
