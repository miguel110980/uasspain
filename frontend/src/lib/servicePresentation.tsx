import React from 'react';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { Shield, ChevronLeft } from 'lucide-react';
import { SERVICE_ICONS } from './serviceIcons';
import type { ManagedService, ServiceNode } from '@/services/contentService';

const TAGS = { section: 'section', div: 'div', 'motion.div': motion.div, 'motion.li': motion.li, Link, h1: 'h1', h2: 'h2', h3: 'h3', p: 'p', span: 'span', ul: 'ul', li: 'li', ...SERVICE_ICONS };

// Render only whitelisted elements and props. Stored content is text, never HTML
// or executable code. Original structures retain their classes and animations.
export function ServicePresentation({ service }: { service: ManagedService }) {
  const { presentation = {} } = service;
  const originals = presentation.original_description?.split(/\r?\n\r?\n/) || [];
  const paragraphs = service.description.split(/\r?\n\r?\n/);
  const render = (node: ServiceNode, key: string): React.ReactNode => {
    if (typeof node === 'string') {
      const index = originals.indexOf(node);
      if (index >= 0) return paragraphs[index] || '';
      if (node === presentation.original_summary) return service.short_description;
      if (presentation.original_title && node.includes(presentation.original_title)) return node.replace(presentation.original_title, service.title);
      return node;
    }
    const Tag = ['Shield', 'Siren', 'Radio', 'Camera', 'SprayCan', 'ScanLine', 'Thermometer'].includes(node.tag) ? SERVICE_ICONS[service.icon] || TAGS[node.tag] : TAGS[node.tag];
    if (!Tag) return null;
    const props = Object.fromEntries(Object.entries(node.props).filter(([k]) => ['className', 'initial', 'animate', 'transition', 'to', 'whileInView', 'viewport'].includes(k)));
    if (props.to && (typeof props.to !== 'string' || !props.to.startsWith('/') || props.to.startsWith('//'))) delete props.to;
    return React.createElement(Tag, { ...props, key }, ...node.children.map((child, i) => render(child, `${key}.${i}`)));
  };
  if (presentation.layout?.length) return <>{presentation.layout.map((node, i) => render(node, String(i)))}{paragraphs.slice(originals.length).map((text, i) => <p key={i} className="max-w-7xl mx-auto px-6 py-4 text-muted-foreground whitespace-pre-wrap">{text}</p>)}</>;
  const Icon = SERVICE_ICONS[service.icon] || Shield;
  return <>
    <section className="relative min-h-[55vh] flex items-center justify-center overflow-hidden bg-background pt-24"><div className="relative z-10 max-w-7xl mx-auto px-6 text-center"><Link to="/#servicios" className="inline-flex items-center gap-2 mb-8 text-xs font-mono uppercase tracking-widest text-muted-foreground"><ChevronLeft className="w-3.5 h-3.5" />Volver a Servicios</Link><div className="inline-flex items-center gap-2 mb-6 px-3 py-1.5 border border-primary/20 bg-primary/5 text-primary text-xs font-mono uppercase tracking-widest"><Icon className="w-3.5 h-3.5" />{service.title}</div><h1 className="font-heading text-4xl sm:text-5xl md:text-6xl font-bold text-foreground tracking-tight mb-6">{service.title}</h1><p className="text-base md:text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">{service.short_description}</p></div></section>
    <section className="py-20 md:py-24 bg-background"><div className="max-w-7xl mx-auto px-6"><p className="text-muted-foreground leading-relaxed whitespace-pre-wrap">{service.description}</p></div></section>
  </>;
}
