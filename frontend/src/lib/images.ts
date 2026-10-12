/** Rutas locales de imágenes estáticas (public/images). */
export const IMAGES = {
  logo: '/images/logo.webp?v=4',
  hero: '/images/hero_claro.webp',
  about: '/images/about.jpg',
  tech: '/images/tech.jpg',
  blog1: '/images/blog1.jpg',
  blog2: '/images/blog2.jpg',
  blog3: '/images/blog3.jpg',
};

// All parts of the Hero select the same cached photograph, including its
// mirrored landscape edges. Keep these sizes aligned with the HTML preload.
export const HERO_IMAGE = {
  src: IMAGES.hero,
  srcSet: '/images/hero-claro-640.webp 640w, /images/hero-claro-1280.webp 1280w, /images/hero-claro-1672.webp 1672w',
  sizes: '(max-width: 767px) min(201vw, 976px), min(143.6vw, 2004px)',
};
