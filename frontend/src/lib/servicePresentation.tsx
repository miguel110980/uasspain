import React from 'react';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle, ChevronLeft } from 'lucide-react';
import { SERVICE_ICONS, serviceIcon } from './serviceIcons';
import type { ManagedService, ServiceNode } from '@/services/contentService';

type Element = Exclude<ServiceNode, string>;
const elements = (nodes: ServiceNode[], predicate: (node: Element) => boolean): Element[] => nodes.flatMap(node => typeof node === 'string' ? [] : [...(predicate(node) ? [node] : []), ...elements(node.children, predicate)]);
const text = (node: ServiceNode): string => typeof node === 'string' ? node : node.children.map(text).join('');
export const publicServiceLink = (value: unknown): value is string => typeof value === 'string' && (/^\/(contacto|tecnologia|nosotros|formacion)(#[a-z0-9-]+)?$/.test(value) || value === '/#servicios' || /^\/servicios\/[a-z0-9]+(-[a-z0-9]+)*$/.test(value));

// Imported layouts are a data source, never the page template. All services use
// the same hero, description, information cards and optional call-to-action.
// Existing text and highlight spans survive without executing stored JSX/CSS.
export function ServicePresentation({ service }: { service: ManagedService }) {
  const { presentation = {} } = service;
  const originals = presentation.original_description?.split(/\r?\n\r?\n/) || [];
  const paragraphs = service.description.split(/\r?\n\r?\n/);
  const renderInline = (node: ServiceNode, key: string): React.ReactNode => {
    if (typeof node === 'string') {
      const index = originals.indexOf(node);
      if (index >= 0) return paragraphs[index] || '';
      if (node === presentation.original_summary) return service.short_description;
      if (presentation.original_title && node.includes(presentation.original_title)) return node.replace(presentation.original_title, service.title);
      return node;
    }
    if (Object.hasOwn(SERVICE_ICONS, node.tag)) return null;
    // Only the original highlighted text spans are inline presentation data.
    const highlighted = node.tag === 'span' && String(node.props.className || '').includes('text-transparent');
    const highlightClass = ['text-transparent bg-clip-text bg-gradient-to-r from-primary to-blue-500', 'text-transparent bg-clip-text bg-gradient-to-r from-primary via-cyan-300 to-blue-400 text-glow-cyan'].includes(String(node.props.className)) ? String(node.props.className) : 'text-transparent bg-clip-text bg-gradient-to-r from-primary to-blue-500';
    return <React.Fragment key={key}>{highlighted ? <span className={highlightClass}>{node.children.map((child, i) => renderInline(child, `${key}.${i}`))}</span> : node.children.map((child, i) => renderInline(child, `${key}.${i}`))}</React.Fragment>;
  };
  const layout = presentation.layout || [];
  const heroTitle = elements(layout, node => node.tag === 'h1')[0];
  const sections = layout.filter((node): node is Element => typeof node !== 'string' && node.tag === 'section');
  const content = sections.filter(node => !elements([node], n => n.tag === 'h1').length && !String(node.props.className || '').includes('py-16 bg-card'));
  const cta = sections.find(node => String(node.props.className || '').includes('py-16 bg-card'));
  const heading = elements(content, node => node.tag === 'h2')[0];
  const cards = elements(content, node => ['div', 'motion.div'].includes(node.tag) && String(node.props.className || '').split(' ').includes('glass-card'));
  const cardsAfterIntro = elements(content, node => node.tag === 'div' && node.props.className === 'grid md:grid-cols-2 gap-8').length > 0;
  // Custom plain-text blocks, added in the same admin editor, need no new route.
  const extra = content.slice(1);
  const ctaHeading = cta && elements([cta], node => node.tag === 'h2')[0];
  const ctaSummary = cta && elements([cta], node => node.tag === 'p')[0];
  const ctaLink = cta && elements([cta], node => node.tag === 'Link' && publicServiceLink(node.props.to))[0];
  const Icon = serviceIcon(service.icon);
  return <>
    <section data-service-template="hero" className="relative min-h-[55vh] flex items-center justify-center overflow-hidden bg-background pt-24">
      <div className="absolute inset-0 pointer-events-none" aria-hidden="true"><div className="absolute inset-0 bg-gradient-to-b from-background/60 via-background/40 to-background" /><div className="absolute inset-0 scanline opacity-10" /><div className="absolute w-[600px] h-[600px] border border-primary/5 rounded-full left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" /></div>
      <div className="relative z-10 max-w-7xl mx-auto px-6 text-center"><motion.div className="flex flex-col items-center" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
        <Link to="/#servicios" className="inline-flex items-center gap-2 mb-8 text-xs font-mono uppercase tracking-widest text-muted-foreground hover:text-primary transition-colors"><ChevronLeft className="w-3.5 h-3.5" />Volver a Servicios</Link>
        <div className="inline-flex items-center gap-2 mb-6 px-3 py-1.5 border border-primary/20 bg-primary/5 text-primary text-xs font-mono uppercase tracking-widest"><Icon data-service-icon={service.icon} className="w-3.5 h-3.5" />{service.title}</div>
        <h1 className="font-heading text-4xl sm:text-5xl md:text-6xl font-bold text-foreground tracking-tight mb-6">{heroTitle && service.title === presentation.original_title ? heroTitle.children.map((node, i) => renderInline(node, String(i))) : service.title}</h1>
        {service.short_description && <p className="text-base md:text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">{service.short_description}</p>}
      </motion.div></div>
    </section>
    <section data-service-template="content" className="py-20 md:py-24 bg-background"><div className="max-w-7xl mx-auto px-6">
      <div className={cards.length && !cardsAfterIntro ? 'grid lg:grid-cols-2 gap-16 items-start' : ''}>
        <motion.div className={cardsAfterIntro ? 'max-w-3xl mx-auto text-center mb-16' : undefined} initial={cardsAfterIntro ? { opacity: 0, y: 20 } : { opacity: 0, x: -30 }} whileInView={cardsAfterIntro ? { opacity: 1, y: 0 } : { opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ duration: 0.7 }}>
          {heading && <h2 className="font-heading text-3xl md:text-4xl font-bold text-foreground tracking-tight mb-6">{heading.children.map((node, i) => renderInline(node, String(i)))}</h2>}
          <div className="space-y-4">{paragraphs.filter(value => value.trim()).map((value, i) => <p key={i} className="text-muted-foreground leading-relaxed whitespace-pre-wrap">{value}</p>)}</div>
        </motion.div>
        {cards.length > 0 && <motion.div className={cardsAfterIntro ? 'grid md:grid-cols-2 gap-8' : 'space-y-8'} initial={cardsAfterIntro ? { opacity: 0, y: 20 } : { opacity: 0, x: 30 }} whileInView={cardsAfterIntro ? { opacity: 1, y: 0 } : { opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ duration: 0.7 }}>{cards.map((card, i) => <div key={i} className="glass-card p-8">{elements([card], n => n.tag === 'h3').map((title, j) => <h3 key={j} className="font-heading text-sm font-bold text-foreground uppercase tracking-widest mb-6">{renderInline(title, String(j))}</h3>)}<ul className={elements([card], n => n.tag === 'ul' && n.props.className === 'space-y-3').length ? 'space-y-3' : 'space-y-4'}>{elements([card], n => n.tag === 'li' || n.tag === 'motion.li').map((item, j) => <li key={j} className="flex items-start gap-3">{elements([item], n => n.tag === 'span' && n.props.className === 'w-1.5 h-1.5 bg-primary rounded-full mt-2 shrink-0').length ? <span className="w-1.5 h-1.5 bg-primary rounded-full mt-2 shrink-0" /> : <CheckCircle className="w-4 h-4 text-primary mt-0.5 shrink-0" />}<span className="text-sm text-muted-foreground">{renderInline(item, String(j))}</span></li>)}</ul></div>)}</motion.div>}
      </div>
      {extra.map((section, i) => <div key={i} className="mt-16">{elements([section], n => n.tag === 'h2').map((node, j) => <h2 key={j} className="font-heading text-3xl md:text-4xl font-bold mb-6">{renderInline(node, String(j))}</h2>)}{elements([section], n => n.tag === 'p').map((node, j) => <p key={j} className="text-muted-foreground whitespace-pre-wrap leading-relaxed mb-4">{renderInline(node, String(j))}</p>)}</div>)}
    </div></section>
    {cta && <section data-service-template="cta" className="py-16 bg-card border-y border-border-subtle"><div className="max-w-7xl mx-auto px-6 text-center">{ctaHeading && <h2 className="font-heading text-2xl md:text-3xl font-bold text-foreground mb-4">{renderInline(ctaHeading, 'cta.heading')}</h2>}{ctaSummary && <p className="text-muted-foreground mb-8 max-w-xl mx-auto">{renderInline(ctaSummary, 'cta.summary')}</p>}{ctaLink && <Link to={String(ctaLink.props.to)} className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-8 py-4 font-bold uppercase tracking-tighter text-sm hover:bg-primary/80 transition-all duration-300 group">{text(ctaLink)}<ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" /></Link>}</div></section>}
  </>;
}
