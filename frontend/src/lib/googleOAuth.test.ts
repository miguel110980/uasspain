import { afterEach, expect, test, vi } from 'vitest';
vi.mock('@/api/apiClient', () => ({ default: { get: vi.fn() } }));
import apiClient from '@/api/apiClient';
import { fetchGoogleClientId, invalidateGoogleConfig } from './googleOAuth';

function response() {
  let resolve!: (value: { data: { client_id: string | null } }) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<{ data: { client_id: string | null } }>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
afterEach(() => { invalidateGoogleConfig(); vi.resetAllMocks(); });

test('concurrent availability checks share one request, then explicitly recheck', async () => {
  const first = response();
  vi.mocked(apiClient.get).mockReturnValueOnce(first.promise);
  const a = fetchGoogleClientId(), b = fetchGoogleClientId();
  expect(apiClient.get).toHaveBeenCalledTimes(1);
  first.resolve({ data: { client_id: '  configured-client  ' } });
  expect(await a).toBe('configured-client'); expect(await b).toBe('configured-client');
  vi.mocked(apiClient.get).mockResolvedValueOnce({ data: { client_id: null } });
  expect(await fetchGoogleClientId()).toBe('');
  expect(apiClient.get).toHaveBeenCalledTimes(2);
});

test.each(['old-first', 'new-first'])('a save cannot reuse stale config or let an old completion evict the fresh request: %s', async (order) => {
  const old = response(), fresh = response();
  vi.mocked(apiClient.get).mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
  const beforeSave = fetchGoogleClientId();
  invalidateGoogleConfig();
  const afterSave = fetchGoogleClientId();
  expect(apiClient.get).toHaveBeenCalledTimes(2);
  if (order === 'old-first') {
    old.resolve({ data: { client_id: 'old-client' } });
    expect(await beforeSave).toBe('old-client');
    const concurrent = fetchGoogleClientId();
    expect(apiClient.get).toHaveBeenCalledTimes(2);
    fresh.resolve({ data: { client_id: 'new-client' } });
    expect(await concurrent).toBe('new-client');
  } else {
    fresh.resolve({ data: { client_id: 'new-client' } });
    expect(await afterSave).toBe('new-client');
    old.resolve({ data: { client_id: 'old-client' } });
    await beforeSave;
  }
  expect(await afterSave).toBe('new-client');
});

test('a failed availability request is retryable without reporting a configured client', async () => {
  vi.mocked(apiClient.get).mockRejectedValueOnce(new Error('unavailable'));
  await expect(fetchGoogleClientId()).rejects.toThrow('unavailable');
  vi.mocked(apiClient.get).mockResolvedValueOnce({ data: { client_id: null } });
  expect(await fetchGoogleClientId()).toBe('');
  expect(apiClient.get).toHaveBeenCalledTimes(2);
});
