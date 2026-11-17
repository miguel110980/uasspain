import { useQuery } from '@tanstack/react-query';
import contentService from '@/services/contentService';
import apiClient from '@/api/apiClient';
import endpoints from '@/api/endpoints';
import { mergePublicPublications, type BoePublication } from '@/lib/publicPublications';

export default function usePublicPublicaciones(limit = 100) {
  const query = useQuery({
    queryKey: ['public', 'blog-posts'],
    queryFn: contentService.publicPosts,
    staleTime: 5 * 60 * 1000,
  });
  const boe = useQuery({
    queryKey: ['public', 'boe-publications'],
    queryFn: async () => (await apiClient.get<BoePublication[]>(endpoints.public.publicaciones)).data,
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
  return { posts: mergePublicPublications(query.data || [], boe.data || []).slice(0, limit), loading: query.isLoading || boe.isLoading, error: query.isError || boe.isError, retry: () => Promise.all([query.refetch(), boe.refetch()]) };
}
