import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useTheme } from 'next-themes';
import { getSeoForPath, organizationJsonLd, SITE } from '@/lib/seoConfig';

const PRIVATE_PREFIXES = ['/admin', '/instructor', '/alumno', '/elegir-panel'];

function upsertMeta(attr, key, content) {
  if (!content) return;
  let el = document.querySelector(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function upsertLink(rel, href) {
  if (!href) return;
  let el = document.querySelector(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', rel);
    document.head.appendChild(el);
  }
  el.setAttribute('href', href);
}

function upsertJsonLd(id, data) {
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement('script');
    el.setAttribute('type', 'application/ld+json');
    el.id = id;
    document.head.appendChild(el);
  }
  el.textContent = JSON.stringify(data);
}

/**
 * Actualiza title, meta description, Open Graph, Twitter y JSON-LD según la ruta.
 */
/** @param {{ title?: string, description?: string, keywords?: string, canonical?: string, noindex?: boolean, jsonLd?: object }} [props] */
type SeoHeadProps = { title?: string; description?: string; keywords?: string; canonical?: string; noindex?: boolean; jsonLd?: object };

export default function SeoHead({ title, description, keywords, canonical, noindex, jsonLd }: SeoHeadProps = {}) {
  const { pathname } = useLocation();
  const { theme } = useTheme();
  const isPrivate = PRIVATE_PREFIXES.some((p) => pathname.startsWith(p));
  const routeSeo = getSeoForPath(pathname);

  const finalTitle = title || routeSeo.title;
  const finalDescription = description || routeSeo.description;
  const finalKeywords = keywords || routeSeo.keywords;
  const finalCanonical = canonical || routeSeo.canonical;
  const blockIndex = noindex ?? routeSeo.noindex ?? isPrivate;

  useEffect(() => {
    document.title = finalTitle;
    upsertMeta('name', 'description', finalDescription);
    upsertMeta('name', 'keywords', finalKeywords);
    upsertMeta('name', 'robots', blockIndex ? 'noindex, nofollow' : 'index, follow, max-image-preview:large');
    upsertMeta('name', 'author', SITE.name);
    upsertMeta('name', 'theme-color', theme === 'dark' ? '#0a0a0a' : '#F8FAFC');

    upsertMeta('property', 'og:type', 'website');
    upsertMeta('property', 'og:site_name', SITE.name);
    upsertMeta('property', 'og:title', finalTitle);
    upsertMeta('property', 'og:description', finalDescription);
    upsertMeta('property', 'og:url', finalCanonical);
    upsertMeta('property', 'og:locale', SITE.locale);
    upsertMeta('property', 'og:image', `${SITE.url}${SITE.ogImage}`);

    upsertMeta('name', 'twitter:card', 'summary_large_image');
    upsertMeta('name', 'twitter:site', SITE.twitter);
    upsertMeta('name', 'twitter:title', finalTitle);
    upsertMeta('name', 'twitter:description', finalDescription);
    upsertMeta('name', 'twitter:image', `${SITE.url}${SITE.ogImage}`);

    upsertLink('canonical', finalCanonical);

    if (!isPrivate) {
      upsertJsonLd('seo-org-jsonld', jsonLd || organizationJsonLd());
    }
  }, [finalTitle, finalDescription, finalKeywords, finalCanonical, blockIndex, isPrivate, jsonLd, theme]);

  return null;
}
