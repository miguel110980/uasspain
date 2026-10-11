import { sanitizeInput, type SanitizeKind } from '@/lib/sanitize';

/** Esquemas de sanitización para payloads al API */

/** @type {Record<string, import('@/lib/sanitize').SanitizeKind>} */
export const PROFILE_SCHEMA = {
  nombre: 'text',
  apellidos: 'text',
  username: 'username',
  dni_nie: 'dni',
  email: 'email',
  foto_perfil: 'text',
} satisfies Record<string, SanitizeKind>;

/** @type {Record<string, import('@/lib/sanitize').SanitizeKind>} */
export const INVITE_SCHEMA = {
  email: 'email',
  nombre: 'text',
  apellidos: 'text',
} satisfies Record<string, SanitizeKind>;

/** @type {Record<string, import('@/lib/sanitize').SanitizeKind>} */
export const INSTRUCTOR_SCHEMA = {
  email: 'email',
  nombre: 'text',
  apellidos: 'text',
  username: 'username',
  dni_nie: 'dni',
  password: 'password',
  fecha_nacimiento: 'text',
} satisfies Record<string, SanitizeKind>;

/** @type {Record<string, import('@/lib/sanitize').SanitizeKind>} */
export const EXAMEN_SCHEMA = {
  nombre: 'text',
  categoria: 'text',
  descripcion: 'message',
} satisfies Record<string, SanitizeKind>;

/** @type {Record<string, import('@/lib/sanitize').SanitizeKind>} */
export const PREGUNTA_SCHEMA = {
  enunciado: 'message',
  opcion_a: 'text',
  opcion_b: 'text',
  opcion_c: 'text',
  opcion_d: 'text',
  respuesta_correcta: 'text',
  imagen_url: 'text',
} satisfies Record<string, SanitizeKind>;

/** @type {Record<string, import('@/lib/sanitize').SanitizeKind>} */
export const ARCHIVO_EXAMEN_SCHEMA = {
  nombre_archivo: 'text',
  descripcion: 'message',
  categoria: 'text',
  archivo_url: 'text',
} satisfies Record<string, SanitizeKind>;

/** @type {Record<string, import('@/lib/sanitize').SanitizeKind>} */
export const MATERIAL_SCHEMA = {
  titulo: 'text',
  descripcion: 'message',
  categoria: 'text',
  tipo: 'text',
  archivo_url: 'text',
  archivo_path: 'text',
  archivo_content_type: 'text',
  video_url: 'text',
  archivo_nombre_original: 'text',
  archivo_sha256: 'text',
} satisfies Record<string, SanitizeKind>;

/** @type {Record<string, import('@/lib/sanitize').SanitizeKind>} */
export const PUBLICACION_BOE_SCHEMA = {
  titulo: 'text',
  resumen: 'message',
  categoria: 'text',
  url: 'text',
} satisfies Record<string, SanitizeKind>;

/** @type {Record<string, import('@/lib/sanitize').SanitizeKind>} */
export const IMPORT_PDF_SCHEMA = {
  file_url: 'text',
  categoria: 'text',
} satisfies Record<string, SanitizeKind>;

/** @type {Record<string, import('@/lib/sanitize').SanitizeKind>} */
export const MENSAJE_SCHEMA = {
  contenido: 'message',
  alumno_nombre: 'text',
  remitente: 'text',
} satisfies Record<string, SanitizeKind>;

/**
 * Sanitiza un objeto usando el esquema; campos no listados se copian sin cambiar.
 * @param {Record<string, unknown>} data
 * @param {Record<string, import('@/lib/sanitize').SanitizeKind>} schema
 */
export function sanitizeRecord(data: Record<string, unknown>, schema: Record<string, SanitizeKind>) {
  if (!data || typeof data !== 'object') return data;
  /** @type {Record<string, unknown>} */
  const out = { ...data };
  Object.entries(schema).forEach(([key, kind]) => {
    if (typeof out[key] === 'string') {
      out[key] = sanitizeInput(out[key], kind);
    }
  });
  return out;
}
