import { useEffect, useMemo, useRef, useState } from 'react';
import authService from '@/services/authService';
import { hasRole, isBlockedStatus } from '@/lib/roles';
import { useSession } from '@/hooks/useSession';
import conexionesService from '@/services/conexionesService';

/**
 * Carga sesión real vía API y valida rol del panel.
 * @param {'admin'|'instructor'|'alumno'} requiredRole
 */
export function usePanelAuth(requiredRole) {
  const { data: me, isLoading, isError, error, refetch } = useSession();
  const invalidSession = (isError && (error as { response?: { status?: number } })?.response?.status === 401)
    || (!isLoading && !isError && me === null);
  const roleSetRef = useRef(null);
  const [roleError, setRoleError] = useState('');
  const [roleAttempt, setRoleAttempt] = useState(0);
  const rolePending = Boolean(me && hasRole({ ...me, profile: me.profile }, requiredRole) && me.session_role !== requiredRole);

  useEffect(() => {
    if (!me?.profile?.id || rolePending) return;
    return conexionesService.subscribeConexiones(event => {
      if (conexionesService.parseWsPayload(event)?.type === 'asignacion') void refetch();
    });
  }, [me?.profile?.id, rolePending, refetch]);

  useEffect(() => {
    if (invalidSession) authService.redirectToLogin(window.location.pathname + window.location.search);
  }, [invalidSession]);

  useEffect(() => {
    if (!me || isLoading || !rolePending) return;
    const currentSessionRole = me.session_role;
    const alreadySet = roleSetRef.current === requiredRole;
    if (!alreadySet && currentSessionRole !== requiredRole && hasRole({ ...me, profile: me.profile }, requiredRole)) {
      roleSetRef.current = requiredRole;
      setRoleError('');
      authService.setSessionRole(requiredRole).catch(() => {
        roleSetRef.current = null;
        setRoleError('No se pudo cambiar el rol de sesión. Vuelve a intentarlo.');
      });
    }
  }, [me, isLoading, requiredRole, rolePending, roleAttempt]);

  return useMemo(() => {
    if (roleError && rolePending) {
      return { loading: false, user: null, profile: null, unauthorized: false, blockedMessage: '',
        loadError: roleError, retry: () => { setRoleError(''); setRoleAttempt(value => value + 1); } };
    }
    if (rolePending) return { loading: true, user: null, profile: null, unauthorized: false, blockedMessage: '' };
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
  }, [isLoading, isError, invalidSession, me, requiredRole, refetch, rolePending, roleError]);
}

export default usePanelAuth;
