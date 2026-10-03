import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import contentService from '@/services/contentService';
import CourseTemplate from '@/components/formacion/CourseTemplate';
import PageNotFound from '@/lib/PageNotFound';

export default function CursoDinamico() {
  const slug = (useParams()['*'] || '').replace(/\/+$/, '');
  const query = useQuery({ queryKey: ['public', 'course', slug], queryFn: () => contentService.publicCourse(slug), retry: false, enabled: Boolean(slug), staleTime: 0, refetchInterval: 30_000 });
  if (query.isLoading) return <div className="min-h-screen bg-background flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  if (query.isError && (query.error as { response?: { status?: number } })?.response?.status !== 404) return <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4"><p role="alert">No se pudo cargar el curso.</p><button onClick={() => query.refetch()} className="text-primary underline">Reintentar</button></div>;
  if (query.isError || !query.data) return <PageNotFound />;
  return <CourseTemplate course={query.data} />;
}
