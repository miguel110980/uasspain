import { afterEach, expect, test, vi } from 'vitest';
const owner = '11111111-1111-4111-8111-111111111111';
const windowId = '22222222-2222-4222-8222-222222222222';
function browser(query: string, flow: unknown) {
  const storage = new Map<string, string>(); if (flow) storage.set('uasspain.google_code_flow', JSON.stringify(flow));
  const replaceState = vi.fn();
  const value = { name: '', location: { search: query }, history: { replaceState }, sessionStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, v: string) => storage.set(key, v), removeItem: (key: string) => storage.delete(key) } };
  vi.stubGlobal('window', value); return { value, storage, replaceState };
}
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });
test('return removes code from browser URL before restoring its own window and consumes once', async () => {
  const b = browser('?code=synthetic-code&state=bound-state', { owner, windowId, state: 'bound-state', purpose: 'link' });
  const callback = await import('./googleCallbackHandoff'); callback.prepareGoogleCallback();
  expect(b.replaceState).toHaveBeenCalledWith(null, '', '/auth/google/callback');
  expect(b.value.name).toBe(`uasspain.tab:${owner}`); expect(b.storage.get('uasspain.window_session_id')).toBe(windowId);
  expect(b.storage.has('uasspain.google_code_flow')).toBe(false);
  expect(callback.takeGoogleCallback()).toEqual({ code: 'synthetic-code', state: 'bound-state', purpose: 'link' });
  expect(() => callback.takeGoogleCallback()).toThrow('ya se ha utilizado');
});
test.each([{ state: 'foreign', owner, windowId, purpose: 'link' }, { state: 'bound-state', owner, windowId, purpose: 'escalate' }, { state: 'bound-state', owner: 'not-an-owner', windowId, purpose: 'login' }])('foreign or malformed return never restores window identity: %j', async flow => {
  const b = browser('?code=synthetic-code&state=bound-state', flow); const callback = await import('./googleCallbackHandoff');
  expect(() => callback.takeGoogleCallback()).toThrow(); expect(b.value.name).toBe(''); expect(b.storage.has('uasspain.window_session_id')).toBe(false);
});
test('canceled authorization clears the return query and leaves conventional access available', async () => {
  const b = browser('?error=access_denied&state=bound-state', { owner, windowId, state: 'bound-state', purpose: 'verify' });
  const callback = await import('./googleCallbackHandoff'); expect(() => callback.takeGoogleCallback()).toThrow('convencional'); expect(b.replaceState).toHaveBeenCalled();
});
