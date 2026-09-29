import { useQuery } from '@tanstack/react-query';
import contentService from '@/services/contentService';

export default function usePublicPublicaciones(limit = 100) {
  const query = useQuery({
    queryKey: ['public', 'blog-posts'],
    queryFn: contentService.publicPosts,
    staleTime: 5 * 60 * 1000,
    placeholderData: [],
  });
  return { posts: (query.data || []).slice(0, limit), loading: query.isLoading };
}
