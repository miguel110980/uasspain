export const COURSE_CATEGORIES = [
  { value: 'easa', label: 'Curso EASA', menuLabel: 'Cursos EASA' },
  { value: 'non_easa', label: 'Curso no EASA', menuLabel: 'Cursos no EASA' },
  { value: 'instructor', label: 'Curso de Instructor', menuLabel: 'Instructor UAS' },
  { value: 'other', label: 'Otros cursos', menuLabel: 'Otros cursos' },
] as const;

export type CourseCategory = typeof COURSE_CATEGORIES[number]['value'];
export const courseCategoryLabel = (category: CourseCategory) => COURSE_CATEGORIES.find(item => item.value === category)?.label || 'Otros cursos';
export const coursePath = (course: { slug: string }) => `/formacion/${course.slug.split('/').map(encodeURIComponent).join('/')}`;
