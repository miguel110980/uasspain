const STORAGE_KEY = 'uasspain.rememberLogin.v3';
const LEGACY_KEY = 'uasspain.rememberLogin.v2';

function canUseStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

/** @returns {{ email: string, remember: boolean } | null} */
export function loadRememberedLogin() {
  if (!canUseStorage()) return null;
  try {
    localStorage.removeItem(LEGACY_KEY);
    localStorage.removeItem('uasspain.rememberLogin.v1');
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object' || !data.remember) return null;
    return {
      email: typeof data.email === 'string' ? data.email : '',
      remember: true,
    };
  } catch {
    return null;
  }
}

/** @param {{ email: string, remember: boolean }} payload */
export function saveRememberedLogin({ email, remember }) {
  if (!canUseStorage()) return;
  if (!remember) {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(LEGACY_KEY);
    localStorage.removeItem('uasspain.rememberLogin.v1');
    return;
  }
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      email: email || '',
      remember: true,
    }),
  );
}

export function clearRememberedLogin() {
  if (!canUseStorage()) return;
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(LEGACY_KEY);
  localStorage.removeItem('uasspain.rememberLogin.v1');
}
