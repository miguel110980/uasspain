import { useQuery } from '@tanstack/react-query';
import authService from '@/services/authService';

export const SESSION_QUERY_KEY = ['auth', 'me'];

/** Sesión actual cacheada (evita repetir /auth/me en cada panel). */
export function useSession() {
  return useQuery({
    queryKey: SESSION_QUERY_KEY,
    queryFn: () => authService.fetchMe(),
    staleTime: 60_000,
    retry: false,
  });
}

export default useSession;
