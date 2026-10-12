import { Navigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import Navbar from '@/components/layout/Navbar';
import Footer from '@/components/layout/Footer';
import SeoHead from '@/components/seo/SeoHead';
import contentService from '@/services/contentService';
import { ServicePresentation } from '@/lib/servicePresentation';

export default function ServicioDinamico() {
  const { slug = '' } = useParams();
  const query = useQuery({ queryKey: ['public', 'service', slug], queryFn: () => contentService.publicService(slug), staleTime: 0, retry: false });
  const missing = (query.error as { response?: { status?: number } })?.response?.status === 404;
  const service = missing ? undefined : query.data;
  if (service && service.slug !== slug) return <Navigate to={`/servicios/${service.slug}`} replace />;
  return <div className="min-h-screen bg-background text-foreground"><Navbar /><main className="public-content">{missing && <SeoHead title="Servicio no disponible | UASSPAIN" noindex />}
    {service ? <><SeoHead noindex={false} title={service.seo.title || `${service.title} | UASSPAIN`} description={service.seo.description || service.short_description} keywords={service.seo.keywords} /><ServicePresentation service={service} />{service.image_url && <div className="max-w-7xl mx-auto px-6 pb-16"><img src={service.image_url} alt={service.title} className="w-full max-h-[600px] object-cover" /></div>}</> : <section className="min-h-[55vh] pt-32 px-6 text-center"><h1 className="font-heading text-3xl">{missing ? 'Servicio no disponible' : query.isError ? 'No se pudo cargar el servicio' : 'Cargando servicio…'}</h1>{query.isError && !missing && <button onClick={() => void query.refetch()} className="mt-6 text-primary">Reintentar</button>}</section>}
    {query.isError && service && <p role="alert" className="px-6 text-danger">{missing ? 'Este servicio ya no está publicado.' : 'No se ha podido actualizar el servicio.'}</p>}
  </main><Footer /></div>;
}
