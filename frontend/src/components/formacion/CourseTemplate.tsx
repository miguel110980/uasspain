import { ArrowLeft, BookOpen, Clock, GraduationCap, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import Navbar from '@/components/layout/Navbar';
import Footer from '@/components/layout/Footer';
import SeoHead from '@/components/seo/SeoHead';
import { SITE } from '@/lib/seoConfig';
import type { Course } from '@/services/contentService';

export default function CourseTemplate({ course }: { course: Course }) {
  const upcoming = course.status !== 'published' || course.content_available === false;
  const description = upcoming ? '' : [...new Set([course.introduction?.trim(), course.description?.trim() || course.short_description?.trim()].filter(Boolean))].join('\n\n');
  const sections = upcoming ? [] : course.sections || [];
  return <div className="min-h-screen bg-background text-foreground">
    <SeoHead title={`${course.name} | UASSPAIN`} noindex={upcoming} description={course.short_description || description || course.name} jsonLd={{ '@context': 'https://schema.org', '@type': 'Course', name: course.name, description: course.short_description || description, url: `${SITE.url}/formacion/${course.slug}`, provider: { '@type': 'Organization', name: SITE.name, url: SITE.url } }} />
    <Navbar />
    <main className="public-content pt-28 pb-24 min-w-0 break-words">
      <div className="max-w-5xl mx-auto px-6">
        <Link to="/formacion" className="inline-flex items-center gap-2 text-xs uppercase tracking-widest text-primary mb-8"><ArrowLeft className="w-4 h-4" />Formación</Link>
        <section className="glass-card overflow-hidden">
          {course.cover_image_url && <img src={course.cover_image_url} alt={`Portada de ${course.name}`} className="w-full max-h-[480px] object-cover" />}
          <div className="p-6 md:p-10">
            <span className="inline-flex items-center gap-2 px-3 py-1 border border-primary/30 text-primary text-xs uppercase tracking-widest"><GraduationCap className="w-4 h-4" />Formación UAS</span>
            <h1 className="font-heading text-4xl md:text-6xl font-bold tracking-tight mt-5">{course.name}</h1>
            <dl className="grid sm:grid-cols-2 gap-4 my-8">
              <div className="glass-card p-5"><Users className="w-5 h-5 text-primary mb-2" /><dt className="text-xs uppercase tracking-widest text-muted-foreground">Modalidad</dt><dd className="font-heading font-bold mt-1">{course.modality === 'presencial' ? 'Presencial' : 'Online'}</dd></div>
              <div className="glass-card p-5"><Clock className="w-5 h-5 text-primary mb-2" /><dt className="text-xs uppercase tracking-widest text-muted-foreground">Duración</dt><dd className="font-heading font-bold mt-1">{course.duration || 'Sin especificar'}</dd></div>
            </dl>
            {upcoming ? <div className="border border-warning/30 rounded p-6"><h2 className="font-heading text-xl text-warning">Próximamente</h2><p className="text-muted-foreground mt-2">El curso aparecerá disponible cuando sea publicado.</p></div> : <>
            <section><h2 className="font-heading text-2xl font-bold mb-3">Descripción</h2><p className="whitespace-pre-wrap text-muted-foreground leading-relaxed">{description}</p></section>
            <section className="mt-10"><h2 className="font-heading text-2xl font-bold mb-5 inline-flex items-center gap-2"><BookOpen className="w-5 h-5 text-primary" />Temario</h2>
              {course.syllabus && <p className="whitespace-pre-wrap text-muted-foreground leading-relaxed mb-5">{course.syllabus}</p>}
              <ol className="space-y-5">{sections.map((section, index) => <li key={section.id} className="border-t border-border pt-5"><div className="flex items-start gap-3"><span className="shrink-0 w-8 h-8 flex items-center justify-center border border-primary/30 text-primary font-mono text-xs">{String(index + 1).padStart(2, '0')}</span><h3 className="font-heading text-xl font-bold">{section.title}</h3></div>{section.body && <p className="whitespace-pre-wrap text-muted-foreground leading-relaxed mt-3">{section.body}</p>}</li>)}</ol>
              {!sections.length && !course.syllabus && <p className="text-muted-foreground">El temario se está preparando.</p>}
            </section>
            </>}
          </div>
        </section>
      </div>
    </main>
    <Footer />
  </div>;
}
