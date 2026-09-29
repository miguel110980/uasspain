const MIN_LENGTH = 8;

/**
 * @param {string} password
 * @param {{ username?: string, email?: string, dni?: string }} [ctx]
 */
type PasswordContext = { username?: string; email?: string; dni?: string };

export function assessPasswordStrength(password: string, ctx: PasswordContext = {}) {
  const pwd = password || '';
  const hints = [];
  let score = 0;

  if (pwd.length >= MIN_LENGTH) score += 1;
  else hints.push(`Mínimo ${MIN_LENGTH} caracteres.`);
  if (pwd.length >= 12) score += 1;
  if (/[a-z]/.test(pwd)) score += 1;
  else hints.push('Incluye minúsculas.');
  if (/[A-Z]/.test(pwd)) score += 1;
  else hints.push('Incluye mayúsculas.');
  if (/\d/.test(pwd)) score += 1;
  else hints.push('Incluye números.');
  if (/[^A-Za-z0-9]/.test(pwd)) score += 1;
  else hints.push('Incluye un carácter especial.');

  let level = 'weak';
  let label = 'Débil';
  if (score >= 5) {
    level = 'strong';
    label = 'Fuerte';
  } else if (score >= 3) {
    level = 'medium';
    label = 'Media';
  }

  const normalized = pwd.trim().toLowerCase();
  const username = (ctx.username || '').trim().toLowerCase();
  const email = (ctx.email || '').trim().toLowerCase();
  const dni = (ctx.dni || '').trim().toLowerCase();
  const emailLocal = email.split('@')[0] || '';

  if (username && normalized === username) hints.push('No puede coincidir con el usuario.');
  if (email && normalized === email) hints.push('No puede coincidir con el email.');
  if (emailLocal && normalized === emailLocal) hints.push('No puede coincidir con la parte local del email.');
  if (dni && normalized === dni) hints.push('No puede coincidir con el DNI/NIE.');

  return { level, label, score, hints, isWeak: level === 'weak' || hints.some((h) => h.startsWith('No puede')) };
}

/**
 * @param {string} password
 * @param {{ username?: string, email?: string, dni?: string }} [ctx]
 * @returns {string}
 */
export function validatePasswordPolicy(password: string, ctx: PasswordContext = {}) {
  const result = assessPasswordStrength(password, ctx);
  if (result.isWeak) {
    return result.hints[0] || 'Contraseña demasiado débil.';
  }
  return '';
}
