import { Award, ArrowRight, CheckCircle, ChevronLeft, Clock, GraduationCap, Plane, RadioTower, Shield, Siren, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import Navbar from '@/components/layout/Navbar';
import Footer from '@/components/layout/Footer';
import SeoHead from '@/components/seo/SeoHead';
import { SITE } from '@/lib/seoConfig';
import { courseCategoryLabel, coursePath } from '@/lib/courseCategories';
import { courseModalityLabel } from '@/lib/courseModalities';
import type { Course } from '@/services/contentService';

const COURSE_ICONS = { GraduationCap, Plane, RadioTower, Shield, Siren };
const relativeLink = (href: string | undefined, fallback: string) => href?.startsWith('/') && !href.startsWith('//') ? href : fallback;

export default function CourseTemplate({ course }: { course: Course }) {
  const upcoming = course.status !== 'published' || course.content_available === false;
  const presentation = course.presentation || {};
  const originalName = course.name === presentation.original_name;
  const parts = originalName ? presentation.hero_parts : undefined;
  const description = upcoming ? '' : [...new Set([course.introduction?.trim(), course.description?.trim() || course.short_description?.trim()].filter(Boolean))].join('\n\n');
  const sections = upcoming ? [] : course.sections || [];
  const Icon = COURSE_ICONS[presentation.icon] || GraduationCap;
  const format = course.modality === presentation.original_modality && presentation.format_label
    ? presentation.format_label : courseModalityLabel(course.modality);
  const seoTitle = originalName && presentation.seo?.title ? presentation.seo.title : `${course.name} | UASSPAIN`;
  const seoDescription = course.short_description === presentation.original_summary && presentation.seo?.description
    ? presentation.seo.description : course.short_description || description || course.name;
  const cta = presentation.cta;
  return (
    <div className="min-h-screen bg-background text-foreground">
      <SeoHead title={seoTitle} description={seoDescription} keywords={presentation.seo?.keywords} noindex={upcoming}
        jsonLd={{ '@context': 'https://schema.org', '@type': 'Course', name: course.name, description: course.short_description || description, url: `${SITE.url}${coursePath(course)}`, provider: { '@type': 'Organization', name: SITE.name, url: SITE.url } }} />
      <Navbar />
      <main className="public-content min-w-0 break-words">
        <section className="relative min-h-[55vh] flex items-center justify-center overflow-hidden bg-background pt-24">
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute inset-0 bg-gradient-to-b from-background/60 via-background/40 to-background" />
            <div className="absolute inset-0 scanline opacity-10" />
            <div className="absolute top-0 left-1/4 w-px h-full bg-gradient-to-b from-transparent via-primary/8 to-transparent" />
            <div className="absolute top-0 right-1/4 w-px h-full bg-gradient-to-b from-transparent via-primary/5 to-transparent" />
            <div className="absolute w-[600px] h-[600px] border border-primary/5 rounded-full left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" />
          </div>
          <div className="relative z-10 max-w-7xl mx-auto px-6 text-center">
            <Link to={relativeLink(presentation.back?.href, '/formacion')} className="inline-flex items-center gap-2 mb-8 text-xs font-mono uppercase tracking-widest text-muted-foreground hover:text-primary transition-colors">
              <ChevronLeft className="w-3.5 h-3.5 shrink-0" />{presentation.back?.label || 'Volver a Formación'}
            </Link>
            <div>
              <span className="inline-flex items-center gap-2 mb-6 px-3 py-1.5 border border-primary/20 bg-primary/5 text-primary text-xs font-mono uppercase tracking-widest">
                <Icon className="w-3.5 h-3.5 shrink-0" />{presentation.badge || courseCategoryLabel(course.category)}
              </span>
              <h1 className="font-heading text-4xl sm:text-5xl md:text-6xl font-bold text-foreground tracking-tight mb-6">
                {parts?.length ? parts.map((part, index) => <span key={index} className={part.highlight ? 'text-transparent bg-clip-text bg-gradient-to-r from-primary via-cyan-300 to-blue-400 text-glow-cyan' : undefined}>{index > 0 && ' '}{part.text}</span>) : course.name}
              </h1>
              <p className="text-base md:text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">{course.short_description}</p>
              {course.cover_image_url && <img src={course.cover_image_url} alt={`Portada de ${course.name}`} className="w-full max-h-[480px] object-cover mt-8 rounded-lg" />}
            </div>
          </div>
        </section>
        <section className="py-12 bg-background">
          <div className="max-w-7xl mx-auto px-6">
            <dl className={`grid gap-6 ${presentation.certification ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
              <div className="glass-card p-6 text-center"><Clock className="w-6 h-6 text-primary mx-auto mb-3" /><dt className="text-xs text-muted-foreground uppercase tracking-widest mb-1">Duración</dt><dd className="font-heading text-lg font-bold text-foreground">{course.duration || 'Sin especificar'}</dd></div>
              <div className="glass-card p-6 text-center"><Users className="w-6 h-6 text-primary mx-auto mb-3" /><dt className="text-xs text-muted-foreground uppercase tracking-widest mb-1">{presentation.format_label ? 'Formato' : 'Modalidad'}</dt><dd className="font-heading text-lg font-bold text-foreground">{format}</dd></div>
              {presentation.certification && <div className="glass-card p-6 text-center"><Award className="w-6 h-6 text-primary mx-auto mb-3" /><dt className="text-xs text-muted-foreground uppercase tracking-widest mb-1">Certificación</dt><dd className="font-heading text-lg font-bold text-foreground">{presentation.certification}</dd></div>}
            </dl>
          </div>
        </section>
        <section className="py-20 md:py-24 bg-background">
          <div className="max-w-7xl mx-auto px-6">
            {upcoming ? <div className="glass-card p-8"><h2 className="font-heading text-xl text-warning">Próximamente</h2><p className="text-muted-foreground mt-2">El curso aparecerá disponible cuando sea publicado.</p></div> : (
              <div className="grid lg:grid-cols-2 gap-16 items-start">
                <section>
                  <h2 className="font-heading text-3xl md:text-4xl font-bold text-foreground tracking-tight mb-6">{presentation.description_heading || 'Descripción'}</h2>
                  <p className="whitespace-pre-wrap text-muted-foreground leading-relaxed">{description}</p>
                </section>
                <section className="glass-card p-8">
                  <h2 className="font-heading text-sm font-bold text-foreground uppercase tracking-widest mb-6">{presentation.topics_heading || 'Temario'}</h2>
                  {course.syllabus && <p className="whitespace-pre-wrap text-muted-foreground leading-relaxed mb-5">{course.syllabus}</p>}
                  <ol className="space-y-5">{sections.map(section => (
                    <li key={section.id} className="flex items-start gap-3">
                      <CheckCircle className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                      <div className="min-w-0"><h3 className="text-sm font-medium text-foreground">{section.title}</h3>{section.body && <p className="whitespace-pre-wrap text-xs text-muted-foreground mt-0.5 leading-relaxed">{section.body}</p>}</div>
                    </li>
                  ))}</ol>
                  {!sections.length && !course.syllabus && <p className="text-muted-foreground">El temario se está preparando.</p>}
                </section>
              </div>
            )}
          </div>
        </section>
        {!upcoming && <section className="py-16 bg-card border-y border-border-subtle">
          <div className="max-w-7xl mx-auto px-6 text-center">
            <h2 className="font-heading text-2xl md:text-3xl font-bold text-foreground mb-4">{cta?.heading || '¿Quieres más información sobre este curso?'}</h2>
            <p className="text-muted-foreground mb-8 max-w-xl mx-auto">{cta?.description || 'Contacta con nosotros para información sobre próximas convocatorias, precios y disponibilidad.'}</p>
            <Link to={relativeLink(cta?.href, '/contacto')} className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-8 py-4 font-bold uppercase tracking-tighter text-sm hover:bg-primary/80 transition-all duration-300 group">
              {cta?.label || 'Solicitar Información'}<ArrowRight className="w-4 h-4 shrink-0 group-hover:translate-x-1 transition-transform" />
            </Link>
          </div>
        </section>}
      </main>
      <Footer />
    </div>
  );
}
