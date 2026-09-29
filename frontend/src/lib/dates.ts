/** @param {string | number | Date | null | undefined} value */
export function toTimestamp(value) {
  if (value == null || value === '') return 0;
  const ts = new Date(value).getTime();
  return Number.isNaN(ts) ? 0 : ts;
}

/** @param {string | number | Date | null | undefined} a @param {string | number | Date | null | undefined} b */
export function compareDatesDesc(a, b) {
  return toTimestamp(b) - toTimestamp(a);
}

/** @param {string | number | Date | null | undefined} a @param {string | number | Date | null | undefined} b */
export function compareDatesAsc(a, b) {
  return toTimestamp(a) - toTimestamp(b);
}

/** @param {string | number | Date | null | undefined} value */
export function isValidDate(value) {
  return toTimestamp(value) > 0;
}

/** @param {string | number | Date | null | undefined} value @param {Intl.DateTimeFormatOptions} [options] */
export function formatDate(value: string | number | Date | null | undefined, options: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short', year: 'numeric' }) {
  if (!isValidDate(value)) return '—';
  return new Date(value).toLocaleDateString('es-ES', options);
}

/** @param {string | number | Date | null | undefined} value */
export function formatDateLong(value) {
  return formatDate(value, { day: '2-digit', month: 'long', year: 'numeric' });
}
