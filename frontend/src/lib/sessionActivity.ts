import apiClient from '@/api/apiClient';

type ActivityStatus = { idle_expires_at: string; remaining_ms: number };

/** Polls and transport traffic cannot call recordActivity; only trusted input can. */
export function isSessionActivity(event: Event): boolean {
  if (!event.isTrusted) return false;
  if (event.type === 'pointermove') return (event as PointerEvent).buttons > 0;
  return ['pointerdown', 'keydown', 'input', 'submit', 'wheel', 'touchstart', 'touchmove'].includes(event.type);
}

let subscribers = 0;
let stop: (() => void) | undefined;
export function watchSessionActivity(): () => void {
  if (++subscribers === 1) stop = startWatcher();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--subscribers === 0) { stop?.(); stop = undefined; }
  };
}

function startWatcher(): () => void {
  let disposed = false;
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  let trailingTimer: ReturnType<typeof setTimeout> | undefined;
  let lastSent = -Infinity;
  let pending = false;
  let sending = false;
  let retries = 0;
  const schedule = (status: ActivityStatus) => {
    if (disposed) return;
    clearTimeout(deadlineTimer);
    deadlineTimer = setTimeout(() => { void check(); }, Math.max(1, status.remaining_ms));
  };
  const check = async () => {
    try { schedule((await apiClient.get<ActivityStatus>('/api/auth/activity/')).data); }
    catch { /* Authentication errors redirect this tab through the API interceptor. */ }
  };
  const send = async () => {
    if (disposed || !pending || sending) return;
    clearTimeout(trailingTimer); trailingTimer = undefined;
    pending = false; sending = true; lastSent = performance.now();
    try { schedule((await apiClient.post<ActivityStatus>('/api/auth/activity/')).data); }
    catch (error) {
      // One bounded retry delivers a recent input that raced the server rate limit.
      if (error?.response?.status === 429 && retries++ === 0) pending = true;
    }
    finally {
      sending = false;
      if (pending && !disposed) {
        clearTimeout(trailingTimer);
        trailingTimer = setTimeout(() => { trailingTimer = undefined; void send(); }, 550);
      }
    }
  };
  const record = (event: Event) => {
    if (!isSessionActivity(event)) return;
    retries = 0;
    pending = true;
    if (performance.now() - lastSent >= 550) void send();
    else if (!trailingTimer) trailingTimer = setTimeout(() => {
      trailingTimer = undefined; void send();
    }, 550 - (performance.now() - lastSent));
  };
  const wake = () => { if (document.visibilityState === 'visible') void check(); };
  const events = ['pointerdown', 'pointermove', 'keydown', 'input', 'submit', 'wheel', 'touchstart', 'touchmove'];
  for (const name of events) window.addEventListener(name, record, { passive: true, capture: true });
  document.addEventListener('visibilitychange', wake);
  window.addEventListener('online', wake);
  window.addEventListener('pageshow', wake);
  void check();
  return () => {
    disposed = true; clearTimeout(deadlineTimer); clearTimeout(trailingTimer);
    for (const name of events) window.removeEventListener(name, record, true);
    document.removeEventListener('visibilitychange', wake);
    window.removeEventListener('online', wake);
    window.removeEventListener('pageshow', wake);
  };
}
