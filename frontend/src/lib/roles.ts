/**
 * Roles efectivos del perfil (soporta varios roles, p. ej. instructor + admin).
 * @param {{ role?: string, roles?: string[], profile?: { role?: string, roles?: string[] } } | null | undefined} source
 * @returns {string[]}
 */
export function getRoles(source) {
  const profile = source?.profile ?? source;
  if (Array.isArray(profile?.roles) && profile.roles.length > 0) {
    return profile.roles;
  }
  const single = profile?.role ?? source?.role ?? 'alumno';
  return single ? [single] : ['alumno'];
}

/** @param {Parameters<typeof getRoles>[0]} source @param {string} role */
export function hasRole(source, role) {
  return getRoles(source).includes(role);
}

/** @param {Parameters<typeof getRoles>[0]} source */
export function profileHasInstructor(source) {
  return hasRole(source, 'instructor');
}

/** @param {Parameters<typeof getRoles>[0]} source */
export function profileHasAdmin(source) {
  return hasRole(source, 'admin');
}

/** Estados que impiden acceder a los paneles. */
export const BLOCKED_STATUSES = ['pendiente', 'rechazado', 'bloqueado', 'baja'];

/** @param {string | null | undefined} status */
export function isBlockedStatus(status) {
  return Boolean(status && BLOCKED_STATUSES.includes(status));
}

/** Rol principal para badges (admin > instructor > alumno). */
export function primaryRole(source) {
  const roles = getRoles(source);
  if (roles.includes('admin')) return 'admin';
  if (roles.includes('instructor')) return 'instructor';
  return roles[0] || 'alumno';
}

export const ROLE_LABELS = {
  alumno: 'Alumno',
  instructor: 'Instructor',
  admin: 'Administrador',
};

export const ROLE_BADGE_CLASS = {
  alumno: 'text-info bg-info-soft border-info-border',
  instructor: 'text-success bg-success-soft border-success-border',
  admin: 'text-primary bg-primary/15 border-primary/30',
};

/** @param {Parameters<typeof primaryRole>[0]} source */
export function roleDisplayLabel(source) {
  return ROLE_LABELS[primaryRole(source)] || 'Usuario';
}

/** Usuario con acceso a admin e instructor (debe elegir panel al iniciar sesión). */
export function needsPanelChoice(source) {
  return profileHasAdmin(source) && profileHasInstructor(source);
}

/** Ruta del panel tras login según roles efectivos. */
export function panelRouteForUser(source) {
  if (needsPanelChoice(source)) return '/elegir-panel';
  if (hasRole(source, 'admin')) return '/admin';
  if (hasRole(source, 'instructor')) return '/instructor';
  return '/alumno';
}

/**
 * Filtra por rol teniendo en cuenta roles múltiples en perfiles o rol almacenado en eventos.
 * @param {string} storedRol
 * @param {string} filterRol - 'todos' | 'admin' | 'instructor' | 'alumno'
 * @param {string[] | null | undefined} [rolesList]
 */
export function matchesRoleFilter(storedRol, filterRol, rolesList = null) {
  if (!filterRol || filterRol === 'todos') return true;
  if (Array.isArray(rolesList) && rolesList.length > 0) {
    return rolesList.includes(filterRol);
  }
  return (storedRol || 'alumno') === filterRol;
}
