import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, MessageCircle, Users } from 'lucide-react';
import conexionesService from '@/services/conexionesService';
import { profileHasAdmin, profileHasInstructor } from '@/lib/roles';
import { profileDisplayName } from '@/lib/staffChat';
import { usePanelAuthContext } from '@/context/PanelAuthContext';
import RoleBadge from '@/components/RoleBadge';
import BroadcastComposer from '@/components/chat/BroadcastComposer';
import StudentChatConversation from '@/components/chat/StudentChatConversation';

/** Existing private chats, presented together without sharing drafts or sends. */
export default function StudentChats({ profiles, onOpenStaffChat }) {
  const { profile } = usePanelAuthContext();
  const [conversations, setConversations] = useState([]);
  const [openIds, setOpenIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const profilesRef = useRef(profiles);
  profilesRef.current = profiles;
  const latest = useRef(0);

  const loadConversations = useCallback(async () => {
    const request = ++latest.current;
    try {
      const rows = await conexionesService.mensajes.list('-created_date', 500);
      if (request !== latest.current) return;
      const byStudent: Record<string, any> = {};
      for (const message of rows) {
        const id = String(message.alumno_id);
        const summary = byStudent[id] ||= { last: message, unread: 0 };
        if (new Date(message.created_date) > new Date(summary.last.created_date)) summary.last = message;
        if (message.remitente === 'alumno' && !message.leido_instructor) summary.unread++;
      }
      const ids = new Set(profilesRef.current.map(student => String(student.id)));
      const next = profilesRef.current.map(student => {
        const summary = byStudent[String(student.id)];
        return { alumnoId: String(student.id), profile: student, nombre: profileDisplayName(student),
          ultimoTexto: summary?.last.contenido || summary?.last.texto || '', ultimaFecha: summary?.last.created_date || null, noLeidos: summary?.unread || 0 };
      });
      for (const [id, summary] of Object.entries(byStudent)) {
        if (!ids.has(id)) next.push({ alumnoId: id, nombre: summary.last.alumno_nombre || 'Alumno',
          ultimoTexto: summary.last.contenido || summary.last.texto || '', ultimaFecha: summary.last.created_date, noLeidos: summary.unread });
      }
      next.sort((a, b) => a.ultimaFecha && b.ultimaFecha ? new Date(b.ultimaFecha).getTime() - new Date(a.ultimaFecha).getTime()
        : a.ultimaFecha ? -1 : b.ultimaFecha ? 1 : a.nombre.localeCompare(b.nombre));
      setConversations(next); setError('');
    } catch {
      if (request === latest.current) setError('No se pudieron actualizar las conversaciones.');
    } finally {
      if (request === latest.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConversations();
    const unsubscribe = conexionesService.subscribeMensajes(event => {
      if (event.type === 'poll' || conexionesService.parseWsPayload(event)?.type === 'mensaje') void loadConversations();
    });
    const onVisible = () => { if (document.visibilityState === 'visible') void loadConversations(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { ++latest.current; unsubscribe(); document.removeEventListener('visibilitychange', onVisible); };
  }, [loadConversations]);

  useEffect(() => { void loadConversations(); }, [profiles, loadConversations]);

  const open = conversation => {
    if (conversation.profile && (profileHasAdmin(conversation.profile) || profileHasInstructor(conversation.profile))) {
      onOpenStaffChat?.(conversation.profile); return;
    }
    setOpenIds(previous => previous.includes(conversation.alumnoId) ? previous : [...previous, conversation.alumnoId]);
  };
  const opened = openIds.map(id => conversations.find(conversation => conversation.alumnoId === id)).filter(Boolean);

  if (loading) return <div className="flex justify-center py-20"><Loader2 aria-label="Cargando conversaciones" className="w-8 h-8 animate-spin text-primary" /></div>;

  return <div className="space-y-4">
    <BroadcastComposer recipients={profiles.filter(student => !profileHasAdmin(student) && !profileHasInstructor(student))}
      title="Mensaje para varios alumnos" description="Solo aparecen los alumnos asignados y cada uno recibe una conversación privada."
      onSend={(ids, content) => conexionesService.mensajes.broadcast(ids, content)} />
    <p className="text-sm text-muted-foreground">Abre los chats de varios alumnos para conversar con ellos en paralelo. Cada chat mantiene su propio borrador.</p>
    {error && <div role="alert" className="text-sm text-destructive">{error} <button type="button" onClick={() => void loadConversations()} className="underline">Reintentar</button></div>}
    <div className="grid lg:grid-cols-[15rem_minmax(0,1fr)] gap-4 items-start">
      <div className="glass-card flex flex-col min-w-0 max-h-[65vh]">
        <p className="p-3 border-b border-border-subtle text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Alumnos ({conversations.length})</p>
        <div className="overflow-y-auto">
          {!conversations.length && <div className="text-center p-6"><Users className="w-8 h-8 mx-auto text-muted-foreground mb-2" /><p className="text-xs text-muted-foreground">No hay alumnos activos.</p></div>}
          {conversations.map(conversation => <button type="button" key={conversation.alumnoId} onClick={() => open(conversation)}
            aria-pressed={openIds.includes(conversation.alumnoId)} className={`w-full text-left p-3 border-b border-border-subtle ${openIds.includes(conversation.alumnoId) ? 'bg-primary/10' : 'hover:bg-surface-hover'}`}>
            <div className="flex justify-between items-center gap-2">
              <div className="min-w-0"><p className="text-sm font-medium truncate">{conversation.nombre}</p>{conversation.profile && <RoleBadge profile={conversation.profile} />}</div>
              {conversation.noLeidos > 0 && <span aria-label={`${conversation.noLeidos} mensajes sin leer`} className="shrink-0 px-1.5 py-0.5 bg-primary text-primary-foreground text-[10px] rounded-full">{conversation.noLeidos}</span>}
            </div>
            <p className="text-xs text-muted-foreground truncate mt-1">{conversation.ultimoTexto || 'Sin mensajes aún'}</p>
            {openIds.includes(conversation.alumnoId) && <span className="text-[10px] text-primary">Chat abierto</span>}
          </button>)}
        </div>
      </div>
      <div className={`grid min-w-0 gap-4 ${opened.length > 1 ? 'xl:grid-cols-2' : ''}`}>
        {!opened.length && <div className="glass-card min-h-64 flex flex-col justify-center items-center text-center p-6">
          <MessageCircle className="w-10 h-10 text-muted-foreground mb-3" /><p className="text-sm text-muted-foreground">Selecciona los alumnos para abrir sus conversaciones.</p>
        </div>}
        {opened.map(student => <StudentChatConversation key={student.alumnoId} student={student} instructorName={profileDisplayName(profile)}
          onChanged={loadConversations} onClose={() => setOpenIds(previous => previous.filter(id => id !== student.alumnoId))} />)}
      </div>
    </div>
  </div>;
}
