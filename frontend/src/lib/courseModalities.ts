export const COURSE_MODALITIES = [
  { value: 'online', label: 'Online' },
  { value: 'presencial', label: 'Presencial' },
  { value: 'presencial_online', label: 'Presencial/Online' },
] as const;

export type CourseModality = typeof COURSE_MODALITIES[number]['value'];
export const courseModalityLabel = (modality: CourseModality) => COURSE_MODALITIES.find(item => item.value === modality)?.label || 'Sin especificar';
