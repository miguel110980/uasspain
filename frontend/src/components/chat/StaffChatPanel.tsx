import PanelModal from '@/components/ui/PanelModal';
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Send, Loader2, MessageCircle, Users, Trash2, X } from 'lucide-react';
import conexionesService from '@/services/conexionesService';
import { sanitizeInput } from '@/lib/sanitize';
import {
  profileDisplayName,
  staffChatPeerStorageKey,
  staffChatRoomId,
  staffMessageFromMe,
} from '@/lib/staffChat';
import { useActiveProfileSessions } from '@/hooks/useActiveProfileSessions';
import ChatExportPdfButton from '@/components/chat/ChatExportPdfButton';
import RoleBadge from '@/components/RoleBadge';
import BroadcastComposer from '@/components/chat/BroadcastComposer';

/**
 * Chat bidireccional admin ↔ instructor.
 * @param {{
 *   peers: object[],
 *   myProfileId: string,
 *   myRole: 'admin' | 'instructor',
 *   myDisplayName?: string,
 *   peerRoleLabel?: string,
 *   peerSingular?: string,
 *   emptyPeersText?: string,
 *   selectPeerText?: string,
 *   onUnreadChange?: (count: number) => void,
 *   focusPeerId?: string | null,
 *   contactGroups?: { label: string, peers: object[], role?: string }[] | null,
 * }} props
 */
type StaffChatPanelProps = {
  peers: any[];
  myProfileId: string;
  myRole: 'admin' | 'instructor';
  myDisplayName?: string;
  peerRoleLabel?: string;
  peerSingular?: string;
  emptyPeersText?: string;
  selectPeerText?: string;
  onUnreadChange?: (count: number) => void;
  focusPeerId?: string | null;
  contactGroups?: { label: string; peers: any[]; role?: string }[] | null;
};

export default function StaffChatPanel({
  peers,
  myProfileId,
  myRole,
  myDisplayName = '',
  peerRoleLabel = 'Contacto',
  peerSingular = 'Contacto',
  emptyPeersText = 'No hay contactos disponibles.',
  selectPeerText = 'Selecciona un contacto para ver la conversación.',
  onUnreadChange,
  focusPeerId = null,
  contactGroups = null,
}: StaffChatPanelProps) {
  const [metaPorPeer, setMetaPorPeer] = useState<Record<string, any>>({});
  const [peerSeleccionado, setPeerSeleccionado] = useState<{ id: string; nombre: string } | null>(null);
  const [mensajes, setMensajes] = useState<any[]>([]);
  const [texto, setTexto] = useState('');
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [loadingMensajes, setLoadingMensajes] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [clearing, setClearing] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const { isOnline } = useActiveProfileSessions();
  const bottomRef = useRef(null);
  const peerRef = useRef<{ id: string; nombre: string } | null>(null);
  const peersRef = useRef(peers);
  const restoredPeerRef = useRef(false);
  const scrollContainerRef = useRef(null);
  const isAtBottomRef = useRef(true);
  const [newMessageCount, setNewMessageCount] = useState(0);

  useEffect(() => {
    peerRef.current = peerSeleccionado;
  }, [peerSeleccionado]);

  useEffect(() => {
    peersRef.current = peers;
  }, [peers]);

  const loadMensajes = useCallback(async (peerId, silent = false) => {
    if (!silent) setLoadingMensajes(true);
    try {
      const data = await conexionesService.mensajesStaff.filter(
        { peer_id: String(peerId) },
        'created_date',
      );
      setMensajes(Array.isArray(data) ? data : []);
      setError('');
      await conexionesService.mensajesStaff.markRead(peerId);
    } catch {
      setError('No se pudieron cargar los mensajes.');
    } finally {
      if (!silent) setLoadingMensajes(false);
    }
  }, []);

  const selectPeerById = useCallback((peerId, nombre) => {
    if (myProfileId) {
      sessionStorage.setItem(staffChatPeerStorageKey(myProfileId), String(peerId));
    }
    setPeerSeleccionado({ id: peerId, nombre });
    setMensajes([]);
    loadMensajes(peerId);
  }, [loadMensajes, myProfileId]);

  const resolvePeerNombre = useCallback((peerId: string, porPeer: Record<string, any>) => {
    const peer = peersRef.current.find((p) => String(p.id) === String(peerId));
    if (peer) return profileDisplayName(peer);
    return porPeer[String(peerId)]?.nombre || 'Contacto';
  }, []);

  const restoreSavedPeer = useCallback((porPeer: Record<string, any>) => {
    if (restoredPeerRef.current || peerRef.current || !myProfileId) return;
    restoredPeerRef.current = true;

    const savedPeerId = sessionStorage.getItem(staffChatPeerStorageKey(myProfileId));
    const peerIds = new Set(peersRef.current.map((p) => String(p.id)));
    if (savedPeerId && (porPeer[savedPeerId] || peerIds.has(savedPeerId))) {
      selectPeerById(savedPeerId, resolvePeerNombre(savedPeerId, porPeer));
      return;
    }

    let latestPeerId = null;
    let latestDate = null;
    let latestNombre = 'Contacto';
    Object.entries(porPeer).forEach(([peerId, meta]) => {
      const fecha = meta?.ultimo?.created_date;
      if (!fecha) return;
      const ts = new Date(fecha).getTime();
      if (latestDate == null || ts > latestDate) {
        latestDate = ts;
        latestPeerId = peerId;
        latestNombre = meta.nombre || resolvePeerNombre(peerId, porPeer);
      }
    });
    if (latestPeerId) {
      selectPeerById(latestPeerId, latestNombre);
    }
  }, [myProfileId, resolvePeerNombre, selectPeerById]);

  const loadMeta = useCallback(async (options: { restoreSelection?: boolean } = {}) => {
    const { restoreSelection = false } = options;
    try {
      const todos = await conexionesService.mensajesStaff.list('-created_date', 500);
      if (!Array.isArray(todos)) {
        setLoadingMeta(false);
        return {};
      }
      const porPeer: Record<string, any> = {};
      todos.forEach((m) => {
        const peerId = staffMessageFromMe(m, myProfileId) ? m.destinatario_id : m.remitente_id;
        const key = String(peerId);
        const peerNombre = staffMessageFromMe(m, myProfileId) ? m.destinatario_nombre : m.remitente_nombre;
        if (!porPeer[key]) porPeer[key] = { ultimo: m, noLeidos: 0, nombre: peerNombre || '' };
        else if (peerNombre && !porPeer[key].nombre) porPeer[key].nombre = peerNombre;
        if (!staffMessageFromMe(m, myProfileId) && !m.leido_destinatario) {
          porPeer[key].noLeidos += 1;
        }
      });
      setMetaPorPeer(porPeer);
      setError('');
      const unreadTotal = Object.values(porPeer).reduce((sum, entry) => sum + (entry.noLeidos || 0), 0);
      onUnreadChange?.(unreadTotal);
      if (restoreSelection) {
        restoreSavedPeer(porPeer);
      }
      return porPeer;
    } catch {
      setError('No se pudieron cargar las conversaciones.');
      return {};
    } finally {
      setLoadingMeta(false);
    }
  }, [myProfileId, onUnreadChange, restoreSavedPeer]);

  const handleIncomingStaffMessage = useCallback(async (payload) => {
    const data = payload?.data;
    if (!data || !myProfileId) return;

    const peerId = staffMessageFromMe(data, myProfileId)
      ? data.destinatario_id
      : data.remitente_id;
    if (!peerId) return;

    const porPeer = await loadMeta();
    const current = peerRef.current;
    const isIncoming = !staffMessageFromMe(data, myProfileId);

      if (current && String(current.id) === String(peerId)) {
        setMensajes((prev) => {
          if (prev.some((m) => m.id === data.id)) return prev;
          return [...prev, data];
        });
        if (isIncoming) setNewMessageCount((c) => c + 1);
        return;
      }

    if (isIncoming) {
      setNewMessageCount((c) => c + 1);
      const peer = peersRef.current.find((p) => String(p.id) === String(peerId));
      const nombre = peer
        ? profileDisplayName(peer)
        : porPeer[String(peerId)]?.nombre
          || data.remitente_nombre
          || data.destinatario_nombre
          || 'Contacto';
      selectPeerById(peerId, nombre);
    }
  }, [loadMeta, myProfileId, selectPeerById]);

  useEffect(() => {
    if (!focusPeerId || !myProfileId) return;
    const peer = peers.find((p) => String(p.id) === String(focusPeerId));
    if (peer) {
      selectPeerById(peer.id, profileDisplayName(peer));
    }
  }, [focusPeerId, peers, myProfileId, selectPeerById]);

  useEffect(() => {
    if (!myProfileId) return undefined;
    restoredPeerRef.current = false;
    loadMeta({ restoreSelection: true });
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        loadMeta();
        if (peerRef.current) loadMensajes(peerRef.current.id, true);
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    const unsubscribe = conexionesService.subscribeMensajes((event) => {
      const payload = conexionesService.parseWsPayload(event);
      if (payload?.type === 'mensaje_staff' && payload?.data) {
        handleIncomingStaffMessage(payload);
      } else if (payload?.type === 'mensaje_staff' || event.type === 'poll') {
        loadMeta();
        if (peerRef.current) loadMensajes(peerRef.current.id, true);
      }
    });
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      unsubscribe();
    };
  }, [myProfileId, peers, loadMeta, loadMensajes, handleIncomingStaffMessage]);

  useEffect(() => {
    if (!peerSeleccionado?.id || !myProfileId) return undefined;
    const roomId = staffChatRoomId(myProfileId, peerSeleccionado.id);
    return conexionesService.subscribeChatRoom(roomId, (event) => {
      const payload = conexionesService.parseWsPayload(event);
      if (payload?.type === 'mensaje_staff') {
        handleIncomingStaffMessage(payload);
      } else if (payload?.type === 'mensaje' || payload?.type === 'message' || event.type === 'poll') {
        loadMensajes(peerSeleccionado.id, true);
        loadMeta();
      }
    });
  }, [peerSeleccionado?.id, myProfileId, loadMensajes, loadMeta, handleIncomingStaffMessage]);

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

  const contactos = useMemo(() => {
    const peerIds = new Set(peers.map((p) => String(p.id)));
    const groupRoleMap = {};
    if (contactGroups) {
      contactGroups.forEach((g) => {
        g.peers.forEach((gp) => {
          groupRoleMap[String(gp.id)] = g.role || '';
        });
      });
    }
    const lista = peers.map((p) => {
      const meta = metaPorPeer[String(p.id)];
      return {
        peerId: p.id,
        peer: p,
        nombre: profileDisplayName(p),
        ultimoTexto: meta?.ultimo?.contenido || '',
        ultimaFecha: meta?.ultimo?.created_date || null,
        noLeidos: meta?.noLeidos || 0,
        tieneHistorial: Boolean(meta),
        groupRole: p.groupRole || groupRoleMap[String(p.id)] || '',
      };
    });
    Object.entries(metaPorPeer).forEach(([peerId, meta]) => {
      if (peerIds.has(peerId)) return;
      lista.push({
        peerId,
        peer: { id: peerId, nombre: meta.nombre || '', apellidos: '' },
        nombre: meta.nombre || 'Contacto',
        ultimoTexto: meta.ultimo?.contenido || '',
        ultimaFecha: meta.ultimo?.created_date || null,
        noLeidos: meta.noLeidos || 0,
        tieneHistorial: true,
        groupRole: groupRoleMap[peerId] || '',
      });
    });
    lista.sort((a, b) => {
      if (!a.ultimaFecha && !b.ultimaFecha) return a.nombre.localeCompare(b.nombre, 'es');
      if (!a.ultimaFecha) return 1;
      if (!b.ultimaFecha) return -1;
      return new Date(b.ultimaFecha).getTime() - new Date(a.ultimaFecha).getTime();
    });
    return lista;
  }, [peers, metaPorPeer]);

  const handleSelectPeer = (contacto) => {
    selectPeerById(contacto.peerId, contacto.nombre);
  };

  const senderLabel = myDisplayName || (myRole === 'admin' ? 'Administrador' : 'Instructor');
  const broadcastPeers = useMemo(
    () => peers.filter((peer) => peer.role === 'instructor' || peer.roles?.includes('instructor')),
    [peers],
  );

  const handleSend = async (e) => {
    e.preventDefault();
    const contenido = sanitizeInput(texto, 'message');
    if (!contenido.trim() || !peerSeleccionado) return;
    setSending(true);
    setError('');
    try {
      const created = await conexionesService.mensajesStaff.create({
        destinatario_id: String(peerSeleccionado.id),
        contenido,
      });
      setTexto('');
      setMensajes((prev) => {
        if (prev.some((m) => m.id === created.id)) return prev;
        return [...prev, created];
      });
      scrollToBottom();
      loadMensajes(peerSeleccionado.id, true);
      loadMeta();
    } catch (err) {
      const msg = err?.response?.data?.detail || err?.message || 'No se pudo enviar el mensaje.';
      setError(msg);
    } finally {
      setSending(false);
    }
  };

  const handleClearChat = async () => {
    if (!peerSeleccionado?.id || clearing) return;
    setClearing(true);
    setError('');
    try {
      await conexionesService.mensajesStaff.clearChat(peerSeleccionado.id);
      setMensajes([]);
      setShowClearConfirm(false);
      loadMeta();
    } catch (err) {
      const msg = err?.response?.data?.detail || err?.message || 'No se pudo limpiar la conversación.';
      setError(msg);
    } finally {
      setClearing(false);
    }
  };

  if (loadingMeta && peers.length === 0) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  const renderContactButton = (contacto) => (
    <button
      key={contacto.peerId}
      type="button"
      onClick={() => handleSelectPeer(contacto)}
      className={`w-full text-left p-4 border-b border-border-subtle transition-colors ${
        peerSeleccionado?.id === contacto.peerId ? 'bg-primary/10' : 'hover:bg-surface-hover'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={`shrink-0 w-2 h-2 rounded-full ${
              isOnline(contacto.peerId) ? 'bg-success' : 'bg-muted-foreground/40'
            }`}
            title={isOnline(contacto.peerId) ? 'Conectado' : 'Desconectado'}
          />
          <p className="text-sm font-medium text-foreground truncate">{contacto.nombre}</p>
          {contacto.peer && <RoleBadge profile={contacto.peer} role={contacto.groupRole} />}
        </div>
        {contacto.noLeidos > 0 && (
          <span className="shrink-0 w-5 h-5 flex items-center justify-center bg-primary text-primary-foreground text-[10px] font-bold rounded-full">
            {contacto.noLeidos}
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground truncate mt-0.5 pl-4">
        {contacto.tieneHistorial
          ? contacto.ultimoTexto || 'Sin contenido'
          : 'Nueva conversación — escribe el primer mensaje'}
      </p>
    </button>
  );

  const renderSidebar = () => {
    if (contactGroups && contactGroups.length > 0) {
      const allEmpty = contactGroups.every((g) => g.peers.length === 0);
      return (
        <div className="flex-1 overflow-y-auto">
          {allEmpty ? (
            <div className="flex flex-col items-center justify-center h-full text-center p-6">
              <Users className="w-8 h-8 text-muted-foreground mb-2" />
              <p className="text-xs text-muted-foreground">{emptyPeersText}</p>
            </div>
          ) : (
            contactGroups.map((group) => (
              <div key={group.label}>
                <div className="px-4 py-2 bg-surface-subtle border-b border-border-subtle sticky top-0 z-10">
                  <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                    {group.label} ({group.peers.length})
                  </p>
                </div>
                {group.peers.length === 0 ? (
                  <p className="px-4 py-3 text-xs text-muted-foreground/50">Sin contactos</p>
                ) : (
                  group.peers.map((peer) => {
                    const meta = metaPorPeer[String(peer.id)];
                    return renderContactButton({
                      peerId: peer.id,
                      peer: peer,
                      nombre: profileDisplayName(peer),
                      ultimoTexto: meta?.ultimo?.contenido || '',
                      ultimaFecha: meta?.ultimo?.created_date || null,
                      noLeidos: meta?.noLeidos || 0,
                      tieneHistorial: Boolean(meta),
                      groupRole: group.role || '',
                    });
                  })
                )}
              </div>
            ))
          )}
        </div>
      );
    }

    return (
      <div className="flex-1 overflow-y-auto">
        {contactos.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-6">
            <Users className="w-8 h-8 text-muted-foreground mb-2" />
            <p className="text-xs text-muted-foreground">{emptyPeersText}</p>
          </div>
        ) : (
          contactos.map(renderContactButton)
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {myRole === 'admin' && (
        <BroadcastComposer
          recipients={broadcastPeers}
          title="Mensaje para varios instructores"
          description="Se crea una copia privada en cada conversación; los destinatarios no ven al resto."
          onSend={(ids, contenido) => conexionesService.mensajesStaff.broadcast(ids, contenido)}
        />
      )}
    <div className="space-y-4">
      <div className="glass-card p-4 flex flex-wrap items-center gap-3" aria-label="Identidad de la sesion">
        <span className="text-primary text-sm">Tú</span>
        <span className="font-semibold">{myDisplayName || senderLabel}</span>
        <span className="text-xs text-muted-foreground">{myRole === 'admin' ? 'Administrador' : 'Instructor'}</span>
        <span className="text-xs text-success">En línea</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 h-[65vh]">
      <div className="glass-card min-w-0 overflow-y-auto flex flex-col">
        <div className="p-3 border-b border-border-subtle">
          <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
            {peerRoleLabel} ({contactos.length})
          </p>
          <p className="text-[10px] text-muted-foreground/70 mt-1">
            Pulsa un contacto para abrir o iniciar conversación
          </p>
        </div>
        {renderSidebar()}
      </div>

      <div className="md:col-span-2 min-w-0 glass-card flex flex-col">
        {error && <p className="text-sm text-destructive px-4 pt-3">{error}</p>}
        {!peerSeleccionado ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-6">
            <MessageCircle className="w-10 h-10 text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground">{selectPeerText}</p>
          </div>
        ) : (
          <>
            <div className="p-4 border-b border-border-subtle flex items-center gap-2 flex-wrap justify-between">
              <div className="flex items-center gap-2 flex-wrap min-w-0">
                <span
                  className={`w-2 h-2 rounded-full shrink-0 ${
                    isOnline(peerSeleccionado.id) ? 'bg-success' : 'bg-muted-foreground/40'
                  }`}
                />
                <p className="text-sm font-semibold text-foreground">{peerSeleccionado.nombre}</p>
                {(() => {
                  const p = peers.find((x) => String(x.id) === String(peerSeleccionado.id));
                  const c = contactos.find((x) => String(x.peerId) === String(peerSeleccionado.id));
                  let groupRole = c?.groupRole || p?.groupRole || '';
                  if (!groupRole && contactGroups) {
                    for (const g of contactGroups) {
                      if (g.peers.some((gp) => String(gp.id) === String(peerSeleccionado.id))) {
                        groupRole = g.role || '';
                        break;
                      }
                    }
                  }
                  return p ? <RoleBadge profile={p} role={groupRole} /> : (
                    <span className="text-xs text-muted-foreground capitalize">{peerSingular}</span>
                  );
                })()}
                <span className="text-xs text-muted-foreground">
                  · {isOnline(peerSeleccionado.id) ? 'Conectado' : 'Desconectado'}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <ChatExportPdfButton
                  title={`Chat ${peerRoleLabel} — UASSPAIN`}
                  participantA={senderLabel}
                  participantB={peerSeleccionado.nombre}
                  messages={mensajes}
                  disabled={loadingMensajes}
                  mapMessage={(m) => ({
                    author: staffMessageFromMe(m, myProfileId)
                      ? senderLabel
                      : (m.remitente_nombre || peerSeleccionado.nombre),
                    content: m.contenido,
                    created_date: m.created_date,
                  })}
                />
                {mensajes.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowClearConfirm(true)}
                    disabled={clearing}
                    className="w-8 h-8 flex items-center justify-center border border-border-subtle text-muted-foreground hover:border-danger-border hover:text-danger rounded transition-all disabled:opacity-50"
                    title="Limpiar chat"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
            <div
              ref={scrollContainerRef}
              onScroll={handleScroll}
              className="flex-1 overflow-y-auto p-6 space-y-4 relative"
            >
              {loadingMensajes ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="w-6 h-6 text-primary animate-spin" />
                </div>
              ) : mensajes.length === 0 ? (
                <p className="text-center text-sm text-muted-foreground py-8">
                  No hay mensajes aún. Escribe abajo para iniciar la conversación.
                </p>
              ) : (
                mensajes.map((m) => {
                  const mine = staffMessageFromMe(m, myProfileId);
                  return (
                    <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                      <div
                        className={`max-w-[75%] px-4 py-2.5 text-sm rounded-sm ${
                          mine
                            ? 'bg-primary/10 border border-primary/20 text-foreground'
                            : 'bg-surface-muted border border-border-subtle text-foreground'
                        }`}
                      >
                        <p className="whitespace-pre-wrap break-words">{m.contenido}</p>
                        <p className="text-[10px] text-muted-foreground/60 mt-1 font-mono">
                          {new Date(m.created_date).toLocaleString('es-ES', {
                            day: '2-digit',
                            month: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </p>
                      </div>
                    </div>
                  );
                })
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
                className="flex-1 min-w-0 bg-surface-muted border border-border-subtle focus:border-transparent text-foreground placeholder:text-muted-foreground/40 px-4 py-2.5 text-sm outline-none transition-colors rounded-sm"
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
    </div>
  );
}
