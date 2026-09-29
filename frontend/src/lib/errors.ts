// Utilidad para extraer mensajes de error legibles desde respuestas axios / errores nativos.
// Evita mostrar "[object Object]" cuando el backend devuelve mensajes de validación estructurados.

function stringify(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return value.map(stringify).filter(Boolean).join('; ');
  if (value instanceof Error) return value.message || String(value);
  if (typeof value === 'object') {
    const values = Object.values(value).flat();
    const joined = values.map(stringify).filter(Boolean).join('; ');
    return joined || JSON.stringify(value);
  }
  return String(value);
}

export function extractErrorMessage(err, fallback = 'Ha ocurrido un error inesperado. Inténtelo nuevamente.') {
  if (!err) return fallback;

  const isNetworkFailure = !err.response && (
    err.code === 'ERR_NETWORK'
    || /network error/i.test(String(err.message || ''))
  );
  if (isNetworkFailure) {
    return 'No se pudo conectar con el servidor. Comprueba que la web y el backend están activos (nginx + uasspain-backend).';
  }

  const data = err.data || err.response?.data;
  const fieldErrors = data && typeof data === 'object' && !Array.isArray(data)
    ? Object.entries(data)
      .filter(([key]) => !['detail', 'message', 'error', 'non_field_errors'].includes(key))
      .flatMap(([, value]) => (Array.isArray(value) ? value : [value]))
      .map(stringify)
      .filter(Boolean)
      .join('; ')
    : '';

  return (
    stringify(data?.detail) ||
    stringify(data?.non_field_errors) ||
    fieldErrors ||
    stringify(data?.message) ||
    stringify(data?.error) ||
    stringify(err.response?.data?.detail) ||
    stringify(err.response?.data?.message) ||
    (err.response?.status
      ? fallback
      : stringify(err.message)) ||
    fallback
  );
}