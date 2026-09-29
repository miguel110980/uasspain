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
  mensaje: 'message',
} satisfies Record<string, SanitizeKind>;

export async function sendContactMessage(form) {
  const payload = sanitizePayload(form, CONTACT_SCHEMA);
  const res = await apiClient.post(endpoints.contact, payload);
  return res.data;
}

export default { sendContactMessage };
