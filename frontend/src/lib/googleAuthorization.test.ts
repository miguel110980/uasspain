import { afterEach, expect, test, vi } from 'vitest';
vi.mock('@/api/apiClient', () => ({ default: { post: vi.fn() } }));
vi.mock('./windowSession', () => ({ ensureBrowserContext: vi.fn(), ensureWindowSession: vi.fn().mockResolvedValue('window-fixture') }));
import apiClient from '@/api/apiClient';
import { startGoogleAuthorization } from './googleAuthorization';
const origin = 'https://www.uasspain-prueba.duckdns.org';
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
function setup(redirect: string) {
  const assign = vi.fn(), setItem = vi.fn();
  vi.stubGlobal('window', { location: { origin, assign }, sessionStorage: { setItem, getItem: () => 'owner-fixture' } });
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('response_type', 'code'); url.searchParams.set('redirect_uri', redirect); url.searchParams.set('state', 'synthetic-state');
  vi.mocked(apiClient.post).mockResolvedValue({ data: { authorization_url: url.toString() } });
  return { assign, setItem };
}
test('uses the exact public callback and preserves the per-window handoff', async () => {
  const { assign, setItem } = setup(origin + '/auth/google/callback');
  await startGoogleAuthorization('verify', 'synthetic-password');
  expect(assign).toHaveBeenCalledOnce();
  expect(setItem).toHaveBeenCalledWith('uasspain.google_code_flow', expect.stringContaining('window-fixture'));
});
for (const redirect of [origin + '/auth/google/callback/', origin + '/other', origin + '/auth/google/callback?next=foreign', origin + '/auth/google/callback#fragment', 'https://uasspain-prueba.duckdns.org/auth/google/callback', 'https://localhost/auth/google/callback', 'https://user@www.uasspain-prueba.duckdns.org/auth/google/callback']) {
  test('rejects incompatible callback before storing a handoff: ' + redirect, async () => {
    const { assign, setItem } = setup(redirect);
    await expect(startGoogleAuthorization('verify')).rejects.toThrow();
    expect(assign).not.toHaveBeenCalled(); expect(setItem).not.toHaveBeenCalled();
  });
}
