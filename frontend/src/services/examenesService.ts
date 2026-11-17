import apiClient from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';
import { buildListParams, unwrapItem, unwrapList } from '@/api/queryParams';
import { sanitizePayload, type SanitizeKind } from '@/lib/sanitize';
import {
  ARCHIVO_EXAMEN_SCHEMA,
  EXAMEN_SCHEMA,
  IMPORT_PDF_SCHEMA,
  PREGUNTA_SCHEMA,
  sanitizeRecord,
} from '@/lib/sanitizeSchemas';
import { normalizeUploadResponse } from '@/lib/mediaUrl';

function crud(baseUrl: string, schema?: Record<string, SanitizeKind>) {
  return {
    async list(sort?: string, limit?: number, filters: Record<string, unknown> = {}) {
      const res = await apiClient.get(baseUrl, {
        params: buildListParams(sort, limit, filters),
      });
      return unwrapList(res);
    },

    async listAll(filters: Record<string, unknown> = {}) {
      const rows: Record<string, any>[] = [];
      const seen = new Set<string>();
      for (let offset = 0; offset < 5000000; offset += 500) {
        const response = await apiClient.get(baseUrl, { params: buildListParams('-fecha', 500, { ...filters, offset }) });
        const page = unwrapList(response);
        for (const row of page) {
          if (!row.id || seen.has(String(row.id))) throw new Error('No se pudo recorrer el historial de forma estable. Actualiza para reintentar.');
          seen.add(String(row.id)); rows.push(row);
        }
        if (page.length < 500) return rows;
      }
      throw new Error('El historial supera el límite de consulta. Contacta con administración.');
    },

    async filter(query: Record<string, unknown>, sort?: string, limit?: number) {
      return crud(baseUrl, schema).list(sort, limit, query);
    },

    async get(id: string) {
      const res = await apiClient.get(`${baseUrl}${id}/`);
      return unwrapItem(res);
    },

    async create(data: Record<string, unknown>) {
      const body = schema ? sanitizeRecord(data, schema) : data;
      const res = await apiClient.post(baseUrl, body);
      return unwrapItem(res);
    },

    async bulkCreate(items: Record<string, unknown>[]) {
      const body = schema
        ? { items: items.map((item) => sanitizeRecord(item, schema)) }
        : { items };
      const res = await apiClient.post(`${baseUrl}bulk/`, body);
      return unwrapList(res);
    },

    async update(id: string, data: Record<string, unknown>) {
      const body = schema ? sanitizeRecord(data, schema) : data;
      const res = await apiClient.patch(`${baseUrl}${id}/`, body);
      return unwrapItem(res);
    },

    async bulkUpdate(items: Record<string, unknown>[]) {
      const body = schema
        ? { items: items.map((item) => sanitizeRecord(item, schema)) }
        : { items };
      const res = await apiClient.patch(`${baseUrl}bulk/`, body);
      return unwrapList(res);
    },

    async delete(id: string) {
      await apiClient.delete(`${baseUrl}${id}/`);
      return { id };
    },

    async deleteMany(query: Record<string, unknown>) {
      const res = await apiClient.post(`${baseUrl}delete-many/`, { query });
      return res.data;
    },
  };
}

export const examenesService = {
  examenes: crud(endpoints.examenes, EXAMEN_SCHEMA),
  preguntas: crud(endpoints.preguntas, PREGUNTA_SCHEMA),
  archivos: crud(endpoints.archivosExamen, ARCHIVO_EXAMEN_SCHEMA),
  resultados: crud(endpoints.resultadosExamen),
  resultadosPractico: crud(endpoints.resultadosPractico),
  bloqueos: crud(endpoints.bloqueosExamen),

  async iniciarIntento(examenId: string, modalidad: string) {
    const res = await apiClient.post(`${endpoints.examenes}${examenId}/intentos/`, { modalidad });
    return res.data;
  },

  async guardarRespuestas(attemptId: string, respuestas: Record<string, string>, expectedRevision: number) {
    const response = await apiClient.put(`/api/intentos-examen/${attemptId}/`, { respuestas, expected_revision: expectedRevision });
    return response.data;
  },

  async uploadArchivo(file: File, options: { signal?: AbortSignal } = {}) {
    const formData = new FormData();
    formData.append('file', file);
    const res = await apiClient.post(endpoints.uploads, formData, {
      timeout: 120000,
      signal: options.signal,
    });
    return normalizeUploadResponse(res.data);
  },

  async uploadAvatar(file) {
    const formData = new FormData();
    formData.append('file', file);
    const res = await apiClient.post(endpoints.uploadsAvatar, formData, {
      timeout: 60000,
    });
    return normalizeUploadResponse(res.data);
  },

  async importarExamenPDF({ fileUrl, categoria, metadata = null, signal = null, confirm = false, previewToken = '' }) {
    const payload: Record<string, unknown> = sanitizePayload({ file_url: fileUrl, categoria }, IMPORT_PDF_SCHEMA);
    payload.confirm = confirm; payload.preview_token = previewToken;
    if (metadata && typeof metadata === 'object') {
      payload.metadata = metadata;
    }
    const res = await apiClient.post(
      endpoints.functions.importarExamenPdf,
      payload,
      signal ? { signal } : undefined,
    );
    return { data: res.data };
  },
};

export default examenesService;
