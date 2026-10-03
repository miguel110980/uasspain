import PanelModal from '@/components/ui/PanelModal';
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Send, Loader2, MessageCircle, Users, Trash2, X } from 'lucide-react';
import conexionesService from '@/services/conexionesService';
import { sanitizeInput } from '@/lib/sanitize';
import { profileHasAdmin, profileHasInstructor } from '@/lib/roles';
import { buildStaffPeers, countStaffUnread, profileDisplayName, staffChatPeerStorageKey } from '@/lib/staffChat';
import RoleBadge from '@/components/RoleBadge';
import { usePanelAuthContext } from '@/context/PanelAuthContext';
import StaffChatPanel from '@/components/chat/StaffChatPanel';
import ChatExportPdfButton from '@/components/chat/ChatExportPdfButton';
import BroadcastComposer from '@/components/chat/BroadcastComposer';

/** @type {{ id: 'alumnos' | 'admin', label: string }[]} */
const TABS = [
  { id: 'alumnos', label: 'Alumnos' },
  { id: 'admin', label: 'Administración' },
];

function chatPeerProfiles(profiles, myProfileId) {
  return (profiles || []).filter((p) => {
    if (myProfileId && String(p.id) === String(myProfileId)) return false;
    return p.status === 'activo';
  });
}

function UsuariosChat({ profiles, onOpenStaffChat }) {
  const { profile } = usePanelAuthContext();
  const instructorNombre = profileDisplayName(profile);
  const [conversaciones, setConversaciones] = useState([]);
  const [alumnoSeleccionado, setAlumnoSeleccionado] = useState(null);
  const [mensajes, setMensajes] = useState([]);
  const [texto, setTexto] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [clearing, setClearing] = useState(false);
  const bottomRef = useRef(null);
  const alumnoSeleccionadoRef = useRef(null);
  const scrollContainerRef = useRef(null);
  const isAtBottomRef = useRef(true);
  const [newMessageCount, setNewMessageCount] = useState(0);

  useEffect(() => {
    alumnoSeleccionadoRef.current = alumnoSeleccionado;
  }, [alumnoSeleccionado]);

  useEffect(() => {
    loadConversaciones();
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        loadConversaciones();
        if (alumnoSeleccionadoRef.current) loadMensajes(alumnoSeleccionadoRef.current.id);
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    const unsubscribe = conexionesService.subscribeMensajes((event) => {
      const payload = conexionesService.parseWsPayload(event);
      if (payload?.type === 'mensaje' && payload?.data) {
        const msg = payload.data;
        const currentAlumno = alumnoSeleccionadoRef.current;
        if (currentAlumno && String(msg.alumno_id) === String(currentAlumno.id) && msg.remitente !== 'instructor') {
          setMensajes((prev) => {
            if (prev.some((m) => m.id === msg.id)) return prev;
            return [...prev, msg];
          });
          setNewMessageCount((c) => c + 1);
        }
        loadConversaciones();
      } else if (payload?.type === 'mensaje' || event.type === 'poll') {
        loadConversaciones();
        if (alumnoSeleccionadoRef.current) loadMensajes(alumnoSeleccionadoRef.current.id);
      }
    });
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!alumnoSeleccionado?.id) return undefined;
    return conexionesService.subscribeChatRoom(alumnoSeleccionado.id, (event) => {
      const payload = conexionesService.parseWsPayload(event);
      if (payload?.type === 'mensaje' && payload?.data) {
        const msg = payload.data;
        if (msg.remitente !== 'instructor') {
          setMensajes((prev) => {
            if (prev.some((m) => m.id === msg.id)) return prev;
            return [...prev, msg];
          });
          setNewMessageCount((c) => c + 1);
        }
      } else if (payload?.type === 'message' || event.type === 'poll') {
        loadMensajes(alumnoSeleccionado.id);
      }
    });
  }, [alumnoSeleccionado?.id]);

  useEffect(() => {
    if (!loading) loadConversaciones();
  }, [profiles]);

  const loadConversaciones = async () => {
    const todos = await conexionesService.mensajes.list('-created_date', 500);
    const porAlumno: Record<string, any> = {};
    todos.forEach((m) => {
      const key = String(m.alumno_id);
      if (!porAlumno[key]) porAlumno[key] = { ultimo: m, noLeidos: 0 };
      if (m.remitente === 'alumno' && !m.leido_instructor) porAlumno[key].noLeidos += 1;
    });
    const profileIds = new Set(profiles.map((p) => String(p.id)));
    const lista = profiles.map((p) => {
      const conv = porAlumno[String(p.id)];
      return {
        alumnoId: p.id,
        profile: p,
        nombre: `${p.nombre || ''} ${p.apellidos || ''}`.trim() || conv?.ultimo.alumno_nombre || 'Usuario',
        ultimoTexto: conv?.ultimo.contenido || conv?.ultimo.texto || '',
        ultimaFecha: conv?.ultimo.created_date || null,
        noLeidos: conv?.noLeidos || 0,
      };
    });
    Object.entries(porAlumno).forEach(([alumnoId, conv]) => {
      if (profileIds.has(alumnoId)) return;
      lista.push({
        alumnoId,
        nombre: conv.ultimo.alumno_nombre || 'Usuario',
        ultimoTexto: conv.ultimo.contenido || conv.ultimo.texto || '',
        ultimaFecha: conv.ultimo.created_date || null,
        noLeidos: conv.noLeidos || 0,
      });
    });
    lista.sort((a, b) => {
      if (!a.ultimaFecha && !b.ultimaFecha) return a.nombre.localeCompare(b.nombre);
      if (!a.ultimaFecha) return 1;
      if (!b.ultimaFecha) return -1;
      return new Date(b.ultimaFecha).getTime() - new Date(a.ultimaFecha).getTime();
    });
    setConversaciones(lista);
    setLoading(false);
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

  const loadMensajes = async (alumnoId) => {
    try {
      const data = await conexionesService.mensajes.filter(
        { alumno_id: String(alumnoId) },
        'created_date',
      );
      setMensajes(Array.isArray(data) ? data : []);
      setError('');
      await conexionesService.mensajes.markRead(alumnoId);
      loadConversaciones();
    } catch {
      setError('No se pudieron cargar los mensajes.');
    }
  };

  const handleSelect = (conv) => {
    if (conv.profile && profileHasAdmin(conv.profile)) {
      onOpenStaffChat?.(conv.profile);
      return;
    }
    setAlumnoSeleccionado({ id: conv.alumnoId, nombre: conv.nombre, profile: conv.profile });
    loadMensajes(conv.alumnoId);
  };

  const handleSend = async (e) => {
    e.preventDefault();
    const contenido = sanitizeInput(texto, 'message');
    if (!contenido.trim() || !alumnoSeleccionado) return;
    setSending(true);
    setError('');
    try {
      const created = await conexionesService.mensajes.create({
        alumno_id: String(alumnoSeleccionado.id),
        alumno_nombre: alumnoSeleccionado.nombre,
        remitente: 'instructor',
        contenido,
      });
      setTexto('');
      setMensajes((prev) => {
        if (prev.some((m) => m.id === created.id)) return prev;
        return [...prev, created];
      });
      scrollToBottom();
      loadConversaciones();
    } catch (err) {
      const msg = err?.response?.data?.detail || err?.message || 'No se pudo enviar el mensaje.';
      setError(msg);
    } finally {
      setSending(false);
    }
  };

  const handleClearChat = async () => {
    if (!alumnoSeleccionado?.id || clearing) return;
    setClearing(true);
    setError('');
    try {
      await conexionesService.mensajes.clearChat(alumnoSeleccionado.id);
      setMensajes([]);
      setShowClearConfirm(false);
      loadConversaciones();
    } catch (err) {
      const msg = err?.response?.data?.detail || err?.message || 'No se pudo limpiar la conversación.';
      setError(msg);
    } finally {
      setClearing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <BroadcastComposer
        recipients={profiles.filter((item) => !profileHasAdmin(item) && !profileHasInstructor(item))}
        title="Mensaje para varios alumnos"
        description="Solo aparecen los alumnos asignados y cada uno recibe una conversación privada."
        onSend={(ids, contenido) => conexionesService.mensajes.broadcast(ids, contenido)}
      />
    <div className="grid md:grid-cols-3 gap-6 h-[65vh]">
      <div className="glass-card overflow-y-auto flex flex-col">
        <div className="p-3 border-b border-border-subtle">
          <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
            Alumnos ({conversaciones.length})
          </p>
        </div>
        <div className="flex-1 overflow-y-auto">
          {conversaciones.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center p-6">
              <Users className="w-8 h-8 text-muted-foreground mb-2" />
              <p className="text-xs text-muted-foreground">No hay alumnos activos.</p>
            </div>
          ) : (
            conversaciones.map((conv) => (
              <button
                key={conv.alumnoId}
                type="button"
                onClick={() => handleSelect(conv)}
                className={`w-full text-left p-4 border-b border-border-subtle transition-colors ${
                  alumnoSeleccionado?.id === conv.alumnoId ? 'bg-primary/10' : 'hover:bg-surface-hover'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{conv.nombre}</p>
                    {conv.profile && <RoleBadge profile={conv.profile} />}
                  </div>
                  {conv.noLeidos > 0 && (
                    <span className="shrink-0 w-5 h-5 flex items-center justify-center bg-primary text-primary-foreground text-[10px] font-bold rounded-full">
                      {conv.noLeidos}
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground truncate mt-0.5">{conv.ultimoTexto || 'Sin mensajes aún'}</p>
              </button>
            ))
          )}
        </div>
      </div>

      <div className="md:col-span-2 glass-card flex flex-col">
        {error && <p className="text-sm text-destructive px-4 pt-3">{error}</p>}
        {!alumnoSeleccionado ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-6">
            <MessageCircle className="w-10 h-10 text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground">Selecciona un usuario para ver la conversación.</p>
          </div>
        ) : (
          <>
            <div className="p-4 border-b border-border-subtle flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2 min-w-0">
                <p className="text-sm font-semibold text-foreground truncate">{alumnoSeleccionado.nombre}</p>
                {alumnoSeleccionado.profile && <RoleBadge profile={alumnoSeleccionado.profile} />}
              </div>
              <div className="flex items-center gap-2">
                <ChatExportPdfButton
                  title="Chat con usuario — UASSPAIN"
                  participantA={instructorNombre}
                  participantB={alumnoSeleccionado.nombre}
                  messages={mensajes}
                  mapMessage={(m) => ({
                    author: m.remitente === 'instructor' ? instructorNombre : (alumnoSeleccionado.nombre || m.alumno_nombre || 'Usuario'),
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
              {mensajes.map((m) => (
                <div key={m.id} className={`flex ${m.remitente === 'instructor' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[75%] px-4 py-2.5 text-sm rounded-sm ${
                      m.remitente === 'instructor'
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
              ))}
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
                  aria-label="Enviar mensaje"
                disabled={sending || !texto.trim()}
                className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-5 py-2.5 font-bold uppercase tracking-tighter text-xs hover:bg-primary/80 transition-all duration-300 disabled:opacity-50"
              >
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </button>
            </form>
          </>
        )}
      </div>

      {showClearConfirm && (
        <PanelModal label="Limpiar chat" onClose={() => setShowClearConfirm(false)} className="max-w-sm glass-card p-6 space-y-4">
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
          </PanelModal>
      )}
    </div>
    </div>
  );
}

/** @param {{ profiles: object[], initialTab?: 'alumnos' | 'admin', alumnoUnread?: number, staffUnread?: number }} props */
export default function InstructorChat({
  profiles,
  initialTab,
  alumnoUnread: externalAlumnoUnread,
  staffUnread: externalStaffUnread,
}) {
  const { profile } = usePanelAuthContext();
  const [tab, setTab] = useState(/** @type {'alumnos' | 'admin'} */ (initialTab || 'alumnos'));
  const [admins, setAdmins] = useState([]);
  const [loadingAdmins, setLoadingAdmins] = useState(true);
  const [staffUnread, setStaffUnread] = useState(externalStaffUnread ?? 0);
  const [alumnoUnread, setAlumnoUnread] = useState(externalAlumnoUnread ?? 0);
  const tabInitialized = useRef(false);
  const useExternalUnread = typeof externalAlumnoUnread === 'number' && typeof externalStaffUnread === 'number';

  useEffect(() => {
    if (typeof externalAlumnoUnread === 'number') setAlumnoUnread(externalAlumnoUnread);
    if (typeof externalStaffUnread === 'number') setStaffUnread(externalStaffUnread);
  }, [externalAlumnoUnread, externalStaffUnread]);

  useEffect(() => {
    if (!profile?.id) return;
    (async () => {
      try {
        const [staffContacts, staffMsgs] = await Promise.all([
          conexionesService.mensajesStaff.contacts(),
          conexionesService.mensajesStaff.list('-created_date', 500),
        ]);
        setAdmins(buildStaffPeers({
          myProfileId: profile.id,
          profiles: staffContacts,
          staffMsgs,
          roleFilter: (p) => profileHasAdmin(p) || profileHasInstructor(p),
          fallbackRole: 'admin',
          fallbackLabel: 'Contacto',
        }));
        const staffCount = countStaffUnread(staffMsgs, profile.id);
        if (!useExternalUnread) {
          setStaffUnread(staffCount);
          const alumnoMsgs = await conexionesService.mensajes.filter({
            remitente: 'alumno',
            leido_instructor: false,
          });
          setAlumnoUnread(alumnoMsgs.length);
        }
        if (!tabInitialized.current && !initialTab) {
          setTab(staffCount > 0 ? 'admin' : 'alumnos');
          tabInitialized.current = true;
        }
      } finally {
        setLoadingAdmins(false);
      }
    })();
  }, [profile?.id, initialTab, useExternalUnread]);

  useEffect(() => {
    if (initialTab) setTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    if (useExternalUnread || !profile?.id) return undefined;
    const refreshUnread = async () => {
      try {
        const [alumnoMsgs, staffMsgs] = await Promise.all([
          conexionesService.mensajes.filter({ remitente: 'alumno', leido_instructor: false }),
          conexionesService.mensajesStaff.filter({ leido_destinatario: false }),
        ]);
        setAlumnoUnread(alumnoMsgs.length);
        setStaffUnread(countStaffUnread(staffMsgs, profile.id));
      } catch {
        // ignore
      }
    };
    refreshUnread();
    const unsubscribe = conexionesService.subscribeMensajes((event) => {
      const payload = conexionesService.parseWsPayload(event);
      if (payload?.type === 'mensaje' || payload?.type === 'mensaje_staff' || event.type === 'poll') {
        refreshUnread();
      }
    });
    return () => unsubscribe();
  }, [profile?.id, useExternalUnread]);

  const chatProfiles = useMemo(
    () => chatPeerProfiles(profiles, profile?.id),
    [profiles, profile?.id],
  );

  const adminContactGroups = useMemo(() => {
    const administradores = admins.filter((p) => profileHasAdmin(p) && !profileHasInstructor(p));
    const instructores = admins.filter((p) => profileHasInstructor(p));
    return [
      { label: 'Administradores', peers: administradores, role: 'admin' },
      { label: 'Instructores', peers: instructores, role: 'instructor' },
    ];
  }, [admins]);

  const [staffFocusPeerId, setStaffFocusPeerId] = useState(null);

  const openStaffChatWith = (peer) => {
    if (profile?.id && peer?.id) {
      sessionStorage.setItem(staffChatPeerStorageKey(profile.id), String(peer.id));
    }
    setStaffFocusPeerId(peer?.id || null);
    setTab('admin');
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {TABS.map((t) => {
          const unread = t.id === 'admin' ? staffUnread : alumnoUnread;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`inline-flex items-center gap-2 px-4 py-2 text-xs font-mono uppercase tracking-widest border rounded transition-all ${
                tab === t.id
                  ? 'border-primary/50 bg-primary/10 text-primary'
                  : 'border-border-subtle text-muted-foreground hover:border-primary/30 hover:text-primary'
              }`}
            >
              {t.label}
              {unread > 0 && (
                <span className="w-5 h-5 flex items-center justify-center bg-primary text-primary-foreground text-[10px] font-bold rounded-full">
                  {unread}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div className={tab === 'alumnos' ? '' : 'hidden'}>
        <UsuariosChat profiles={chatProfiles} onOpenStaffChat={openStaffChatWith} />
      </div>
      {profile?.id && (
        <div className={tab === 'admin' ? '' : 'hidden'}>
          {loadingAdmins ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-8 h-8 text-primary animate-spin" />
            </div>
          ) : (
            <StaffChatPanel
              peers={admins}
              myProfileId={profile.id}
              myRole="instructor"
              myDisplayName={profileDisplayName(profile)}
              peerRoleLabel="Contactos"
              peerSingular="Contacto"
              emptyPeersText="No hay contactos disponibles."
              selectPeerText="Selecciona un contacto para ver la conversación."
              focusPeerId={staffFocusPeerId}
              contactGroups={adminContactGroups}
            />
          )}
        </div>
      )}
    </div>
  );
}
