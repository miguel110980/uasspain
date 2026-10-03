import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isAssetLoadError, recoverAssetLoad } from './assetRecovery';

const newer = '12345678-1234-1234-1234-123456789abc';
const error = new TypeError('Failed to fetch dynamically imported module: https://localhost/assets/old.js');
let storage: Map<string, string>;
let reload: ReturnType<typeof vi.fn>;
let fetcher: ReturnType<typeof vi.fn>;
beforeEach(() => {
  storage = new Map(); reload = vi.fn();
  fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ buildId: newer }) });
  vi.stubGlobal('window', { location: { reload } });
  vi.stubGlobal('navigator', { onLine: true });
  vi.stubGlobal('sessionStorage', { getItem: (key: string) => storage.get(key), setItem: (key: string, value: string) => storage.set(key, value) });
  vi.stubGlobal('fetch', fetcher);
});
afterEach(() => vi.unstubAllGlobals());

describe('asset recovery', () => {
  it('recognizes Chromium, Firefox, Safari and CSS preload failures', () => {
    for (const message of ['Failed to fetch dynamically imported module', 'error loading dynamically imported module', 'Importing a module script failed', 'ChunkLoadError', 'Unable to preload CSS']) expect(isAssetLoadError(new Error(message))).toBe(true);
    expect(isAssetLoadError(new Error('Invalid user input'))).toBe(false);
  });
  it('checks the release without cache and refreshes the current URL only once per target release', async () => {
    expect(await recoverAssetLoad(error)).toBe(true);
    expect(fetcher).toHaveBeenCalledWith('/version.json', expect.objectContaining({ cache: 'no-store' }));
    expect(await recoverAssetLoad(error)).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });
  it('does not reload for a missing asset in the current release', async () => {
    fetcher.mockResolvedValue({ ok: true, json: async () => ({ buildId: __APP_BUILD_ID__ }) });
    expect(await recoverAssetLoad(error)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
  it('does not reload for render errors or offline failures', async () => {
    expect(await recoverAssetLoad(new Error('Cannot read properties of undefined'))).toBe(false);
    vi.stubGlobal('navigator', { onLine: false });
    expect(await recoverAssetLoad(error)).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('does not loop if session storage is unavailable', async () => {
    vi.stubGlobal('sessionStorage', { getItem() { throw new Error('denied'); } });
    expect(await recoverAssetLoad(error)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
  it('does not reload for unavailable or invalid release metadata', async () => {
    for (const response of [{ ok: false }, { ok: true, json: async () => ({ buildId: '../arbitrary' }) }]) {
      fetcher.mockResolvedValue(response);
      expect(await recoverAssetLoad(error)).toBe(false);
    }
    fetcher.mockRejectedValue(new Error('network down'));
    expect(await recoverAssetLoad(error)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
  it('coalesces Vite and React failures during the same request', async () => {
    const first = recoverAssetLoad(error);
    const second = recoverAssetLoad(error);
    expect(first).toBe(second);
    await first;
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
