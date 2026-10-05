import axios, { AxiosError } from 'axios';
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('@/lib/windowSession', () => ({ ensureWindowSession: () => Promise.resolve('e43dca18-6c9f-4f42-9cda-62b54d715d95') }));
vi.mock('@/lib/clientMeta', () => ({ getEncodedClientMeta: () => Promise.resolve('test') }));
afterEach(() => { vi.restoreAllMocks(); });

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
