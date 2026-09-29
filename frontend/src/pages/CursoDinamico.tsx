import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import contentService from '@/services/contentService';
import CourseTemplate from '@/components/formacion/CourseTemplate';
import PageNotFound from '@/lib/PageNotFound';

export default function CursoDinamico() {
  const { slug = '' } = useParams();
  const query = useQuery({ queryKey: ['public', 'course', slug], queryFn: () => contentService.publicCourse(slug), retry: false, enabled: Boolean(slug) });
  if (query.isLoading) return <div className="min-h-screen bg-background flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  if (!query.data) return <PageNotFound />;
  return <CourseTemplate course={query.data} />;
}
