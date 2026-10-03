import { windowBoundUrl } from '@/lib/windowSession';
export type SanitizeKind = 'text'|'email'|'phone'|'message'|'username'|'dni'|'otp'|'password';

const CONTROL_CHARS = /[\u0000-\u001F\u007F]/g;
const DANGEROUS = /[<>{}]/g;

const MAX_LENGTH = {
  text: 120,
  email: 254,
  phone: 20,
  message: 2000,
  username: 150,
  dni: 20,
  otp: 6,
  password: 128,
};

/**
 * Sanitiza entrada de usuario (OWASP XSS — capa cliente).
 * @param {string} value
 * @param {SanitizeKind} [kind='text']
 */
export function sanitizeInput(value: unknown, kind: SanitizeKind = 'text') {
  if (value == null) return '';
  // Passwords are opaque credentials; never normalize or remove characters.
  if (kind === 'password') return String(value).slice(0, MAX_LENGTH.password);
  let out = String(value).replace(CONTROL_CHARS, '').replace(DANGEROUS, '');

  switch (kind) {
    case 'email':
      out = out.trim().toLowerCase().replace(/[^\w.@+-]/g, '');
      break;
    case 'phone':
      out = out.replace(/[^0-9+\s\-().]/g, '');
      break;
    case 'message':
      out = out.trimStart();
      break;
    case 'username':
      out = out.trim().replace(/[^\w.@+-]/g, '');
      break;
    case 'dni':
      out = out.trim().toUpperCase().replace(/[^0-9A-Z-]/g, '');
      break;
    case 'otp':
      out = out.replace(/\D/g, '');
      break;
    default:
      out = out.trimStart();
  }

  const max = MAX_LENGTH[kind] ?? MAX_LENGTH.text;
  return out.slice(0, max);
}

/** @deprecated Usa sanitizeInput(value, 'text') */
export const sanitizeText = (value) => sanitizeInput(value, 'text');

/** @deprecated Usa sanitizeInput(value, 'phone') */
export const sanitizePhone = (value) => sanitizeInput(value, 'phone');

/**
 * Escapa HTML para inserción segura en plantillas/strings.
 * @param {unknown} value
 */
export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Valida URL antes de usar en href/src (bloquea javascript:, data:, etc.).
 * @param {string} url
 */
export function getSafeUrl(url) {
  if (!url || typeof url !== 'string') return '#';
  const trimmed = url.trim();
  if (!trimmed) return '#';
  try {
    const parsed = new URL(trimmed, window.location.origin);
    const allowed = ['http:', 'https:', 'mailto:'];
    if (!allowed.includes(parsed.protocol)) return '#';
    return windowBoundUrl(trimmed);
  } catch {
    return '#';
  }
}

/**
 * Sanitiza objeto plano antes de enviar al API.
 * @param {Record<string, unknown>} data
 * @param {Record<string, SanitizeKind>} schema
 */
export function sanitizePayload<T extends Record<string, unknown>>(data: T, schema: Record<string, SanitizeKind>): T {
  /** @type {Record<string, unknown>} */
  const out: Record<string, unknown> = { ...data };
  Object.entries(schema).forEach(([key, kind]) => {
    if (typeof out[key] === 'string') {
      out[key] = sanitizeInput(out[key], kind);
    }
  });
  return out as T;
}

/**
 * Valida extensión de archivo en cliente.
 * @param {File} file
 * @param {string[]} allowedExt
 * @param {number} [maxBytes=10*1024*1024]
 */
export function validateUploadFile(file, allowedExt, maxBytes = 10 * 1024 * 1024) {
  if (!file || !(file instanceof File)) {
    return { ok: false, error: 'Archivo no válido.' };
  }
  if (file.size > maxBytes) {
    return { ok: false, error: 'El archivo supera el tamaño máximo permitido (10 MB).' };
  }
  const ext = `.${file.name.split('.').pop()?.toLowerCase() ?? ''}`;
  if (!allowedExt.includes(ext)) {
    return { ok: false, error: `Tipo de archivo no permitido. Permitidos: ${allowedExt.join(', ')}` };
  }
  return { ok: true };
}

export const UPLOAD_IMAGE_EXT = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
export const UPLOAD_DOC_EXT = ['.pdf', '.jpg', '.jpeg', '.png', '.webp'];
