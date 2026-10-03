/**
 * Contrato estable consumido por el frontend, independiente del runtime backend.
 */
const API_PREFIX = '/api';

/**
 * URL base de WebSocket. En el navegador usa siempre el mismo origen (ws/wss según la página)
 * para que HTTPS en producción use wss:// automáticamente vía nginx.
 * VITE_WS_URL solo aplica fuera del navegador (p. ej. tests).
 */
function wsBaseUrl() {
  if (typeof window !== 'undefined') {
    const configured = import.meta.env.VITE_WS_URL?.replace(/\/$/, '');
    if (configured) {
      try {
        const cfgHost = new URL(configured.replace(/^ws/i, 'http')).hostname;
        const pageHost = window.location.hostname;
        const devOnlyHost = cfgHost === 'localhost' || cfgHost === '127.0.0.1';
        if (!devOnlyHost || cfgHost === pageHost) {
          if (window.location.protocol === 'https:' && configured.startsWith('ws://')) {
            return configured.replace(/^ws:/, 'wss:');
          }
          return configured;
        }
      } catch {
        // ignorar URL mal formada
      }
    }
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/ws`;
  }
  if (import.meta.env.VITE_WS_URL) {
    return import.meta.env.VITE_WS_URL.replace(/\/$/, '');
  }
  return 'ws://localhost:5173/ws';
}

const WS_BASE = wsBaseUrl();

export const endpoints = {
  auth: {
    login: `${API_PREFIX}/auth/login/`,
    refresh: `${API_PREFIX}/auth/refresh/`,
    logout: `${API_PREFIX}/auth/logout/`,
    me: `${API_PREFIX}/auth/me/`,
    register: `${API_PREFIX}/auth/register/`,
    verifyOtp: `${API_PREFIX}/auth/verify-otp/`,
    resendOtp: `${API_PREFIX}/auth/resend-otp/`,
    resetPasswordRequest: `${API_PREFIX}/auth/password-reset/`,
    resetPassword: `${API_PREFIX}/auth/password-reset/confirm/`,
    changePassword: `${API_PREFIX}/auth/change-password/`,
    sessionRole: `${API_PREFIX}/auth/session-role/`,
  },

  profiles: `${API_PREFIX}/profiles/`,
  users: `${API_PREFIX}/users/`,

  examenes: `${API_PREFIX}/examenes/`,
  preguntas: `${API_PREFIX}/preguntas/`,
  archivosExamen: `${API_PREFIX}/archivos-examen/`,
  resultadosExamen: `${API_PREFIX}/resultados-examen/`,
  resultadosPractico: `${API_PREFIX}/resultados-practico/`,
  bloqueosExamen: `${API_PREFIX}/bloqueos-examen/`,

  materiales: `${API_PREFIX}/materiales/`,
  materialesCompletados: `${API_PREFIX}/materiales-completados/`,
  publicacionesBoe: `${API_PREFIX}/publicaciones-boe/`,
  permisosAccesoMaterial: `${API_PREFIX}/permisos-acceso-material/`,

  conexiones: `${API_PREFIX}/conexiones/`,
  registrosConexion: `${API_PREFIX}/registros-conexion/`,
  mensajes: `${API_PREFIX}/mensajes/`,
  mensajesStaff: `${API_PREFIX}/mensajes-staff/`,
  videollamadas: `${API_PREFIX}/videollamadas/`,

  uploads: `${API_PREFIX}/uploads/`,
  uploadsAvatar: `${API_PREFIX}/uploads/avatar/`,
  uploadsRegisterAvatar: `${API_PREFIX}/uploads/register-avatar/`,
  systemStatus: `${API_PREFIX}/system/status/`,
  vpn: {
    status: `${API_PREFIX}/vpn/status/`,
  },
  backups: {
    status: `${API_PREFIX}/backups/status/`,
    history: `${API_PREFIX}/backups/history/`,
    detail: (id) => `${API_PREFIX}/backups/${id}/`,
    create: `${API_PREFIX}/backups/create/`,
    verify: `${API_PREFIX}/backups/verify/`,
    restore: `${API_PREFIX}/backups/restore/`,
    restoreStatus: `${API_PREFIX}/backups/restore-status/`,
    restoreTest: `${API_PREFIX}/backups/restore-test/`,
    retention: `${API_PREFIX}/backups/retention/`,
    config: `${API_PREFIX}/backups/config/`,
    servers: `${API_PREFIX}/backups/servers/`,
    serverDetail: (id) => `${API_PREFIX}/backups/servers/${id}/`,
    origins: `${API_PREFIX}/backups/origins/`,
    testConnection: `${API_PREFIX}/backups/test-connection/`,
  },
  systemAuthPolicy: `${API_PREFIX}/system/auth-policy/`,
  public: {
    publicaciones: `${API_PREFIX}/public/publicaciones/`,
    blogPosts: `${API_PREFIX}/blog/posts`,
    blogPost: (id) => `${API_PREFIX}/blog/posts/${id}`,
    courses: `${API_PREFIX}/courses`,
    course: (slug) => `${API_PREFIX}/courses/${encodeURIComponent(slug)}`,
  },
  adminContent: {
    blogPosts: `${API_PREFIX}/admin/blog/posts`,
    blogPost: (id) => `${API_PREFIX}/admin/blog/posts/${id}`,
    blogImages: (id) => `${API_PREFIX}/admin/blog/posts/${id}/images`,
    blogImage: (postId, imageId) => `${API_PREFIX}/admin/blog/posts/${postId}/images/${imageId}`,
    courses: `${API_PREFIX}/admin/courses`,
    course: (id) => `${API_PREFIX}/admin/courses/${id}`,
    courseCover: (id) => `${API_PREFIX}/admin/courses/${id}/cover`,
    courseSections: (id) => `${API_PREFIX}/admin/courses/${id}/sections`,
    courseSection: (courseId, sectionId) => `${API_PREFIX}/admin/courses/${courseId}/sections/${sectionId}`,
  },
  contact: `${API_PREFIX}/contact/`,

  functions: {
    importarExamenPdf: `${API_PREFIX}/examenes/importar-pdf/`,
    crearInstructor: `${API_PREFIX}/users/crear-instructor/`,
    resetPasswordAdmin: (profileId) => `${API_PREFIX}/users/${profileId}/reset-password/`,
    assignedAlumnos: (profileId) => `${API_PREFIX}/profiles/${profileId}/assigned-alumnos/`,
    assignAlumnos: (profileId) => `${API_PREFIX}/profiles/${profileId}/assign-alumnos/`,
    unassignAlumnos: (profileId) => `${API_PREFIX}/profiles/${profileId}/unassign-alumnos/`,
    listInstructors: `${API_PREFIX}/profiles/instructores/`,
    instructorAccessList: (alumnoId) => `${API_PREFIX}/instructor/access/${alumnoId}/`,
    instructorAccessToggle: `${API_PREFIX}/instructor/access/toggle/`,
  },

  ws: {
  /** WebSocket del backend activo (chat, conexiones en tiempo real). */
    base: WS_BASE,
    chat: (roomId) => `${WS_BASE}/chat/${roomId}/`,
    conexiones: `${WS_BASE}/conexiones/`,
    videollamada: (callId) => `${WS_BASE}/videollamada/${callId}/`,
  },
};

export default endpoints;
