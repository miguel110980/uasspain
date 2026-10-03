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

function createWsSubscription(url: string, onEvent: (event: any) => void, pollMs = 15000) {
  let ws: WebSocket | null = null;
  let poll: ReturnType<typeof setInterval> | null = null;
  let closed = false;
  let reconnect: ReturnType<typeof setTimeout> | null = null;
  let failures = 0;

  const stopPoll = () => {
    if (poll) {
      clearInterval(poll);
      poll = null;
    }
  };

  const startPoll = () => {
    if (poll || closed) return;
    poll = setInterval(() => onEvent({ type: 'poll' }), pollMs);
  };

  const connectWs = () => {
    if (!url || closed || typeof WebSocket === 'undefined') {
      startPoll();
      return;
    }
    try {
      const current = new WebSocket(windowBoundUrl(url));
      ws = current;
      current.onopen = () => { failures = 0; stopPoll(); onEvent({ type: 'poll' }); };
      current.onmessage = (event) => {
        if (closed || current !== ws) return;
        let data = event.data;
        try {
          data = JSON.parse(event.data);
        } catch {
          // mantener string
        }
        onEvent({ type: 'ws', data });
      };
      current.onclose = () => {
        if (current !== ws) return;
        ws = null;
        if (!closed) {
          startPoll();
          reconnect = setTimeout(connectWs, Math.min(30000, 1000 * 2 ** Math.min(failures++, 5)));
        }
      };
      current.onerror = () => current.close();
    } catch {
      startPoll();
    }
  };

  connectWs();

  return () => {
    closed = true;
    if (reconnect) clearTimeout(reconnect);
    stopPoll();
    ws?.close();
  };
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
    return createWsSubscription(endpoints.ws.conexiones, onEvent, 5000);
  },

  subscribeConexiones(onEvent) {
    return createWsSubscription(endpoints.ws.conexiones, onEvent, 15000);
  },

  subscribeChatRoom(roomId, onEvent) {
    if (!roomId) return () => {};
    return createWsSubscription(endpoints.ws.chat(roomId), onEvent, 12000);
  },

  subscribeVideollamadas(onEvent) {
    return createWsSubscription(endpoints.ws.conexiones, onEvent, 10000);
  },
};

export default conexionesService;
