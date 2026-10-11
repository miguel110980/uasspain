import { afterEach, describe, expect, it, vi } from 'vitest';
import type { QueryClient } from '@tanstack/react-query';
vi.mock('@/api/apiClient', () => ({ default: { get: vi.fn() } }));
vi.mock('@/api/endpoints', () => ({ default: { public: { contentVersions: '/api/public/content/versions/' }, ws: { content: 'wss://localhost/ws/public-content/' } } }));
import apiClient from '@/api/apiClient';
import { invalidateContent, startContentRealtime } from './contentRealtime';

class Socket {
  static OPEN = 1; static CONNECTING = 0; static instances: Socket[] = [];
  readyState = 0;
  onopen?: () => void; onclose?: () => void; onmessage?: (event: { data: string }) => void;
  constructor(readonly url: string) { Socket.instances.push(this); }
  close() { this.readyState = 3; this.onclose?.(); }
  open() { this.readyState = 1; this.onopen?.(); }
  message(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }); }
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.clearAllMocks(); Socket.instances = []; });

function setup() {
  vi.useFakeTimers();
  vi.stubGlobal('window', new EventTarget()); vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' })); vi.stubGlobal('navigator', { onLine: true }); vi.stubGlobal('WebSocket', Socket);
  vi.mocked(apiClient.get).mockResolvedValue({ data: { posts: '0', courses: '0', services: '0' } });
  const invalidateQueries = vi.fn().mockResolvedValue(undefined);
  const client = { invalidateQueries } as unknown as QueryClient;
  const stop = startContentRealtime(client);
  return { client, invalidateQueries, stop };
}
async function flush() { await vi.advanceTimersByTimeAsync(0); }

describe('public content versions', () => {
  it('invalidates only the affected public/admin collection', () => {
    const client = { invalidateQueries: vi.fn() } as unknown as QueryClient;
    invalidateContent(client, 'services');
    const predicate = vi.mocked(client.invalidateQueries).mock.calls[0][0].predicate;
    expect(predicate({ queryKey: ['public', 'service', 'slug'] } as never)).toBe(true);
    expect(predicate({ queryKey: ['admin', 'services'] } as never)).toBe(true);
    expect(predicate({ queryKey: ['admin', 'courses'] } as never)).toBe(false);
    expect(predicate({ queryKey: ['session', 'profile'] } as never)).toBe(false);
  });
  it('ignores duplicate/out-of-order revisions and retains large integer precision', async () => {
    const { invalidateQueries, stop } = setup(); await flush(); invalidateQueries.mockClear();
    const socket = Socket.instances[0];
    socket.message({ type: 'content_changed', kind: 'services', revision: '9007199254740993' }); await flush();
    expect(invalidateQueries).toHaveBeenCalledTimes(1);
    socket.message({ type: 'content_changed', kind: 'services', revision: '9007199254740992' }); socket.message({ type: 'content_changed', kind: 'services', revision: '9007199254740993' }); socket.message({ type: 'content_changed', kind: 'private_users', revision: '42' }); await flush();
    expect(invalidateQueries).toHaveBeenCalledTimes(1); stop();
  });
  it('recovers missed changes on reconnect and stops retries after unmount', async () => {
    const { invalidateQueries, stop } = setup(); await flush(); Socket.instances[0].open(); await flush(); invalidateQueries.mockClear();
    Socket.instances[0].close(); await vi.advanceTimersByTimeAsync(1000);
    const reconnect = Socket.instances.at(-1); expect(Socket.instances).toHaveLength(2);
    vi.mocked(apiClient.get).mockResolvedValue({ data: { posts: '0', courses: '4', services: '0' } }); reconnect.open(); await flush();
    expect(invalidateQueries).toHaveBeenCalledTimes(1); stop(); await vi.advanceTimersByTimeAsync(60000); expect(Socket.instances).toHaveLength(2);
  });
  it('recovers by read-only version checks while the socket is unavailable', async () => {
    const { invalidateQueries, stop } = setup(); await flush(); invalidateQueries.mockClear();
    vi.mocked(apiClient.get).mockResolvedValue({ data: { posts: '1', courses: '0', services: '0' } }); await vi.advanceTimersByTimeAsync(30000);
    expect(invalidateQueries).toHaveBeenCalledTimes(1);
    expect(vi.mocked(apiClient.get).mock.calls.every(([path]) => path === '/api/public/content/versions/')).toBe(true); stop();
  });
});
