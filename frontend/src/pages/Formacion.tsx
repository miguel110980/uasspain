import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle2, Clock3, GraduationCap, Loader2 } from 'lucide-react';
import Navbar from '@/components/layout/Navbar';
import Footer from '@/components/layout/Footer';
import contentService from '@/services/contentService';
import { courseCategoryLabel, coursePath } from '@/lib/courseCategories';

export default function Formacion() {
  const { data = [], isLoading, isError, refetch } = useQuery({ queryKey: ['public', 'courses'], queryFn: contentService.publicCourses, staleTime: 0, refetchOnWindowFocus: true, refetchInterval: 30_000 });
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />
      <main className="public-content min-h-screen pt-32 pb-24">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-14">
            <span className="text-xs font-mono uppercase tracking-widest text-primary">Formación UAS</span>
            <h1 className="font-heading text-4xl md:text-6xl font-bold mt-4">Todos los cursos</h1>
            <p className="text-muted-foreground mt-4">Consulta los cursos publicados y las próximas convocatorias de UASSpain.</p>
          </div>
          {isError ? (
            <div role="alert" className="glass-card p-6 text-center">
              No se pudieron cargar los cursos. <button onClick={() => refetch()} className="text-primary underline">Reintentar</button>
            </div>
          ) : isLoading ? (
            <Loader2 aria-label="Cargando cursos" className="w-8 h-8 animate-spin text-primary mx-auto" />
          ) : data.length === 0 ? (
            <div className="glass-card p-12 text-center text-muted-foreground">Todavía no hay cursos disponibles.</div>
          ) : (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {data.map((course) => {
                const published = course.status === 'published';
                return (
                  <article key={course.id} className="glass-card min-w-0 break-words overflow-hidden flex flex-col">
                    {course.cover_image_url ? (
                      <img src={course.cover_image_url} alt={`Portada de ${course.name}`} loading="lazy" className="w-full aspect-video object-cover" />
                    ) : (
                      <div className="aspect-video bg-primary/5 flex items-center justify-center"><GraduationCap className="w-12 h-12 text-primary/60" /></div>
                    )}
                    <div className="p-6 flex-1 flex flex-col">
                      <div className="flex flex-col items-start gap-3">
                        <h2 className="font-heading text-xl font-bold">{course.name}</h2>
                        <span className={`shrink-0 inline-flex items-center gap-1 text-[10px] uppercase font-bold ${published ? 'text-primary' : 'text-warning'}`}>
                          {published ? <CheckCircle2 className="w-3 h-3" /> : <Clock3 className="w-3 h-3" />}
                          {published ? 'Publicado' : 'Próximamente'}
                        </span>
                      </div>
                      <p className="text-xs text-primary mt-3">{courseCategoryLabel(course.category)}</p>
                      <p className="text-sm text-muted-foreground mt-3 flex-1">{course.short_description}</p>
                      <p className="text-xs text-muted-foreground mt-3">{course.modality === 'presencial' ? 'Presencial' : 'Online'}{course.duration ? ` · ${course.duration}` : ''}</p>
                      <Link to={coursePath(course)} className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-primary mt-5">
                        Ver curso <ArrowRight className="w-4 h-4" />
                      </Link>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
}
