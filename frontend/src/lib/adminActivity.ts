// Construye un feed cronológico unificado de actividad a partir de las entidades del sistema.
// Reutilizado por el Dashboard, el módulo de Actividad y el de Auditoría.

import { primaryRole } from '@/lib/roles';

/** @typedef {'login' | 'user' | 'material' | 'examen' | 'resultado'} ActivityTipo */

/**
 * @typedef {Object} ActivityEvent
 * @property {string} id
 * @property {ActivityTipo} tipo
 * @property {string} accion
 * @property {string} usuario
 * @property {string} rol
 * @property {string} ip
 * @property {string} [ciudad]
 * @property {string} [pais]
 * @property {string} fecha
 * @property {boolean} [ok]
 * @property {boolean} [sesionActiva]
 * @property {string} [detalle]
 */

/**
 * @typedef {Object} ActivityFeedData
 * @property {object[]} [profiles]
 * @property {object[]} [resultados]
 * @property {object[]} [examenes]
 * @property {object[]} [material]
 * @property {object[]} [registroConexion]
 */

/**
 * @param {ActivityFeedData | null | undefined} data
 * @returns {ActivityEvent[]}
 */
export function buildActivityFeed(data) {
  const {
    profiles = [],
    resultados = [],
    examenes = [],
    material = [],
    registroConexion = [],
  } = data || {};

  const events = [];

  registroConexion.forEach((r) => {
    const ok = r.estado_acceso === 'correcto';
    const sesionActiva = ok && r.estado_sesion === 'activa';
    events.push({
      id: `rc-${r.id}`,
      tipo: 'login',
      accion: sesionActiva
        ? 'Sesión activa'
        : ok
        ? r.estado_sesion === 'finalizada'
          ? 'Sesión finalizada'
          : 'Inicio de sesión'
        : r.estado_acceso === 'fallido'
        ? 'Intento de acceso fallido'
        : `Acceso ${r.estado_acceso || ''}`.trim(),
      usuario: r.nombre_completo || r.usuario || '—',
      rol: r.rol || 'alumno',
      ip: r.direccion_ip || '—',
      ciudad: r.ciudad || '—',
      pais: r.pais || '—',
      fecha: r.fecha_hora || r.created_date,
      ok,
      sesionActiva,
    });
  });

  profiles.forEach((p) => {
    const roles = Array.isArray(p.roles) && p.roles.length > 0 ? p.roles : [p.role || 'alumno'];
    const roleLabels = roles.map((r) => {
      if (r === 'admin') return 'Administrador';
      if (r === 'instructor') return 'Instructor';
      return 'Alumno';
    });
    const accion = roleLabels.length > 1
      ? `Nuevo ${roleLabels.join('/')} creado`
      : `Nuevo ${roleLabels[0].toLowerCase()} creado`;
    events.push({
      id: `up-${p.id}`,
      tipo: 'user',
      accion,
      usuario: `${p.nombre || ''} ${p.apellidos || ''}`.trim() || p.email || '—',
      rol: primaryRole(p),
      ip: '—',
      fecha: p.created_date,
      ok: true,
    });
  });

  material.forEach((m) => {
    events.push({
      id: `mat-${m.id}`,
      tipo: 'material',
      accion: 'Material formativo subido',
      usuario: '—',
      rol: 'instructor',
      detalle: m.titulo,
      ip: '—',
      fecha: m.created_date,
      ok: true,
    });
  });

  examenes.forEach((e) => {
    events.push({
      id: `ex-${e.id}`,
      tipo: 'examen',
      accion: 'Examen publicado / importado',
      usuario: '—',
      rol: 'admin',
      detalle: e.nombre,
      ip: '—',
      fecha: e.created_date,
      ok: true,
    });
  });

  resultados.forEach((r) => {
    const detalleParts = [r.examen_nombre].filter(Boolean);
    if (r.nota != null && r.nota !== '') detalleParts.push(`${r.nota}/10`);
    events.push({
      id: `res-${r.id}`,
      tipo: 'resultado',
      accion: r.aprobado ? 'Examen aprobado' : 'Examen realizado',
      usuario: r.alumno_nombre || '—',
      rol: 'alumno',
      detalle: detalleParts.join(' · ') || undefined,
      ip: '—',
      fecha: r.fecha || r.created_date,
      ok: r.aprobado,
    });
  });

  return events
    .filter((e) => e.fecha)
    .sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime());
}

export const EVENT_ICON = {
  login: 'LogIn',
  user: 'UserPlus',
  material: 'BookOpen',
  examen: 'ClipboardList',
  resultado: 'Award',
};

export const ROL_BADGE = {
  admin: 'border-primary/30 bg-primary/10 text-primary',
  instructor: 'border-info-border bg-info-soft text-info',
  alumno: 'border-border-subtle bg-surface-subtle text-copy-muted',
};

export const TIPO_LABEL = {
  login: 'Sesión',
  user: 'Usuario',
  material: 'Material',
  examen: 'Examen',
  resultado: 'Resultado',
};

export const TIPO_STYLE = {
  login: 'border-success-border bg-success-soft text-success',
  user: 'border-primary/20 bg-primary/10 text-primary',
  material: 'border-info-border bg-info-soft text-info',
  examen: 'border-warning-border bg-warning-soft text-warning',
  resultado: 'border-success-border bg-success-soft text-success',
};

/** @typedef {'todos' | ActivityTipo} ActivityFiltroTipo */

/** @type {ActivityFiltroTipo[]} */
export const ACTIVITY_TIPO_FILTERS = ['todos', .../** @type {(keyof typeof TIPO_LABEL)[]} */ (Object.keys(TIPO_LABEL))];

/**
 * @param {string} iso
 * @returns {{ date: string, time: string }}
 */
export function formatActivityDateTime(iso) {
  if (!iso) return { date: '—', time: '—' };
  const d = new Date(iso);
  if (isNaN(d.getTime())) return { date: String(iso).slice(0, 10), time: '' };
  return {
    date: d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' }),
    time: d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }),
  };
}

/**
 * @param {ActivityEvent} event
 * @param {ActivityFiltroTipo} filtroTipo
 */
export function matchesActivityFilter(event, filtroTipo) {
  if (filtroTipo === 'todos') return true;
  if (filtroTipo === 'login') {
    return event.tipo === 'login' && event.sesionActiva === true;
  }
  return event.tipo === filtroTipo;
}

/**
 * @param {ActivityFiltroTipo | string} key
 */
export function labelForActivityFilter(key) {
  if (key === 'todos') return 'Todos';
  if (key in TIPO_LABEL) return TIPO_LABEL[/** @type {keyof typeof TIPO_LABEL} */ (key)];
  return key;
}

/**
 * @param {string} rol
 */
export function rolBadgeClass(rol) {
  if (rol in ROL_BADGE) return ROL_BADGE[/** @type {keyof typeof ROL_BADGE} */ (rol)];
  return '';
}

/**
 * @param {ActivityTipo} tipo
 */
export function activityTipoStyle(tipo) {
  return TIPO_STYLE[tipo] ?? 'border-border-subtle bg-surface-muted text-muted-foreground';
}

/**
 * @param {ActivityTipo} tipo
 */
export function activityTipoLabel(tipo) {
  return TIPO_LABEL[tipo];
}

/**
 * @param {string | null | undefined} iso
 */
export function formatActivityTimestamp(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/**
 * @param {Record<string, string>} map
 * @param {string | null | undefined} key
 */
export function badgeClassFromMap(map, key) {
  if (key != null && key in map) {
    return map[/** @type {keyof typeof map} */ (key)];
  }
  return '';
}
