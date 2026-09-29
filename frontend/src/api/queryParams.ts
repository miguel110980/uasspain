/**
 * Convierte parámetros de listado a query params de DRF.
 * sort: '-created_date' | 'nombre'
 * limit: número máximo de resultados
 * filters: { alumno_id: '...', status: 'activo' }
 */
export function buildListParams(sort?: string, limit?: number, filters: Record<string, unknown> = {}) {
  const params: Record<string, unknown> = {};

  if (sort) {
    params.ordering = sort;
  }
  if (limit != null) {
    params.limit = limit;
  }

  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      params[key] = value;
    }
  });

  return params;
}

export function unwrapList(response: { data: any }) {
  if (Array.isArray(response.data)) return response.data;
  if (Array.isArray(response.data?.results)) return response.data.results;
  return response.data;
}

export function unwrapItem(response: { data: any }) {
  return response.data;
}
