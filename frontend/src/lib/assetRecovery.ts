const ATTEMPT_KEY = 'uasspain:asset-recovery';
let pending: Promise<boolean> | undefined;

export function isAssetLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|ChunkLoadError|Unable to preload CSS/i.test(message);
}

// Retained, immutable assets prevent failures during deployment. This fallback
// handles tabs older than the retained store, only when a newer release exists.
export function recoverAssetLoad(error: unknown): Promise<boolean> {
  if (!isAssetLoadError(error) || typeof window === 'undefined' || !navigator.onLine) return Promise.resolve(false);
  if (pending) return pending;
  pending = (async () => {
    try {
      const response = await fetch('/version.json', { cache: 'no-store', signal: AbortSignal.timeout(5000) });
      if (!response.ok) return false;
      const { buildId } = await response.json();
      if (typeof buildId !== 'string' || !/^[a-f0-9-]{36}$/.test(buildId) || buildId === __APP_BUILD_ID__) return false;
      // If storage is unavailable, do not risk an automatic reload loop.
      if (sessionStorage.getItem(ATTEMPT_KEY) === buildId) return false;
      sessionStorage.setItem(ATTEMPT_KEY, buildId);
      window.location.reload();
      return true;
    } catch { return false; }
  })().finally(() => { pending = undefined; });
  return pending;
}

export function installAssetRecovery() {
  window.addEventListener('vite:preloadError', event => {
    void recoverAssetLoad((event as Event & { payload: unknown }).payload);
  });
}
