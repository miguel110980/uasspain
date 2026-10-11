import type { QueryClient } from '@tanstack/react-query';
import endpoints from '@/api/endpoints';
import apiClient from '@/api/apiClient';

export type ContentKind = 'posts' | 'courses' | 'services';
const collections: ContentKind[] = ['posts', 'courses', 'services'];
const names = { posts: ['posts', 'blog-posts', 'blog-post'], courses: ['courses', 'course'], services: ['services', 'service'] };

export function invalidateContent(client: QueryClient, kind: ContentKind) {
  return client.invalidateQueries({ predicate: query =>
    ['public', 'admin'].includes(String(query.queryKey[0])) && (names[kind].includes(String(query.queryKey[1])) || query.queryKey[0] === 'admin' && query.queryKey[1] === 'content-images'),
  });
}

export function startContentRealtime(client: QueryClient) {
  let stopped = false;
  let socket: WebSocket | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let attempt = 0;
  let checking = false;
  const versions: Partial<Record<ContentKind, bigint>> = {};
  const pending = new Set<ContentKind>();
  let scheduled = false;
  const accept = (kind: ContentKind, revision: unknown) => {
    if (typeof revision !== 'string' || !/^\d{1,19}$/.test(revision)) return;
    const next = BigInt(revision);
    if (versions[kind] !== undefined && next <= versions[kind]) return;
    versions[kind] = next; pending.add(kind);
    if (!scheduled) {
      scheduled = true;
      queueMicrotask(() => { scheduled = false; if (stopped) return; for (const kind of pending) void invalidateContent(client, kind); pending.clear(); });
    }
  };
  const snapshot = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    for (const kind of collections) accept(kind, value[kind]);
  };
  const check = async () => {
    if (stopped || checking || !navigator.onLine) return;
    checking = true;
    try { const result = await apiClient.get(endpoints.public.contentVersions); if (!stopped) snapshot(result.data); }
    catch { /* Retain cached content; retry when connectivity returns. */ }
    finally { checking = false; }
  };
  const connect = () => {
    if (stopped || !navigator.onLine || socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return;
    clearTimeout(retry);
    socket = new WebSocket(endpoints.ws.content);
    socket.onopen = () => { attempt = 0; void check(); };
    socket.onmessage = event => {
      try {
        const value = JSON.parse(event.data);
        if (value.type === 'content_snapshot') snapshot(value.versions);
        else if (value.type === 'content_changed' && collections.includes(value.kind)) accept(value.kind, value.revision);
      } catch { /* Ignore malformed notices; the version endpoint recovers gaps. */ }
    };
    socket.onclose = () => { if (!stopped && navigator.onLine) retry = setTimeout(connect, Math.min(20_000, 500 * 2 ** Math.min(attempt++, 6)) + Math.random() * 250); };
  };
  const online = () => { connect(); void check(); };
  const offline = () => { clearTimeout(retry); socket?.close(); };
  const visible = () => { if (document.visibilityState === 'visible') online(); };
  window.addEventListener('online', online); window.addEventListener('offline', offline); document.addEventListener('visibilitychange', visible);
  const interval = setInterval(check, 30_000);
  connect(); void check();
  return () => { stopped = true; clearTimeout(retry); clearInterval(interval); socket?.close(); window.removeEventListener('online', online); window.removeEventListener('offline', offline); document.removeEventListener('visibilitychange', visible); };
}
