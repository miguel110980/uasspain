import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, MessageCircle, Users } from 'lucide-react';
import conexionesService from '@/services/conexionesService';
import { hasRole } from '@/lib/roles';
import { profileDisplayName } from '@/lib/staffChat';
import { usePanelAuthContext } from '@/context/PanelAuthContext';
import RoleBadge from '@/components/RoleBadge';
import BroadcastComposer from '@/components/chat/BroadcastComposer';
import StudentChatConversation from '@/components/chat/StudentChatConversation';

/** Existing private chats, presented together without sharing drafts or sends. */
export default function StudentChats({ profiles }) {
  const { profile } = usePanelAuthContext();
  const [conversations, setConversations] = useState([]);
  const [openIds, setOpenIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const profilesRef = useRef(profiles);
  profilesRef.current = profiles;
  const latest = useRef(0);

  const openIdsRef = useRef(openIds); openIdsRef.current = openIds;
  const mapSummary = useCallback(summary => {
    const student = profilesRef.current.find(p => String(p.id) === String(summary.alumno_id)) || {
      id:summary.alumno_id, nombre:summary.nombre, apellidos:summary.apellidos, role:'alumno', roles:['alumno'], status:'activo',
    };
    return { alumnoId:String(summary.alumno_id), profile:student, nombre:profileDisplayName(student),
      ultimoTexto:summary.contenido, ultimaFecha:summary.created_date, lastId:summary.last_id, noLeidos:summary.unread };
  }, []);
  const loadConversations = useCallback(async (roomId?: string) => {
    const request = roomId ? 0 : ++latest.current;
    try {
      const rows = await conexionesService.mensajes.summaries(roomId);
      if (!roomId && request !== latest.current) return;
      const next = rows.map(mapSummary);
      setConversations(previous => roomId ? previous.map(c => c.alumnoId === roomId ? next[0] : c).filter(Boolean) : next);
      setError('');
    } catch {
      if (roomId || request === latest.current) setError('No se pudieron actualizar las conversaciones.');
    } finally { if (roomId || request === latest.current) setLoading(false); }
  }, [mapSummary]);
  useEffect(() => {
    void loadConversations();
    const unsubscribe = conexionesService.subscribeMensajes(event => {
      const payload = conexionesService.parseWsPayload(event);
      if (event.type === 'poll' || payload?.type === 'asignacion') void loadConversations();
      else if (payload?.type === 'mensaje' && payload.room_id && !openIdsRef.current.includes(String(payload.room_id))) void loadConversations(String(payload.room_id));
    });
    return () => { ++latest.current; unsubscribe(); };
  }, [loadConversations]);
  useEffect(() => { void loadConversations(); }, [profiles, loadConversations]);
  const changed = (studentId, message, action) => {
    if (action === 'deleted') { void loadConversations(studentId); return; }
    setConversations(previous => previous.map(c => {
      if (c.alumnoId !== studentId) return c;
      if (action === 'cleared') return { ...c, ultimoTexto:'', ultimaFecha:null, lastId:null, noLeidos:0 };
      if (action === 'read') return { ...c, noLeidos:0 };
      if (!message) return c;
      const newer = !c.ultimaFecha || new Date(message.created_date).getTime() >= new Date(c.ultimaFecha).getTime();
      return { ...c,
        ...(newer ? { ultimoTexto:message.contenido, ultimaFecha:message.created_date, lastId:message.id } : {}),
        noLeidos:c.noLeidos + (action === 'message' && message.id !== c.lastId && message.remitente === 'alumno' && !message.leido_instructor ? 1 : 0),
      };
    }));
  };
  const open = conversation => setOpenIds(previous => previous.includes(conversation.alumnoId) ? previous : [...previous, conversation.alumnoId]);
  const opened = openIds.map(id => conversations.find(conversation => conversation.alumnoId === id)).filter(Boolean);

  if (loading) return <div className="flex justify-center py-20"><Loader2 aria-label="Cargando conversaciones" className="w-8 h-8 animate-spin text-primary" /></div>;

  return <div className="space-y-4">
    <BroadcastComposer recipients={conversations.map(c => c.profile).filter(student => hasRole(student, 'alumno'))}
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
          onChanged={(message, action) => changed(student.alumnoId, message, action)} onClose={() => setOpenIds(previous => previous.filter(id => id !== student.alumnoId))} />)}
      </div>
    </div>
  </div>;
}
