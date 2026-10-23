import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('@/api/apiClient', () => ({ default: { get: vi.fn().mockResolvedValue({ data: {} }) } }));
vi.mock('@/lib/windowSession', () => ({ windowBoundUrl: (url: string) => url }));

class TestSocket {
  static OPEN = 1;
  static instances: TestSocket[] = [];
  readyState = 0;
  onopen?: () => void;
  onmessage?: (event: { data: string }) => void;
  onclose?: () => void;
  onerror?: () => void;
  constructor(public url: string) { TestSocket.instances.push(this); }
  open() { this.readyState = 1; this.onopen?.(); }
  close() { this.readyState = 3; this.onclose?.(); }
}
let cleanups: (() => void)[];
beforeEach(() => {
  vi.resetModules(); vi.useFakeTimers(); cleanups = []; TestSocket.instances = [];
  vi.stubGlobal('WebSocket', TestSocket);
  vi.stubGlobal('window', { location: { hostname: 'localhost', host: 'localhost', protocol: 'https:' }, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn(), visibilityState: 'visible' });
});
afterEach(() => { cleanups.forEach(fn => fn()); vi.useRealTimers(); vi.unstubAllGlobals(); });

it('shares presence, messages and call notifications without exceeding connection limits', async () => {
  const { default: service } = await import('./conexionesService');
  const callbacks = [vi.fn(), vi.fn(), vi.fn()];
  cleanups.push(service.subscribeMensajes(callbacks[0]), service.subscribeConexiones(callbacks[1]), service.subscribeVideollamadas(callbacks[2]));
  expect(TestSocket.instances).toHaveLength(1);
  const socket = TestSocket.instances[0]; socket.open();
  socket.onmessage?.({ data: JSON.stringify({ type: 'mensaje', action: 'created' }) });
  for (const callback of callbacks.slice(0, 2)) expect(callback).toHaveBeenLastCalledWith({ type: 'ws', data: { type: 'mensaje', action: 'created' } });
  expect(callbacks[2]).toHaveBeenLastCalledWith({ type: 'poll' });
  socket.onmessage?.({ data: JSON.stringify({ type: 'video_changed' }) });
  await vi.advanceTimersByTimeAsync(150);
  expect(callbacks[0]).toHaveBeenLastCalledWith({ type: 'ws', data: { type: 'mensaje', action: 'created' } });
  expect(callbacks[2]).toHaveBeenLastCalledWith({ type: 'ws', data: { type: 'video_changed' } });
  cleanups.shift()!(); expect(socket.readyState).toBe(1);
  socket.onmessage?.({ data: JSON.stringify({ type: 'resync_required' }) });
  expect(callbacks[1]).toHaveBeenLastCalledWith({ type: 'poll' });
  cleanups.splice(0).forEach(fn => fn()); expect(socket.readyState).toBe(3);
  expect(vi.getTimerCount()).toBe(0);
});

it('coalesces conference invitation bursts and cancels pending reconciliation on unmount', async () => {
  const { default: service } = await import('./conexionesService');
  const callback = vi.fn();
  const unsubscribe = service.subscribeVideollamadas(callback);
  cleanups.push(unsubscribe);
  const socket = TestSocket.instances[0]; socket.open();
  callback.mockClear();
  for (let index = 0; index < 5; index++) {
    socket.onmessage?.({ data: JSON.stringify({ type: 'video_changed' }) });
  }
  await vi.advanceTimersByTimeAsync(150);
  expect(callback).toHaveBeenCalledTimes(1);
  socket.onmessage?.({ data: JSON.stringify({ type: 'video_changed' }) });
  unsubscribe(); cleanups = [];
  await vi.advanceTimersByTimeAsync(1000);
  expect(callback).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it('reconciles during an outage and renews the HTTP session before reconnecting', async () => {
  const { default: service } = await import('./conexionesService');
  const { default: client } = await import('@/api/apiClient');
  const callback = vi.fn(); cleanups.push(service.subscribeMensajes(callback));
  TestSocket.instances[0].open(); TestSocket.instances[0].close();
  await vi.advanceTimersByTimeAsync(1000);
  expect(client.get).toHaveBeenCalledWith('/api/auth/me/');
  expect(TestSocket.instances).toHaveLength(2);
  await vi.advanceTimersByTimeAsync(4000);
  expect(callback).toHaveBeenLastCalledWith({ type: 'poll' });
  TestSocket.instances[1].open();
  const count = callback.mock.calls.length;
  await vi.advanceTimersByTimeAsync(30000);
  expect(callback.mock.calls.length).toBeGreaterThan(count);
});

it('keeps polling when WebSocket is unavailable and cancels all timers on unmount', async () => {
  vi.stubGlobal('WebSocket', undefined);
  const { default: service } = await import('./conexionesService');
  const callback = vi.fn(); cleanups.push(service.subscribeMensajes(callback));
  await vi.advanceTimersByTimeAsync(5000);
  expect(callback).toHaveBeenCalledWith({ type: 'poll' });
  cleanups.splice(0).forEach(fn => fn()); expect(vi.getTimerCount()).toBe(0);
});
