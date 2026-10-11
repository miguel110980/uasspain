import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import authService from '@/services/authService';
import { watchSessionActivity } from '@/lib/sessionActivity';

export const SESSION_QUERY_KEY = ['auth', 'me'];

/** Sesión actual cacheada (evita repetir /auth/me en cada panel). */
export function useSession() {
  const session = useQuery({
    queryKey: SESSION_QUERY_KEY,
    queryFn: () => authService.fetchMe(true),
    staleTime: 60_000,
    retry: false,
  });
  useEffect(() => {
    if (session.data?.id) return watchSessionActivity();
  }, [session.data?.id]);
  return session;
}

export default useSession;
