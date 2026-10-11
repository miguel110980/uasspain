export const SITE = {
  name: 'UASSPAIN',
  url: (import.meta.env.VITE_SITE_URL || 'https://uas-spain.com').replace(/\/+$/, ''),
  locale: 'es_ES',
  defaultTitle: 'UASSPAIN — Formación de Pilotos de Drones y Servicios UAS',
  defaultDescription:
    'Centro de formación certificado AESA para pilotos de drones (A1/A3, A2, STS). Cursos teóricos y prácticos, operaciones profesionales, inspección, termografía y emergencias con UAS en toda España.',
  defaultKeywords:
    'drones, UAS, RPAS, formación drones, piloto drones, AESA, certificado A1 A3, A2, STS, inspección drones, termografía, UASSPAIN',
  ogImage: '/images/hero_claro.webp',
};

/** Metadatos SEO por ruta pública */
export const ROUTE_SEO = {
  '/': {
    title: 'UASSPAIN — Formación de Pilotos de Drones Certificada AESA',
    description: SITE.defaultDescription,
    keywords: 'formación drones España, curso piloto dron, certificación AESA, operador UAS',
  },
  '/nosotros': {
    title: 'Nosotros | UASSPAIN — Expertos en Formación y Operaciones con Drones',
    description: 'Conoce UASSPAIN: equipo instructor certificado, experiencia operativa y compromiso con la seguridad aérea y la excelencia en formación UAS.',
  },
  '/formacion': {
    title: 'Todos los cursos | UASSPAIN — Formación UAS',
    description: 'Programas publicados y próximas convocatorias de formación UAS administrados desde UASSpain.',
  },
  '/tecnologia': {
    title: 'Tecnología UAS | UASSPAIN — Drones, RTK y Sistemas Avanzados',
    description: 'Tecnología de vanguardia en operaciones con drones: RTK, sensores multiespectrales, plataformas certificadas y software de gestión de flotas.',
  },
  '/blog': {
    title: 'Blog | UASSPAIN — Noticias y Recursos sobre Drones',
    description: 'Artículos, normativa, consejos de formación y novedades del sector de drones y operaciones UAS en España.',
  },
  '/contacto': {
    title: 'Contacto | UASSPAIN — Solicita Información o Presupuesto',
    description: 'Contacta con UASSPAIN para formación de pilotos, servicios de inspección, termografía, seguridad y operaciones con drones.',
  },
  '/politica-privacidad': {
    title: 'Política de Privacidad | UASSPAIN',
    description: 'Información sobre el tratamiento de datos personales conforme al RGPD en la plataforma UASSPAIN.',
    noindex: true,
  },
  '/aviso-legal': {
    title: 'Aviso Legal | UASSPAIN',
    description: 'Aviso legal y condiciones de uso del sitio web y plataforma UASSPAIN.',
    noindex: true,
  },
  '/politica-cookies': {
    title: 'Política de Cookies | UASSPAIN',
    description: 'Información sobre el uso de cookies en uas-spain.com y la plataforma de formación.',
    noindex: true,
  },
  '/restablecer-contrasena': {
    title: 'Restablecer Contraseña | UASSPAIN',
    description: 'Establece una nueva contraseña para acceder a tu cuenta de formación UASSPAIN.',
    noindex: true,
  },
};

export function getSeoForPath(pathname) {
  pathname = pathname === '/' ? pathname : pathname.replace(/\/+$/, '');
  const base = ROUTE_SEO[pathname] || {};
  return {
    title: base.title || SITE.defaultTitle,
    description: base.description || SITE.defaultDescription,
    keywords: base.keywords || SITE.defaultKeywords,
    noindex: base.noindex || (!ROUTE_SEO[pathname]),
    canonical: `${SITE.url}${pathname}`,
  };
}

export function organizationJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: SITE.name,
    url: SITE.url,
    logo: `${SITE.url}/images/logo.webp?v=4`,
    description: SITE.defaultDescription,
    areaServed: 'ES',
    sameAs: [],
  };
}
