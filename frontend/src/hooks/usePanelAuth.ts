import { useEffect, useMemo, useRef } from 'react';
import authService from '@/services/authService';
import { hasRole, isBlockedStatus } from '@/lib/roles';
import { useSession } from '@/hooks/useSession';

/**
 * Carga sesión real vía API y valida rol del panel.
 * @param {'admin'|'instructor'|'alumno'} requiredRole
 */
export function usePanelAuth(requiredRole) {
  const { data: me, isLoading, isError, error, refetch } = useSession();
  const invalidSession = isError && (error as { response?: { status?: number } })?.response?.status === 401;
  const roleSetRef = useRef(null);

  useEffect(() => {
    if (invalidSession) authService.redirectToLogin(window.location.pathname + window.location.search);
  }, [invalidSession]);

  useEffect(() => {
    if (!me || isLoading) return;
    const currentSessionRole = me.session_role;
    const alreadySet = roleSetRef.current === requiredRole;
    if (!alreadySet && currentSessionRole !== requiredRole && hasRole({ ...me, profile: me.profile }, requiredRole)) {
      roleSetRef.current = requiredRole;
      authService.setSessionRole(requiredRole).catch(() => {});
    }
  }, [me, isLoading, requiredRole]);

  return useMemo(() => {
    if (isError && !me && !invalidSession) {
      return { loading: false, user: null, profile: null, unauthorized: false, blockedMessage: '',
        loadError: 'No se pudo comprobar la sesión. Comprueba la conexión y vuelve a intentarlo.', retry: refetch };
    }
    if (isLoading || !me) {
      return { loading: true, user: null, profile: null, unauthorized: false, blockedMessage: '' };
    }

    const profile = me.profile ?? null;
    const status = profile?.status;

    if (isBlockedStatus(status)) {
      return {
        loading: false,
        user: me,
        profile,
        unauthorized: true,
        blockedMessage: authService.getBlockedMessage(status),
      };
    }

    if (!hasRole({ ...me, profile }, requiredRole)) {
      return {
        loading: false,
        user: me,
        profile,
        unauthorized: true,
        blockedMessage: '',
      };
    }

    return {
      loading: false,
      user: me,
      profile,
      unauthorized: false,
      blockedMessage: '',
    };
  }, [isLoading, isError, invalidSession, me, requiredRole, refetch]);
}

export default usePanelAuth;
