import { useEffect, useMemo, useRef } from 'react';
import authService from '@/services/authService';
import { hasRole, isBlockedStatus } from '@/lib/roles';
import { useSession } from '@/hooks/useSession';

/**
 * Carga sesión real vía API y valida rol del panel.
 * @param {'admin'|'instructor'|'alumno'} requiredRole
 */
export function usePanelAuth(requiredRole) {
  const { data: me, isLoading, isError } = useSession();
  const roleSetRef = useRef(null);

  useEffect(() => {
    if (isError) authService.redirectToLogin(window.location.pathname);
  }, [isError]);

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
  }, [isLoading, me, requiredRole]);
}

export default usePanelAuth;
