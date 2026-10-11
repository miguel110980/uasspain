import { windowBoundUrl } from '@/lib/windowSession';
import apiClient from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';
import { buildListParams, unwrapItem, unwrapList } from '@/api/queryParams';
import { MENSAJE_SCHEMA, sanitizeRecord } from '@/lib/sanitizeSchemas';
import type { SanitizeKind } from '@/lib/sanitize';

const crud = (baseUrl: string, schema?: Record<string, SanitizeKind>) => ({
  async list(sort?: string, limit?: number, filters: Record<string, unknown> = {}) {
    const res = await apiClient.get(baseUrl, {
      params: buildListParams(sort, limit, filters),
    });
    return unwrapList(res);
  },

  async filter(query: Record<string, unknown>, sort?: string, limit?: number) {
    return crud(baseUrl).list(sort, limit, query);
  },

  async get(id: string) {
    const res = await apiClient.get(`${baseUrl}${id}/`);
    return unwrapItem(res);
  },

  async create(data: Record<string, unknown>) {
    const body = schema ? sanitizeRecord(data, schema) : data;
    const res = await apiClient.post(baseUrl, body);
    return unwrapItem(res);
  },

  async update(id: string, data: Record<string, unknown>) {
    const body = schema ? sanitizeRecord(data, schema) : data;
    const res = await apiClient.patch(`${baseUrl}${id}/`, body);
    return unwrapItem(res);
  },

  async bulkUpdate(items: unknown[]) {
    const res = await apiClient.patch(`${baseUrl}bulk/`, { items });
    return unwrapList(res);
  },

  async delete(id: string) {
    await apiClient.delete(`${baseUrl}${id}/`);
    return { id };
  },

  async deleteMany(query: Record<string, unknown>) {
    const res = await apiClient.post(`${baseUrl}delete-many/`, { query });
    return res.data;
  },
});

function parseWsPayload(event: any) {
  if (event?.type !== 'ws') return null;
  const raw = event.data;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return { raw };
    }
  }
  return raw;
}

type RealtimeEvent = { type: 'poll' | 'ws'; data?: unknown };
type Listener = { callback: (event: RealtimeEvent) => void; pollMs: number; timer?: ReturnType<typeof setInterval> };
type Subscription = { listeners: Set<Listener>; dispose: () => void; catchUp: () => void };
const subscriptions = new Map<string, Subscription>();

/** All mounted sections in this window share one authenticated event socket. */
function createWsSubscription(url: string, onEvent: (event: RealtimeEvent) => void, pollMs = 15000) {
  let subscription = subscriptions.get(url);
  if (!subscription) {
    subscription = createTransport(url);
    subscriptions.set(url, subscription);
  }
  const listener: Listener = { callback: onEvent, pollMs };
  subscription.listeners.add(listener);
  subscription.catchUp();
  return () => {
    clearInterval(listener.timer);
    subscription.listeners.delete(listener);
    if (!subscription.listeners.size) {
      subscription.dispose();
      if (subscriptions.get(url) === subscription) subscriptions.delete(url);
    }
  };
}

function createTransport(url: string): Subscription {
  const listeners = new Set<Listener>();
  let ws: WebSocket | null = null;
  let closed = false;
  let reconnect: ReturnType<typeof setTimeout> | null = null;
  let failures = 0;
  const emit = (event: RealtimeEvent) => {
    for (const listener of listeners) listener.callback(event);
  };
  const catchUp = () => {
    for (const listener of listeners) {
      // Also reconcile missed notices while connected, e.g. after laptop sleep.
      const interval = typeof WebSocket !== 'undefined' && ws?.readyState === WebSocket.OPEN ? 30000 : listener.pollMs;
      if (!listener.timer) listener.timer = setInterval(() => listener.callback({ type: 'poll' }), interval);
    }
  };
  const resetPolling = () => {
    for (const listener of listeners) { clearInterval(listener.timer); listener.timer = undefined; }
    catchUp();
  };
  const scheduleReconnect = () => {
    if (closed || reconnect) return;
    resetPolling();
    reconnect = setTimeout(() => {
      reconnect = null;
      void connectWs();
    }, Math.min(30000, 1000 * 2 ** Math.min(failures++, 5)));
  };

  const connectWs = async () => {
    if (!url || closed || typeof WebSocket === 'undefined') {
      catchUp();
      return;
    }
    try {
      // Revalidate this tab before reconnecting; this lookup never renews activity.
      if (failures) await apiClient.get(endpoints.auth.me);
      if (closed) return;
      const current = new WebSocket(windowBoundUrl(url));
      ws = current;
      current.onopen = () => {
        if (closed || current !== ws) return;
        failures = 0; resetPolling(); emit({ type: 'poll' });
      };
      current.onmessage = (event) => {
        if (closed || current !== ws) return;
        let data = event.data;
        try {
          data = JSON.parse(event.data);
        } catch {
          // mantener string
        }
        if (data?.type === 'resync_required') emit({ type: 'poll' });
        else emit({ type: 'ws', data });
      };
      current.onclose = (event) => {
        if (current !== ws) return;
        ws = null;
        if (event?.code === 1008) {
          closed = true;
          for (const listener of listeners) clearInterval(listener.timer);
          void apiClient.get(endpoints.auth.me).catch(() => {});
          return;
        }
        scheduleReconnect();
      };
      current.onerror = () => current.close();
    } catch {
      scheduleReconnect();
    }
  };

  const onVisible = () => {
    if (document.visibilityState === 'visible') emit({ type: 'poll' });
  };
  const onOnline = () => { emit({ type: 'poll' }); if (!ws && !reconnect) void connectWs(); };
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('online', onOnline);
  void connectWs();
  return { listeners, catchUp, dispose: () => {
    closed = true;
    if (reconnect) clearTimeout(reconnect);
    for (const listener of listeners) clearInterval(listener.timer);
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('online', onOnline);
    ws?.close();
  } };
}

export const conexionesService = {
  conexiones: crud(endpoints.conexiones),
  registros: crud(endpoints.registrosConexion),
  async sesionesActivas() {
    const res = await apiClient.get(`${endpoints.registrosConexion}activas/`);
    return unwrapList(res);
  },
  mensajes: {
    ...crud(endpoints.mensajes, MENSAJE_SCHEMA),
    async unreadCount(alumnoId?: string) {
      return (await apiClient.get(`${endpoints.mensajes}unread/`, { params: alumnoId ? { alumno_id:alumnoId } : {} })).data.count;
    },
    async summaries(alumnoId?: string) {
      return unwrapList(await apiClient.get(`${endpoints.mensajes}summaries/`, { params: alumnoId ? { alumno_id:alumnoId } : {} }));
    },
    async markRead(alumnoId) {
      const res = await apiClient.post(`${endpoints.mensajes}mark-read/`, { alumno_id: String(alumnoId) });
      return res.data;
    },
    async clearChat(alumnoId) {
      const res = await apiClient.post(`${endpoints.mensajes}clear-chat/`, { alumno_id: String(alumnoId) });
      return res.data;
    },
    async broadcast(recipientIds, contenido) {
      const body = sanitizeRecord({ contenido }, MENSAJE_SCHEMA);
      const res = await apiClient.post(`${endpoints.mensajes}broadcast/`, {
        recipient_ids: recipientIds.map(String),
        contenido: body.contenido,
      });
      return unwrapList(res);
    },
  },
  mensajesStaff: {
    ...crud(endpoints.mensajesStaff),
    async unreadCount() {
      return (await apiClient.get(`${endpoints.mensajesStaff}unread/`)).data.count;
    },
    async contacts() {
      const res = await apiClient.get(`${endpoints.mensajesStaff}contacts/`);
      return unwrapList(res);
    },
    async markRead(peerId) {
      const res = await apiClient.post(`${endpoints.mensajesStaff}mark-read/`, { peer_id: String(peerId) });
      return res.data;
    },
    async clearChat(peerId) {
      const res = await apiClient.post(`${endpoints.mensajesStaff}clear-chat/`, { peer_id: String(peerId) });
      return res.data;
    },
    async broadcast(recipientIds, contenido) {
      const body = sanitizeRecord({ contenido }, MENSAJE_SCHEMA);
      const res = await apiClient.post(`${endpoints.mensajesStaff}broadcast/`, {
        recipient_ids: recipientIds.map(String),
        contenido: body.contenido,
      });
      return unwrapList(res);
    },
  },
  videollamadas: crud(endpoints.videollamadas),

  parseWsPayload,

  subscribeMensajes(onEvent) {
    return createWsSubscription(endpoints.ws.conexiones, event => {
      const type = parseWsPayload(event)?.type;
      if (event.type === 'poll' || ['mensaje', 'mensaje_staff', 'asignacion'].includes(type)) onEvent(event);
    }, 5000);
  },

  subscribeConexiones(onEvent) {
    return createWsSubscription(endpoints.ws.conexiones, onEvent, 15000);
  },

  subscribeChatRoom(roomId, onEvent) {
    if (!roomId) return () => {};
    return createWsSubscription(endpoints.ws.chat(roomId), onEvent, 12000);
  },

  subscribeVideollamadas(onEvent) {
    return createWsSubscription(endpoints.ws.conexiones, event => {
      const type = parseWsPayload(event)?.type;
      if (event.type === 'poll' || ['video_changed', 'asignacion'].includes(type)) onEvent(event);
    }, 10000);
  },
};

export default conexionesService;
