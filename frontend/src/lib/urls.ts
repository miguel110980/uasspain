/**
 * Serializa parámetros de query con application/x-www-form-urlencoded (URLSearchParams).
 * @param {Record<string, unknown>} params
 */
export function encodeQueryParams(params = {}) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      search.set(key, String(value));
    }
  });
  return search.toString();
}

/**
 * Construye una URL con query params codificados.
 * @param {string} path
 * @param {Record<string, unknown>} [params]
 */
export function buildUrl(path, params = {}) {
  const query = encodeQueryParams(params);
  return query ? `${path}?${query}` : path;
}

/**
 * Añade o sustituye parámetros en una URL existente.
 * @param {string} url
 * @param {Record<string, unknown>} params
 */
export function appendQueryParams(url, params = {}) {
  const base = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
  const parsed = new URL(url, base);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      parsed.searchParams.set(key, String(value));
    }
  });
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

/** Serializador axios compatible con DRF. */
export function urlEncodedParamsSerializer(params) {
  return encodeQueryParams(params);
}

const JWT_FORMAT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

/** Codifica token JWT para cookie, query o form body. */
export function encodeTokenForTransport(token) {
  if (!token || typeof token !== 'string') return '';
  return encodeURIComponent(token.trim());
}

/** Decodifica token recibido por URL, cookie o form. */
export function decodeTokenFromTransport(value) {
  if (!value || typeof value !== 'string') return '';
  try {
    return decodeURIComponent(value.trim());
  } catch {
    return value.trim();
  }
}

/** Valida formato JWT compacto (header.payload.signature). */
export function isValidJwtFormat(token) {
  return Boolean(token && JWT_FORMAT.test(token));
}

/** Serializa body urlencoded (p. ej. refresh token en POST). */
export function encodeFormBody(params = {}) {
  return encodeQueryParams(params);
}
