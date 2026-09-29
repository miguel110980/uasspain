/**
 * Resuelve URLs de media relativas (/media/...) a URL absoluta para img/src.
 */
export function resolveMediaUrl(input) {
  const raw = typeof input === 'string'
    ? input
    : (input?.absolute_url || input?.file_url || '');
  if (!raw) return '';
  if (raw.startsWith('http') || raw.startsWith('blob:') || raw.startsWith('data:')) return raw;
  const path = raw.startsWith('/') ? raw : `/${raw}`;
  if (typeof window !== 'undefined') {
    return `${window.location.origin}${path}`;
  }
  return path;
}

export function normalizeUploadResponse(data) {
  const file_url = data?.file_url || '';
  return {
    ...data,
    file_url,
    absolute_url: resolveMediaUrl(data),
    display_url: resolveMediaUrl(data),
    path: data?.path || data?.storage_path || '',
    original_name: data?.original_name || data?.filename || '',
    content_type: data?.content_type || '',
    size: typeof data?.size === 'number' ? data.size : undefined,
    sha256: data?.sha256 || '',
  };
}
