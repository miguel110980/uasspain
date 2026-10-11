import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/api/apiClient', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
import apiClient from '@/api/apiClient';
import { isSessionActivity, watchSessionActivity } from './sessionActivity';
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('inactivity uses actual user input', () => {
  it('rejects programmatic interactions and transport/lifecycle events', () => {
    for (const type of ['pointerdown', 'keydown', 'input', 'submit', 'wheel', 'touchstart', 'touchmove']) {
      expect(isSessionActivity({ type, isTrusted: false } as Event)).toBe(false);
      expect(isSessionActivity({ type, isTrusted: true } as Event)).toBe(true);
    }
    expect(isSessionActivity({ type: 'pointermove', isTrusted: true, buttons: 1 } as PointerEvent)).toBe(true);
    expect(isSessionActivity({ type: 'pointermove', isTrusted: true, buttons: 0 } as PointerEvent)).toBe(false);
    expect(isSessionActivity({ type: 'pointermove', isTrusted: false, buttons: 1 } as PointerEvent)).toBe(false);
    for (const type of ['message', 'online', 'visibilitychange', 'pageshow', 'focus', 'scroll']) {
      expect(isSessionActivity({ type, isTrusted: true } as Event)).toBe(false);
    }
  });
  it('shares one watcher, never renews on wake or timeout, and releases listeners', async () => {
    vi.useFakeTimers();
    const listeners = new Map<string, (event: Event) => void>();
    const add = vi.fn((type: string, listener: (event: Event) => void) => listeners.set(type, listener));
    const remove = vi.fn((type: string) => listeners.delete(type));
    vi.stubGlobal('window', { addEventListener: add, removeEventListener: remove });
    vi.stubGlobal('document', { visibilityState: 'visible', addEventListener: add, removeEventListener: remove });
    vi.mocked(apiClient.get).mockResolvedValue({ data: { remaining_ms: 900000 } });
    vi.mocked(apiClient.post).mockResolvedValue({ data: { remaining_ms: 900000 } });
    const first = watchSessionActivity(), second = watchSessionActivity();
    await Promise.resolve();
    expect(apiClient.get).toHaveBeenCalledTimes(1);
    listeners.get('online')?.({ type: 'online', isTrusted: true } as Event);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(900000);
    expect(apiClient.get).toHaveBeenCalledTimes(3);
    expect(apiClient.post).not.toHaveBeenCalled();
    first(); expect(listeners.size).toBeGreaterThan(0);
    second(); expect(listeners.size).toBe(0);
    await vi.advanceTimersByTimeAsync(900000);
    expect(apiClient.get).toHaveBeenCalledTimes(3);
  });
  it('updates only after trusted input and bounds a burst without a perpetual heartbeat', async () => {
    vi.useFakeTimers();
    const listeners = new Map<string, (event: Event) => void>();
    vi.stubGlobal('window', {
      addEventListener: (type: string, listener: (event: Event) => void) => listeners.set(type, listener),
      removeEventListener: (type: string) => listeners.delete(type),
    });
    vi.stubGlobal('document', { visibilityState: 'visible', addEventListener: vi.fn(), removeEventListener: vi.fn() });
    vi.mocked(apiClient.get).mockResolvedValue({ data: { remaining_ms: 900000 } });
    vi.mocked(apiClient.post).mockResolvedValue({ data: { remaining_ms: 900000 } });
    const stop = watchSessionActivity();
    const keydown = listeners.get('keydown')!;
    keydown({ type: 'keydown', isTrusted: false } as Event);
    expect(apiClient.post).not.toHaveBeenCalled();
    for (let i = 0; i < 20; i++) keydown({ type: 'keydown', isTrusted: true } as Event);
    await vi.advanceTimersByTimeAsync(1100);
    expect(apiClient.post).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(10000);
    expect(apiClient.post).toHaveBeenCalledTimes(2);
    stop();
  });
});
