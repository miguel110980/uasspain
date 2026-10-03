import apiClient from '@/api/apiClient';
import endpoints from '@/api/endpoints';
import { queryClientInstance } from '@/lib/query-client';
import type { CourseCategory } from '@/lib/courseCategories';

export function refreshCourseQueries() {
  void queryClientInstance.invalidateQueries({ queryKey: ['public', 'courses'] });
  void queryClientInstance.invalidateQueries({ queryKey: ['public', 'course'] });
}
function coursesChanged() {
  refreshCourseQueries();
  if (typeof BroadcastChannel !== 'undefined') {
    const channel = new BroadcastChannel('uasspain-courses');
    channel.postMessage('changed'); channel.close();
  }
}

export type ContentStatus = 'draft' | 'published';
export type CourseStatus = 'upcoming' | 'published';

export interface BlogImage {
  id: string;
  url: string;
  alt_text: string;
  sort_order: number;
  created_at?: string;
}

export interface BlogPost {
  id: string;
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
  modality: 'online' | 'presencial';
  duration: string;
  status: CourseStatus;
  sort_order: number;
  content_available?: boolean;
  sections?: CourseSection[];
}

export type CourseInput = Omit<Partial<Course>, 'sections'> & { sections?: Partial<CourseSection>[] };

export const contentService = {
  publicPosts: async () => (await apiClient.get<BlogPost[]>(endpoints.public.blogPosts)).data,
  publicCourses: async () => (await apiClient.get<Course[]>(endpoints.public.courses)).data,
  publicCourse: async (slug: string) => (await apiClient.get<Course>(endpoints.public.course(slug))).data,

  adminPosts: async () => (await apiClient.get<BlogPost[]>(endpoints.adminContent.blogPosts)).data,
  createPost: async (payload: Partial<BlogPost>) => (await apiClient.post<BlogPost>(endpoints.adminContent.blogPosts, payload)).data,
  updatePost: async (id: string, payload: Partial<BlogPost>) => (await apiClient.patch<BlogPost>(endpoints.adminContent.blogPost(id), payload)).data,
  deletePost: async (id: string) => apiClient.delete(endpoints.adminContent.blogPost(id)),
  addPostImage: async (id: string, file: File, altText = '') => {
    const data = new FormData();
    data.append('alt_text', altText);
    data.append('file', file);
    return (await apiClient.post<BlogImage>(endpoints.adminContent.blogImages(id), data)).data;
  },
  deletePostImage: async (postId: string, imageId: string) => apiClient.delete(endpoints.adminContent.blogImage(postId, imageId)),

  adminCourses: async () => (await apiClient.get<Course[]>(endpoints.adminContent.courses)).data,
  createCourse: async (payload: CourseInput) => {
    const result = (await apiClient.post<Course>(endpoints.adminContent.courses, payload)).data;
    coursesChanged(); return result;
  },
  updateCourse: async (id: string, payload: CourseInput) => {
    const result = (await apiClient.patch<Course>(endpoints.adminContent.course(id), payload)).data;
    coursesChanged(); return result;
  },
  deleteCourse: async (id: string) => {
    await apiClient.delete(endpoints.adminContent.course(id)); coursesChanged();
  },
};

export default contentService;
