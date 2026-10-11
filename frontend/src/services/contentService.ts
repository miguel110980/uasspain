import apiClient from '@/api/apiClient';
import endpoints from '@/api/endpoints';
import { queryClientInstance } from '@/lib/query-client';
import type { CourseCategory } from '@/lib/courseCategories';
import type { CourseModality } from '@/lib/courseModalities';
import { invalidateContent } from '@/lib/contentRealtime';

export function refreshCourseQueries() {
  void queryClientInstance.invalidateQueries({ queryKey: ['admin', 'courses'] });
  void queryClientInstance.invalidateQueries({ queryKey: ['public', 'courses'] });
  void queryClientInstance.invalidateQueries({ queryKey: ['public', 'course'] });
}
function coursesChanged() {
  refreshCourseQueries();
}
const matching = (version?: number) => ({ headers: { 'If-Match': String(version ?? '') } });
const postsChanged = () => void invalidateContent(queryClientInstance, 'posts');
const servicesChanged = () => void invalidateContent(queryClientInstance, 'services');

export type ContentStatus = 'draft' | 'published';
export type CourseStatus = 'upcoming' | 'draft' | 'published';

export interface BlogImage {
  id: string;
  url: string;
  alt_text: string;
  sort_order: number;
  created_at?: string;
}

export interface BlogPost {
  id: string;
  version: number;
  title: string;
  body: string;
  status: ContentStatus;
  sort_order: number;
  created_at: string;
  updated_at: string;
  published_at?: string | null;
  images: BlogImage[];
}

export interface CourseSection {
  id: string;
  course_id: string;
  title: string;
  body: string;
  sort_order: number;
}

export interface Course {
  id: string;
  version: number;
  name: string;
  slug: string;
  category: CourseCategory;
  menu_icon?: string;
  presentation?: {
    original_name?: string; original_summary?: string; original_modality?: string;
    icon?: string; hero_parts?: { text: string; highlight: boolean }[]; badge?: string;
    back?: { href: string; label: string }; format_label?: string; certification?: string;
    description_heading?: string; topics_heading?: string;
    cta?: { heading: string; description: string; label: string; href: string };
    seo?: { title: string; description: string; keywords: string };
  };
  short_description: string;
  description?: string;
  introduction?: string;
  syllabus?: string;
  cover_image_url: string;
  cover_image_path?: string;
  modality: CourseModality;
  duration: string;
  status: CourseStatus;
  sort_order: number;
  content_available?: boolean;
  sections?: CourseSection[];
}

export type CourseInput = Omit<Partial<Course>, 'sections'> & { sections?: Partial<CourseSection>[] };

export type ServiceNode = string | { tag: string; props: Record<string, unknown>; children: ServiceNode[] };
export interface ManagedService {
  id: string; version: number; title: string; slug: string; short_description: string; description: string;
  icon: string; coordinate: string; image_url: string; action_href: string; status: ContentStatus; sort_order: number;
  created_at?: string; updated_at?: string;
  presentation: { layout?: ServiceNode[]; original_title?: string; original_summary?: string; original_description?: string };
  seo: { title?: string; description?: string; keywords?: string };
}
export type ServiceInput = Partial<Omit<ManagedService, 'id' | 'version' | 'created_at' | 'updated_at'>>;

export const contentService = {
  adminImages: async () => (await apiClient.get<{ id: string; url: string; content_type?: string; size_bytes?: number }[]>('/api/admin/content/images')).data,
  reorder: async (kind: 'posts' | 'courses' | 'services', items: { id: string; version: number; sort_order: number }[]) => {
    await apiClient.post(`/api/admin/content/${kind}/order`, items); void invalidateContent(queryClientInstance, kind);
  },
  publicServices: async () => (await apiClient.get<ManagedService[]>(endpoints.public.services)).data,
  publicService: async (slug: string) => (await apiClient.get<ManagedService>(endpoints.public.service(slug))).data,
  adminServices: async () => (await apiClient.get<ManagedService[]>(endpoints.adminContent.services)).data,
  createService: async (input: ServiceInput) => { const result = (await apiClient.post<ManagedService>(endpoints.adminContent.services, input)).data; servicesChanged(); return result; },
  updateService: async (id: string, input: ServiceInput, version: number) => { const result = (await apiClient.patch<ManagedService>(endpoints.adminContent.service(id), input, matching(version))).data; servicesChanged(); return result; },
  deleteService: async (id: string, version: number) => { await apiClient.delete(endpoints.adminContent.service(id), matching(version)); servicesChanged(); },
  uploadServiceImage: async (id: string, file: File, version: number) => { const data = new FormData(); data.append('file', file); const result = (await apiClient.post<ManagedService>(endpoints.adminContent.serviceImage(id), data, matching(version))).data; servicesChanged(); return result; },
  publicPosts: async () => (await apiClient.get<BlogPost[]>(endpoints.public.blogPosts)).data,
  publicCourses: async () => (await apiClient.get<Course[]>(endpoints.public.courses)).data,
  publicCourse: async (slug: string) => (await apiClient.get<Course>(endpoints.public.course(slug))).data,

  adminPosts: async () => (await apiClient.get<BlogPost[]>(endpoints.adminContent.blogPosts)).data,
  createPost: async (payload: Partial<BlogPost>) => { const result = (await apiClient.post<BlogPost>(endpoints.adminContent.blogPosts, payload)).data; postsChanged(); return result; },
  updatePost: async (id: string, payload: Partial<BlogPost>, version?: number) => { const result = (await apiClient.patch<BlogPost>(endpoints.adminContent.blogPost(id), payload, matching(version))).data; postsChanged(); return result; },
  deletePost: async (id: string, version?: number) => { await apiClient.delete(endpoints.adminContent.blogPost(id), matching(version)); postsChanged(); },
  addPostImage: async (id: string, file: File, altText = '', version?: number) => {
    const data = new FormData();
    data.append('alt_text', altText);
    data.append('file', file);
    const result = (await apiClient.post<BlogImage>(endpoints.adminContent.blogImages(id), data, matching(version))).data; postsChanged(); return result;
  },
  deletePostImage: async (postId: string, imageId: string, version?: number) => { await apiClient.delete(endpoints.adminContent.blogImage(postId, imageId), matching(version)); postsChanged(); },

  adminCourses: async () => (await apiClient.get<Course[]>(endpoints.adminContent.courses)).data,
  createCourse: async (payload: CourseInput) => {
    const result = (await apiClient.post<Course>(endpoints.adminContent.courses, payload)).data;
    coursesChanged(); return result;
  },
  updateCourse: async (id: string, payload: CourseInput, version?: number) => {
    const result = (await apiClient.patch<Course>(endpoints.adminContent.course(id), payload, matching(version))).data;
    coursesChanged(); return result;
  },
  deleteCourse: async (id: string, version?: number) => {
    await apiClient.delete(endpoints.adminContent.course(id), matching(version)); coursesChanged();
  },
};

export default contentService;
