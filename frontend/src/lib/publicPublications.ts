import type { BlogPost } from '@/services/contentService';

export type BoePublication = {
  id: string; titulo: string; resumen: string; fecha_publicacion?: string | null;
  url: string; activo: boolean; created_date: string;
};
export type PublicPost = BlogPost & { reference_url?: string };

export function mergePublicPublications(posts: BlogPost[], publications: BoePublication[], now = new Date()): PublicPost[] {
  const today = now.toISOString().slice(0, 10);
  const boe: PublicPost[] = publications.filter(post => post.activo && (!post.fecha_publicacion || post.fecha_publicacion <= today)).map(post => ({
    id: `boe:${post.id}`, version: 0, title: post.titulo, body: post.resumen,
    status: 'published', sort_order: 0, created_at: post.created_date, updated_at: post.created_date,
    published_at: post.fecha_publicacion || post.created_date, images: [],
    reference_url: /^https?:\/\//i.test(post.url) ? post.url : undefined,
  }));
  const unique = new Map<string, PublicPost>();
  for (const post of [...posts, ...boe]) unique.set(post.id, post);
  return [...unique.values()].sort((a,b) => (a.sort_order - b.sort_order) || Date.parse(b.published_at || b.created_at) - Date.parse(a.published_at || a.created_at));
}
