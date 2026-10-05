import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import conexionesService from '@/services/conexionesService';
import { chatFailure, mergeChatMessages } from '@/lib/chatMessages';

/** One private subscription and request sequence per student conversation. */
export function usePrivateStudentChat(roomId: string, role: 'instructor' | 'alumno', options: { enabled?: boolean; isVisible?: () => boolean; onChanged?: (message?: any, action?: string) => void } = {}) {
  const [messages, setMessages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [denied, setDenied] = useState(false);
  const enabled = Boolean(roomId) && options.enabled !== false;
  const optionRef = useRef(options); optionRef.current = options;
  const rows = useRef<any[]>([]), mounted = useRef(false), request = useRef(0), epoch = useRef(0);
  const deleted = useRef(new Set<string>()), reading = useRef(false), sendingNow = useRef(false);
  const apply = useCallback((next: any[]) => { rows.current = next; if (mounted.current) setMessages(next); }, []);
  const fail = useCallback((failure: any, operation: string) => {
    if (!mounted.current || failure?.code === 'ERR_CANCELED') return;
    if (failure?.response?.status === 403) setDenied(true);
    setError(chatFailure(failure, operation));
    // Diagnostic metadata only; never log the response body, cookies or content.
    console.warn('Chat request failed', { operation, status:failure?.response?.status, code:failure?.response?.data?.code, correlation_id:failure?.response?.data?.correlation_id });
  }, []);
  const markRead = useCallback(async () => {
    if (reading.current || !mounted.current || !enabled || denied || document.visibilityState !== 'visible' || optionRef.current.isVisible?.() === false) return;
    const field = role === 'alumno' ? 'leido_alumno' : 'leido_instructor';
    if (!rows.current.some(m => m.remitente !== role && !m[field])) return;
    reading.current = true;
    try {
      // Messages arriving during this request need a subsequent acknowledgement.
      while (mounted.current && document.visibilityState === 'visible' && optionRef.current.isVisible?.() !== false) {
        const unread = rows.current.filter(m => m.remitente !== role && !m[field]);
        if (!unread.length) break;
        await conexionesService.mensajes.markRead(roomId);
        if (!mounted.current) return;
        const ids = new Set(unread.map(m => m.id));
        apply(rows.current.map(m => ids.has(m.id) ? { ...m, [field]:true } : m));
        optionRef.current.onChanged?.(undefined, 'read');
      }
    } catch (failure) { fail(failure, 'read'); }
    finally { reading.current = false; }
  }, [apply, denied, enabled, fail, role, roomId]);
  const load = useCallback(async () => {
    if (!enabled || denied) return;
    const sequence = ++request.current, generation = epoch.current;
    const snapshot = new Map(rows.current.map(m => [m.id,m]));
    try {
      const response = await conexionesService.mensajes.filter({ alumno_id:roomId }, 'created_date');
      if (!mounted.current || sequence !== request.current || generation !== epoch.current) return;
      const updates = rows.current.filter(m => snapshot.get(m.id) !== m);
      apply(mergeChatMessages(response, updates, roomId).filter(m => !deleted.current.has(m.id)));
      setError('');
      void markRead();
    } catch (failure) { if (sequence === request.current) fail(failure, 'load'); }
    finally { if (mounted.current && sequence === request.current) setLoading(false); }
  }, [apply, denied, enabled, fail, markRead, roomId]);
  useEffect(() => {
    ++request.current; ++epoch.current;
    rows.current = []; deleted.current.clear(); setMessages([]); setDenied(false); setLoading(true); setError('');
  }, [roomId]);
  useEffect(() => {
    mounted.current = true;
    if (!enabled || denied) { setLoading(false); return () => { mounted.current = false; ++request.current; }; }
    void load();
    const unsubscribe = conexionesService.subscribeChatRoom(roomId, event => {
      if (event.type === 'poll') { void load(); return; }
      const payload = conexionesService.parseWsPayload(event);
      if (String(payload?.room_id) !== roomId) return;
      if (payload.type === 'message' && payload.data?.id && String(payload.data.alumno_id) === roomId) {
        if (deleted.current.has(payload.data.id)) return;
        const existing = rows.current.some(m => m.id === payload.data.id);
        apply(mergeChatMessages(rows.current, [payload.data], roomId));
        setLoading(false); setError('');
        optionRef.current.onChanged?.(payload.data, existing ? 'updated' : 'message');
        void markRead();
      } else if (payload.type === 'deleted') {
        deleted.current.add(payload.id); apply(rows.current.filter(m => m.id !== payload.id));
        optionRef.current.onChanged?.(undefined, 'deleted');
      } else if (payload.type === 'cleared') {
        ++epoch.current; apply([]); optionRef.current.onChanged?.(undefined, 'cleared');
      } else if (payload.type === 'read') {
        const field = payload.reader === 'alumno' ? 'leido_alumno' : 'leido_instructor';
        apply(rows.current.map(m => m.remitente !== payload.reader ? { ...m,[field]:true } : m));
      }
    });
    const onVisible = () => { if (document.visibilityState === 'visible') void load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { mounted.current = false; ++request.current; unsubscribe(); document.removeEventListener('visibilitychange', onVisible); };
  }, [apply, denied, enabled, load, markRead, roomId]);
  const send = async (content: string) => {
    if (!enabled || denied || sendingNow.current) return;
    sendingNow.current = true; setSending(true); setError('');
    try {
      const created = await conexionesService.mensajes.create({ alumno_id:roomId, contenido:content });
      if (mounted.current) { apply(mergeChatMessages(rows.current, [created], roomId)); optionRef.current.onChanged?.(created, 'updated'); }
      return created;
    } catch (failure) { fail(failure, 'send'); throw failure; }
    finally { sendingNow.current = false; if (mounted.current) setSending(false); }
  };
  const clear = async () => {
    if (!enabled || denied || role !== 'instructor' || clearing) return;
    setClearing(true);
    try {
      await conexionesService.mensajes.clearChat(roomId);
      if (mounted.current) { ++epoch.current; apply([]); optionRef.current.onChanged?.(undefined, 'cleared'); }
    } catch (failure) { fail(failure,'clear'); throw failure; }
    finally { if (mounted.current) setClearing(false); }
  };
  const ownMessages = useMemo(() => messages.filter(m => String(m.alumno_id) === roomId), [messages, roomId]);
  const retry = () => { if (denied) setDenied(false); else void load(); };
  return { messages:ownMessages, loading, error, sending, clearing, send, clear, load, retry, canSend:enabled && !denied };
}
