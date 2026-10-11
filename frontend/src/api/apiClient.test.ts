import axios, { AxiosError } from 'axios';
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('@/lib/windowSession', () => ({ ensureWindowSession: () => Promise.resolve('e43dca18-6c9f-4f42-9cda-62b54d715d95') }));
vi.mock('@/lib/clientMeta', () => ({ getEncodedClientMeta: () => Promise.resolve('test') }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('preserves the inactivity notice when the route guard also requests login', async () => {
  vi.resetModules();
  const replace = vi.fn(), setItem = vi.fn();
  vi.stubGlobal('window', { location: { pathname: '/alumno', search: '', replace }, sessionStorage: { setItem } });
  const { requestLogin } = await import('./apiClient');
  requestLogin('Tu sesión ha caducado por inactividad');
  requestLogin('', '/alumno');
  expect(replace).toHaveBeenCalledTimes(1);
  expect(setItem).toHaveBeenCalledExactlyOnceWith('uasspain.auth_notice', 'Tu sesión ha caducado por inactividad');
  vi.resetModules();
});

it('renews a rotated HttpOnly session only once when several requests expire together', async () => {
  const renew = vi.spyOn(axios, 'post').mockResolvedValue({ data: {} });
  const { default: client } = await import('./apiClient');
  client.defaults.adapter = async config => {
    if (!(config as typeof config & { _retry?: boolean })._retry) {
      throw new AxiosError('Expired access', 'ERR_BAD_REQUEST', config, undefined, {
        config, status: 401, statusText: 'Unauthorized', headers: {}, data: { code: 'not_authenticated' },
      });
    }
    return { config, status: 200, statusText: 'OK', headers: {}, data: 'authenticated' };
  };
  const results = await Promise.all(Array.from({ length: 6 }, (_, index) => client.get(`/api/test/${index}`)));
  expect(renew).toHaveBeenCalledTimes(1);
  expect(results.every(result => result.data === 'authenticated')).toBe(true);
});

it('reuses the renewed cookie when an earlier 401 arrives after renewal completes', async () => {
  const renew = vi.spyOn(axios, 'post').mockResolvedValue({ data: {} });
  const { default: client } = await import('./apiClient');
  client.defaults.adapter = async config => {
    if (!(config as typeof config & { _retry?: boolean })._retry) {
      if (config.url?.endsWith('/late')) await new Promise(resolve => setTimeout(resolve, 30));
      throw new AxiosError('Expired access', 'ERR_BAD_REQUEST', config, undefined, {
        config, status:401, statusText:'Unauthorized', headers:{}, data:{ code:'not_authenticated' },
      });
    }
    return { config, status:200, statusText:'OK', headers:{}, data:'authenticated' };
  };
  const results = await Promise.all([client.get('/api/early'), client.get('/api/late')]);
  expect(renew).toHaveBeenCalledTimes(1);
  expect(results.every(result => result.status === 200)).toBe(true);
});

it('keeps an optional public session lookup unauthorized without changing another window session', async () => {
  const replace = vi.fn(), setItem = vi.fn();
  vi.stubGlobal('window', { location: { pathname: '/formacion', origin: 'http://localhost', search: '', replace }, sessionStorage: { setItem } });
  const renew = vi.spyOn(axios, 'post');
  const { default: client } = await import('./apiClient');
  client.defaults.adapter = async config => {
    throw new AxiosError('Window mismatch', 'ERR_BAD_REQUEST', config, undefined, {
      config, status: 401, statusText: 'Unauthorized', headers: {}, data: { code: 'session_window_mismatch' },
    });
  };
  await expect(client.get('/api/auth/me/', { params: { optional: true } })).rejects.toMatchObject({ response: { status: 401 } });
  expect(renew).not.toHaveBeenCalled(); expect(replace).not.toHaveBeenCalled(); expect(setItem).not.toHaveBeenCalled();
});

it('requests login once for a mismatched window without refreshing or logging out shared cookies', async () => {
  const replace = vi.fn(), setItem = vi.fn();
  vi.stubGlobal('window', { location: { pathname: '/instructor', search: '', replace }, sessionStorage: { setItem } });
  const renew = vi.spyOn(axios, 'post');
  const { default: client } = await import('./apiClient');
  client.defaults.adapter = async config => {
    throw new AxiosError('Window mismatch', 'ERR_BAD_REQUEST', config, undefined, {
      config, status: 401, statusText: 'Unauthorized', headers: {}, data: { code: 'session_window_mismatch' },
    });
  };
  const responses = await Promise.allSettled(Array.from({ length: 5 }, (_, index) => client.get(`/api/resource/${index}`)));
  expect(responses.every(response => response.status === 'rejected')).toBe(true);
  expect(renew).not.toHaveBeenCalled();
  expect(replace).toHaveBeenCalledExactlyOnceWith('/?auth=login&from=%2Finstructor');
  expect(setItem).toHaveBeenCalledExactlyOnceWith('uasspain.auth_notice', expect.stringContaining('Inicia sesión aquí'));
});
