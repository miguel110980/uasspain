const STORAGE_KEY = 'uasspain.window_session_id';
const HANDOFF_KEY = 'uasspain.window_session_handoff';
const OWNER_KEY = 'uasspain.window_owner';
const OWNER_PREFIX = 'uasspain.tab:';
let ready: Promise<string> | undefined;
let contextReady: Promise<void> | undefined;

/** Serialize first cookie creation across tabs; credentials remain HttpOnly. */
export async function ensureBrowserContext(): Promise<void> {
  if (typeof window === 'undefined') return;
  if (!contextReady) contextReady = (async () => {
    const windowId = await ensureWindowSession();
    const prepare = async () => {
      const response = await fetch('/api/auth/context/', {
        method: 'POST', credentials: 'include',
        headers: { 'X-UASSpain-Window-Id': windowId },
      });
      if (!response.ok) throw new Error('No se pudo preparar el contexto de sesión.');
    };
    if (navigator.locks) await navigator.locks.request('uasspain.browser-context', prepare);
    else await prepare();
  })().catch(error => { contextReady = undefined; throw error; });
  return contextReady;
}

/** Only a random window binding is readable by JS; JWTs stay in HttpOnly cookies. */
export function ensureWindowSession(): Promise<string> {
  if (typeof window === 'undefined') return Promise.resolve('');
  if (ready) return ready;
  ready = (async () => {
    let id = window.sessionStorage.getItem(STORAGE_KEY);
    // sessionStorage is copied by window.open/duplicate. The browsing-context
    // name survives reload but belongs to the original window, even while its
    // old document releases a lock. Neither identifier is an auth credential.
    let owner = window.sessionStorage.getItem(OWNER_KEY);
    if (!owner || window.name !== OWNER_PREFIX + owner) {
      owner = crypto.randomUUID();
      window.name = OWNER_PREFIX + owner;
      window.sessionStorage.setItem(OWNER_KEY, owner);
      id = crypto.randomUUID();
      window.sessionStorage.removeItem(HANDOFF_KEY);
    }
    const handoff = window.sessionStorage.getItem(HANDOFF_KEY);
    window.sessionStorage.removeItem(HANDOFF_KEY);
    if (!id || !/^[a-f0-9-]{36}$/.test(id)) id = crypto.randomUUID();
    const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('uasspain.window-owners');
    let owned = false;
    let copied = false;
    const instance = crypto.randomUUID();
    if (channel) {
      channel.onmessage = ({ data }) => {
        if (data?.id !== id || data.instance === instance) return;
        if (data.type === 'probe' && owned) channel.postMessage({ type: 'owner', id, instance });
        if (data.type === 'owner') copied = true;
      };
    }
    // Web Locks makes duplicate detection atomic, including simultaneous tab startup.
    let release: (() => void) | undefined;
    if (navigator.locks) {
      const claim = (wait = false) => new Promise<boolean>((resolve) => {
        const controller = new AbortController();
        const timer = wait ? setTimeout(() => controller.abort(), 2000) : undefined;
        void navigator.locks.request(`uasspain.window:${id}`, wait ? { signal: controller.signal } : { ifAvailable: true }, async (lock) => {
          clearTimeout(timer);
          resolve(Boolean(lock));
          if (lock) await new Promise<void>((done) => { release = done; });
        }).catch(() => { clearTimeout(timer); resolve(false); });
      });
      if (!(await claim(handoff === id))) { id = crypto.randomUUID(); await claim(); }
    } else if (channel) {
      channel.postMessage({ type: 'probe', id, instance });
      await new Promise((resolve) => { setTimeout(resolve, 300); });
      if (copied) id = crypto.randomUUID();
    } else {
      // A live tab has no handoff to copy. Only its departing document writes
      // this single-use marker, so reload/navigation can retain the binding.
      if (handoff !== id) id = crypto.randomUUID();
    }
    window.sessionStorage.setItem(STORAGE_KEY, id);
    owned = true;
    window.addEventListener('pagehide', () => {
      window.sessionStorage.setItem(HANDOFF_KEY, id);
      owned = false; channel?.close(); release?.();
    }, { once: true });
    window.addEventListener('pageshow', (event) => { if (event.persisted) window.location.reload(); });
    return id;
  })();
  return ready;
}

export function windowBoundUrl(input: string): string {
  if (typeof window === 'undefined') return input;
  const id = window.sessionStorage.getItem(STORAGE_KEY);
  if (!id) return input;
  const url = new URL(input, window.location.origin);
  if (url.host === window.location.host && (url.pathname.startsWith('/ws/') || url.pathname.startsWith('/api/media/'))) {
    url.searchParams.set('window_id', id);
    return url.toString();
  }
  return input;
}
