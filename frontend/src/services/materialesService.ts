import apiClient from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';
import { buildListParams, unwrapItem, unwrapList } from '@/api/queryParams';
import {
  MATERIAL_SCHEMA,
  PUBLICACION_BOE_SCHEMA,
  sanitizeRecord,
} from '@/lib/sanitizeSchemas';
import { normalizeUploadResponse } from '@/lib/mediaUrl';
import type { SanitizeKind } from '@/lib/sanitize';

function crud(baseUrl: string, schema?: Record<string, SanitizeKind>) {
  return {
    async list(sort?: string, limit?: number, filters: Record<string, unknown> = {}) {
      const res = await apiClient.get(baseUrl, {
        params: buildListParams(sort, limit, filters),
      });
      return unwrapList(res);
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

    async update(id: string, data: Record<string, unknown>) {
      const body = schema ? sanitizeRecord(data, schema) : data;
      const res = await apiClient.patch(`${baseUrl}${id}/`, body);
      return unwrapItem(res);
    },

    async delete(id: string) {
      await apiClient.delete(`${baseUrl}${id}/`);
      return { id };
    },

    async deleteMany(query: Record<string, unknown>) {
      const res = await apiClient.post(`${baseUrl}delete-many/`, query);
      return res.data;
    },
  };
}

export const materialesService = {
  materiales: crud(endpoints.materiales, MATERIAL_SCHEMA),
  completados: crud(endpoints.materialesCompletados),
  publicacionesBoe: crud(endpoints.publicacionesBoe, PUBLICACION_BOE_SCHEMA),
  permisos: crud(endpoints.permisosAccesoMaterial),

  async uploadArchivo(file) {
    const formData = new FormData();
    formData.append('file', file);
    const res = await apiClient.post(endpoints.uploads, formData, {
      timeout: 120000,
    });
    return normalizeUploadResponse(res.data);
  },
};

export default materialesService;
