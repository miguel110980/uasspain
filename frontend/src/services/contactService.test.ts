import { beforeEach, describe, expect, it, vi } from 'vitest';
import apiClient from '@/api/apiClient';
import { sendContactMessage } from './contactService';

vi.mock('@/api/apiClient', () => ({ default: { post: vi.fn() } }));
const form = { nombre: 'Visitante', empresa: 'Empresa', email: 'visitor@example.invalid', telefono: '+34 600 000 000', servicio: 'Otro', asunto: 'Consulta', mensaje: 'Primera línea\nSegunda línea', request_id: 'f7c980ca-c6f1-4d14-985b-eb2293e99df1', website: '' };
beforeEach(() => vi.clearAllMocks());

describe('contact delivery states', () => {
  it.each(['FAILED', 'EXPIRED', undefined])('refuses contradictory success flags for %s', async state => {
    vi.mocked(apiClient.post).mockResolvedValue({ data: { state, internally_accepted: true, delivery_accepted: true } });
    await expect(sendContactMessage(form)).rejects.toThrow('No se ha podido enviar');
  });
  it.each(['PENDING', 'RETRY_SCHEDULED', 'UNKNOWN', 'ACCEPTED', 'DELIVERED'])('preserves the actual %s state', async state => {
    const result = { state, internally_accepted: true, delivery_accepted: state === 'ACCEPTED' || state === 'DELIVERED' };
    vi.mocked(apiClient.post).mockResolvedValue({ data: result });
    expect(await sendContactMessage(form)).toEqual(result);
    expect(apiClient.post).toHaveBeenCalledWith('/api/contact/', expect.objectContaining({ email: form.email, mensaje: form.mensaje, request_id: form.request_id }));
  });
  it('keeps a provider rejection as an error and preserves the retry identifier', async () => {
    const error = { response: { status: 503, data: { state: 'FAILED', internally_accepted: false } } };
    vi.mocked(apiClient.post).mockRejectedValue(error);
    await expect(sendContactMessage(form)).rejects.toEqual(error);
    expect(apiClient.post).toHaveBeenCalledWith('/api/contact/', expect.objectContaining({ request_id: form.request_id }));
  });
});
