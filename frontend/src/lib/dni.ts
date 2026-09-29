const DNI_LETTERS = 'TRWAGMYFPDXBNJZSQVHLCKE';
const NIE_PREFIX = { X: '0', Y: '1', Z: '2' };

/**
 * @param {string} value
 * @returns {{ ok: boolean, normalized: string, error?: string }}
 */
export function validateDniNie(value) {
  const cleaned = (value || '').trim().toUpperCase().replace(/[\s-]/g, '');
  if (!cleaned) {
    return { ok: false, normalized: '', error: 'El DNI/NIE es obligatorio.' };
  }

  if (/^\d{8}[A-Z]$/.test(cleaned)) {
    const number = parseInt(cleaned.slice(0, 8), 10);
    const letter = cleaned[8];
    const expected = DNI_LETTERS[number % 23];
    if (letter !== expected) {
      return { ok: false, normalized: cleaned, error: `La letra del DNI no es válida (debería ser ${expected}).` };
    }
    return { ok: true, normalized: cleaned };
  }

  if (/^[XYZ]\d{7}[A-Z]$/.test(cleaned)) {
    const number = parseInt(NIE_PREFIX[cleaned[0]] + cleaned.slice(1, 8), 10);
    const letter = cleaned[8];
    const expected = DNI_LETTERS[number % 23];
    if (letter !== expected) {
      return { ok: false, normalized: cleaned, error: 'La letra del NIE no es válida.' };
    }
    return { ok: true, normalized: cleaned };
  }

  return { ok: false, normalized: cleaned, error: 'DNI/NIE no válido (ej: 12345678Z o X1234567L).' };
}

/**
 * DNI válido derivado de fecha DD/MM/YYYY (solo utilidad de referencia).
 * @param {string} isoDate YYYY-MM-DD
 */
export function dniFromBirthDate(isoDate) {
  if (!isoDate) return '';
  const [y, m, d] = isoDate.split('-');
  const digits = `${d}${m}${y}`;
  const number = parseInt(digits, 10);
  return `${digits}${DNI_LETTERS[number % 23]}`;
}
