import apiClient from '@/api/apiClient';
import endpoints from '@/api/endpoints';

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
  short_description: string;
  description?: string;
  introduction?: string;
  syllabus?: string;
  cover_image_url: string;
  cover_image_path?: string;
  status: CourseStatus;
  sort_order: number;
  content_available?: boolean;
  sections?: CourseSection[];
}

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
  createCourse: async (payload: Partial<Course>) => (await apiClient.post<Course>(endpoints.adminContent.courses, payload)).data,
  updateCourse: async (id: string, payload: Partial<Course>) => (await apiClient.patch<Course>(endpoints.adminContent.course(id), payload)).data,
  deleteCourse: async (id: string) => apiClient.delete(endpoints.adminContent.course(id)),
  uploadCourseCover: async (id: string, file: File) => {
    const data = new FormData();
    data.append('file', file);
    return (await apiClient.post(endpoints.adminContent.courseCover(id), data)).data;
  },
  createSection: async (courseId: string, payload: Partial<CourseSection>) =>
    (await apiClient.post<CourseSection>(endpoints.adminContent.courseSections(courseId), payload)).data,
  updateSection: async (courseId: string, sectionId: string, payload: Partial<CourseSection>) =>
    (await apiClient.patch<CourseSection>(endpoints.adminContent.courseSection(courseId, sectionId), payload)).data,
  deleteSection: async (courseId: string, sectionId: string) =>
    apiClient.delete(endpoints.adminContent.courseSection(courseId, sectionId)),
};

export default contentService;
