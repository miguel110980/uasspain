import apiClient from '@/api/apiClient';
import type { SystemStatusResponse } from '@/api/systemStatus';
import type { AssignableInstructor } from '@/types/api';
import { getRoles, panelRouteForUser, isBlockedStatus } from '@/lib/roles';
import { endpoints } from '@/api/endpoints';
import { collectClientMeta } from '@/lib/clientMeta';
import { buildListParams, unwrapItem, unwrapList } from '@/api/queryParams';
import { buildUrl, encodeFormBody } from '@/lib/urls';
import { sanitizeInput, sanitizePayload, type SanitizeKind } from '@/lib/sanitize';
import { INSTRUCTOR_SCHEMA } from '@/lib/sanitizeSchemas';
import { queryClientInstance } from '@/lib/query-client';
import { SESSION_QUERY_KEY } from '@/hooks/useSession';

type LoginResult = {
  completed: boolean;
  otpRequired?: boolean;
  detail?: string;
  roles?: string[];
};

/** @type {Record<string, import('@/lib/sanitize').SanitizeKind>} */
const AUTH_SCHEMA = {
  email: 'email',
  password: 'password',
  code: 'otp',
  otp: 'otp',
  otpCode: 'otp',
  current_password: 'password',
  new_password: 'password',
  nombre: 'text',
  apellidos: 'text',
  username: 'username',
  dni_nie: 'dni',
} satisfies Record<string, SanitizeKind>;

const publicUser = (data) => ({
  id: data.id,
  user_id: data.user_id,
  email: data.email,
  full_name: data.full_name ?? data.nombre_completo ?? data.email,
  role: data.session_role || data.role || data.rol,
  roles: getRoles(data),
  session_role: data.session_role || '',
  status: data.status,
  profile: data.profile ?? null,
});

const BLOCKED_MESSAGES = {
  pendiente: 'Su cuenta está pendiente de validación por el instructor.',
  rechazado: 'Su solicitud de registro ha sido rechazada.',
  bloqueado: 'Su cuenta ha sido bloqueada.',
};

export const authService = {
  getBlockedMessage(status) {
    return BLOCKED_MESSAGES[status] ?? 'Acceso no permitido.';
  },

  invalidateSession() {
    queryClientInstance.removeQueries({ queryKey: SESSION_QUERY_KEY });
  },

  setAuthNotice(message) {
    if (typeof window === 'undefined' || !message) return;
    window.sessionStorage.setItem('uasspain.auth_notice', String(message));
  },

  consumeAuthNotice() {
    if (typeof window === 'undefined') return '';
    const value = window.sessionStorage.getItem('uasspain.auth_notice') || '';
    if (value) window.sessionStorage.removeItem('uasspain.auth_notice');
    return value;
  },

  async fetchMe(optional = false) {
    const res = await apiClient.get(endpoints.auth.me, optional ? { params: { optional: true } } : undefined);
    const data = unwrapItem(res);
    return data == null ? null : publicUser(data);
  },

  /** @deprecated Preferir fetchMe() con useSession(). */
  async me() {
    return authService.fetchMe();
  },

  /** Comprueba que un perfil pertenece a la sesión actual (evita mezclar con otros usuarios). */
  profileMatchesSession(profile, me) {
    if (!profile || !me) return false;
    if (me.user_id != null && profile.user_id != null) {
      return String(profile.user_id) === String(me.user_id);
    }
    return me.id != null && profile.id != null && String(profile.id) === String(me.id);
  },

  /** Perfil del usuario autenticado (siempre el de /auth/me/, nunca un listado genérico). */
  async getSessionProfile() {
    const me = await this.me();
    let profile = me.profile ?? null;
    if (!this.profileMatchesSession(profile, me)) {
      profile = null;
    }
    if (!profile?.id && me.id) {
      try {
        const fetched = await this.getProfile(me.id);
        profile = this.profileMatchesSession(fetched, me) ? fetched : null;
      } catch {
        profile = null;
      }
    }
    return { me, profile };
  },

  /** Tras login: devuelve ruta del panel o lanza con { code, message }. */
  async resolvePostLoginRoute() {
    const me = await authService.me();
    const profile = me.profile;
    const status = profile?.status;

    if (isBlockedStatus(status)) {
      const err = new Error(BLOCKED_MESSAGES[status]);
      Object.assign(err, { code: status });
      throw err;
    }

    return panelRouteForUser({ ...me, profile });
  },

  async redirectAfterLogin() {
    authService.invalidateSession();
    const route = await authService.resolvePostLoginRoute();
    window.location.href = route;
  },

  async loginAndRedirect(email: string, password: string, code?: string, sessionRole?: string): Promise<LoginResult> {
    const result = await authService.login(email, password, code, sessionRole);
    if (result?.completed === false) return result;
    await authService.redirectAfterLogin();
    return { completed: true };
  },

  async login(email: string, password: string, code?: string, sessionRole?: string): Promise<LoginResult> {
    const client_meta = await collectClientMeta();
    const raw = { email, password, ...(code ? { code } : {}), ...(sessionRole ? { session_role: sessionRole } : {}) };
    const body = sanitizePayload(raw, AUTH_SCHEMA);
    const res = await apiClient.post(endpoints.auth.login, { ...body, client_meta });
    if (res.status === 202) {
      return {
        completed: false,
        otpRequired: true,
        detail: res.data?.detail || 'Código de acceso enviado.',
        roles: res.data?.roles || [],
      };
    }
    return { completed: true, detail: res.data?.detail || 'Inicio de sesión correcto.' };
  },

  async loginWithGoogleCredential(credential) {
    const client_meta = await collectClientMeta();
    await apiClient.post(endpoints.auth.google, {
      id_token: credential,
      client_meta,
    });
  },

  async register({ email, password, ...extra }) {
    const body = sanitizePayload({ email, password, ...extra }, AUTH_SCHEMA);
    const res = await apiClient.post(endpoints.auth.register, body);
    return res.data;
  },

  async verifyOtp(payload) {
    const raw = typeof payload === 'string'
      ? { email: payload }
      : {
          email: payload.email,
          code: payload.code ?? payload.otp ?? payload.otpCode,
        };
    await apiClient.post(endpoints.auth.verifyOtp, sanitizePayload(raw, AUTH_SCHEMA));
  },

  async resendOtp(payload) {
    const raw = typeof payload === 'string' ? { email: payload } : payload;
    const res = await apiClient.post(endpoints.auth.resendOtp, sanitizePayload(raw, AUTH_SCHEMA));
    return res.data;
  },

  async resetPasswordRequest(email) {
    const body = sanitizePayload({ email }, AUTH_SCHEMA);
    const res = await apiClient.post(endpoints.auth.resetPasswordRequest, body);
    return res.data;
  },

  async resetPassword(payload) {
    const clean = sanitizePayload(payload, {
      uid: 'text',
      token: 'text',
      password: 'password',
      new_password: 'password',
    });
    const body = encodeFormBody({
      uid: clean.uid,
      token: clean.token,
      password: clean.password ?? clean.new_password,
    });
    await apiClient.post(endpoints.auth.resetPassword, body, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
  },

  /** @param {{ currentPassword?: string, newPassword?: string, userId?: string }} [params] */
  async changePassword({ currentPassword, newPassword, userId }: { currentPassword?: string; newPassword?: string; userId?: string } = {}) {
    const body = sanitizePayload({
      current_password: currentPassword,
      new_password: newPassword,
      user_id: userId,
    }, AUTH_SCHEMA);
    await apiClient.post(endpoints.auth.changePassword, body);
  },

  async setSessionRole(role: string) {
    const res = await apiClient.post(endpoints.auth.sessionRole, { role });
    const me = await authService.fetchMe();
    if (me?.session_role !== role) throw new Error('No se pudo confirmar el rol de sesión.');
    queryClientInstance.setQueryData(SESSION_QUERY_KEY, me);
    return res.data;
  },

  async dashboardCounts() {
    return (await apiClient.get('/api/dashboard/counts/')).data;
  },

  async logout(redirectUrl?: string) {
    try {
      await apiClient.post(endpoints.auth.logout);
    } catch {
      // Ignorar errores al cerrar sesión (p. ej. token ya expirado).
    }
    authService.invalidateSession();
    if (redirectUrl) window.location.href = redirectUrl;
  },

  redirectToLogin(nextUrl?: string, reason?: string) {
    if (reason) authService.setAuthNotice(reason);
    window.location.href = buildUrl('/', {
      auth: 'login',
      ...(nextUrl ? { from: nextUrl } : {}),
    });
  },

  // --- Perfiles de usuario (UserProfile) ---

  async listProfiles(sort?: string, limit?: number, filters: Record<string, unknown> = {}) {
    const requested = Math.max(1, limit ?? 200);
    const profiles = [];
    const seen = new Set<string>();
    const initialOffset = Math.max(0, Number(filters.offset) || 0);
    while (profiles.length < requested) {
      const pageSize = Math.min(200, requested - profiles.length);
      const res = await apiClient.get(endpoints.profiles, {
        params: buildListParams(sort, pageSize, { ...filters, offset: initialOffset + profiles.length }),
      });
      const page = unwrapList(res);
      if (!Array.isArray(page)) throw new Error('Respuesta de perfiles no válida.');
      const fresh = page.filter(profile => !seen.has(String(profile.id)));
      for (const profile of fresh) { seen.add(String(profile.id)); profiles.push(profile); }
      if (page.length < pageSize || fresh.length === 0) break;
    }
    return profiles;
  },

  async listInstructors(): Promise<AssignableInstructor[]> {
    const res = await apiClient.get(endpoints.functions.listInstructors);
    return unwrapList(res);
  },

  async filterProfiles(query: Record<string, unknown>, sort?: string, limit?: number) {
    return authService.listProfiles(sort, limit, query);
  },

  async getProfile(id) {
    const res = await apiClient.get(`${endpoints.profiles}${id}/`);
    return unwrapItem(res);
  },

  async createProfile(data) {
    const res = await apiClient.post(endpoints.profiles, data);
    return unwrapItem(res);
  },

  async updateProfile(id, data) {
    const res = await apiClient.patch(`${endpoints.profiles}${id}/`, data);
    return unwrapItem(res);
  },

  async deleteProfile(id) {
    await apiClient.delete(`${endpoints.profiles}${id}/`);
    return { id };
  },

  async inviteUser(payload) {
    const res = await apiClient.post(`${endpoints.users}invite/`, payload);
    return unwrapItem(res);
  },

  async crearInstructor(payload) {
    const res = await apiClient.post(
      endpoints.functions.crearInstructor,
      sanitizePayload(payload, INSTRUCTOR_SCHEMA),
    );
    return { data: res.data };
  },

  async adminResetPassword(profileId) {
    const res = await apiClient.post(endpoints.functions.resetPasswordAdmin(profileId));
    return res.data;
  },

  async getAssignedAlumnos(profileId) {
    const res = await apiClient.get(endpoints.functions.assignedAlumnos(profileId));
    return res.data;
  },

  async assignAlumnos(profileId, studentIds) {
    const res = await apiClient.post(endpoints.functions.assignAlumnos(profileId), { student_ids: studentIds });
    return res.data;
  },

  async unassignAlumnos(profileId, studentIds) {
    const res = await apiClient.post(endpoints.functions.unassignAlumnos(profileId), { student_ids: studentIds });
    return res.data;
  },

  async getSystemStatus() {
    const res = await apiClient.get<SystemStatusResponse>(endpoints.systemStatus);
    return res.data;
  },

  async getSystemAuthPolicy() {
    const res = await apiClient.get(endpoints.systemAuthPolicy);
    return res.data;
  },

  async updateSystemAuthPolicy(payload) {
    const res = await apiClient.put(endpoints.systemAuthPolicy, payload);
    return res.data;
  },
};

export default authService;
