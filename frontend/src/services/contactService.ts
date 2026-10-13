import apiClient from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';
import { sanitizePayload, type SanitizeKind } from '@/lib/sanitize';

/** @type {Record<string, import('@/lib/sanitize').SanitizeKind>} */
const CONTACT_SCHEMA = {
  nombre: 'text',
  empresa: 'text',
  email: 'email',
  telefono: 'phone',
  servicio: 'text',
  asunto: 'text',
  mensaje: 'message',
} satisfies Record<string, SanitizeKind>;

export async function sendContactMessage(form) {
  const payload = sanitizePayload(form, CONTACT_SCHEMA);
  payload.email = form.email.trim();
  payload.mensaje = form.mensaje;
  payload.request_id = form.request_id || crypto.randomUUID();
  const res = await apiClient.post(endpoints.contact, payload);
  if (res.data?.internally_accepted !== true && res.data?.delivery_accepted !== true) {
    throw new Error('No se ha podido enviar la consulta. Inténtalo de nuevo más tarde.');
  }
  return res.data;
}

export default { sendContactMessage };
