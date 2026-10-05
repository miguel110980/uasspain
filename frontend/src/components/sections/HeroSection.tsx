import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ChevronDown, Shield, Cpu, Globe } from 'lucide-react';
import { IMAGES } from '@/lib/images';

const badges = [
  { icon: Shield, text: 'Certificado AESA' },
  { icon: Cpu, text: 'Tecnología RTK' },
  { icon: Globe, text: 'Cobertura Nacional' },
];

// All responsive variants belong to the same existing photo, in both themes.
const heroImage = IMAGES.hero.replace('hero_', 'hero-').replace('.webp', '');

export default function HeroSection() {
  return (
    <section id="inicio" className="relative min-h-screen w-full flex flex-col items-center justify-center overflow-hidden bg-background">
      <div className="absolute inset-0">
        <picture>
          <source media="(max-width: 767px)" srcSet={`${heroImage}-portrait-320.webp 320w, ${heroImage}-portrait-472.webp 472w`} sizes="100vw" />
          <img src={IMAGES.hero} srcSet={`${heroImage}-640.webp 640w, ${heroImage}-1280.webp 1280w, ${heroImage}-1672.webp 1672w`} sizes="100vw" width={1672} height={941} alt="Drone aéreo profesional" fetchPriority="high" className="hero-image w-full h-full object-cover opacity-55 dark:opacity-65" />
        </picture>
        <div className="hero-shade absolute inset-0 bg-gradient-to-b from-background/45 via-background/15 to-background" />
        <div className="hero-side-shade absolute inset-0 bg-gradient-to-r from-background/40 via-transparent to-background/40" />
      </div>

      <div className="absolute inset-0 pointer-events-none select-none overflow-hidden flex items-center justify-center" aria-hidden="true">
        <div className="hero-radar absolute w-[500px] h-[500px] rounded-full">
          <div className="hero-radar-sweep" />
          <svg className="absolute inset-0 w-full h-full" viewBox="0 0 500 500" fill="none">
            <g stroke="var(--radar-line)" strokeWidth="1">
              <circle cx="250" cy="250" r="249" />
              <circle cx="250" cy="250" r="180" />
              <circle cx="250" cy="250" r="100" />
              <path d="M250 4v12M250 484v12M4 250h12M484 250h12M75 75l8 8M425 75l-8 8M425 425l-8-8M75 425l8-8" />
            </g>
            <path d="M250 20v460M20 250h460" stroke="var(--radar-soft)" strokeWidth="1" />
            <g fill="var(--radar-dot)">
              <circle cx="130" cy="450" r="3" />
              <circle cx="385" cy="445" r="3" />
              <circle cx="250" cy="480" r="2.5" />
            </g>
          </svg>
        </div>
        <div className="hero-radar-outer absolute w-[800px] h-[800px] border rounded-full" />
        <div className="absolute top-0 left-1/4 w-px h-full bg-gradient-to-b from-transparent via-primary/8 to-transparent" />
        <div className="absolute inset-0 scanline opacity-20" />
      </div>

      <div className="relative z-10 w-full max-w-7xl mx-auto px-6 pt-28 pb-16 flex flex-col items-center text-center">
        <div
          className="hero-copy"
        >
          <h1 className="font-heading text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold text-foreground leading-[1] tracking-tighter mb-5">
            SOLUCIONES{' '}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary via-cyan-300 to-blue-400 text-glow-cyan">
              AÉREAS
            </span>
            <br />
            <span className="text-foreground/55">INTELIGENTES</span>
          </h1>

          <p className="text-base md:text-lg text-muted-foreground max-w-2xl mx-auto mb-10 font-light leading-relaxed">
            Tecnología aeronáutica de vanguardia aplicada a seguridad, emergencias,
            inspección técnica y producción audiovisual profesional.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center mb-12">
            <Link
              to="/contacto"
              className="inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground px-8 py-4 font-bold uppercase tracking-tighter text-sm hover:bg-primary/80 transition-all duration-300 group"
            >
              Solicitar Servicio
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </Link>
            <a
              href="#servicios"
              className="inline-flex items-center justify-center gap-2 border border-border-strong text-foreground px-8 py-4 font-bold uppercase tracking-tighter text-sm hover:border-primary/50 hover:text-primary transition-all duration-300"
            >
              Explorar Servicios
            </a>
          </div>

          <div className="flex flex-wrap justify-center gap-4 mb-16">
            {badges.map(({ icon: Icon, text }) => (
              <div key={text} className="inline-flex items-center gap-2 px-4 py-2 border border-border-strong bg-surface-subtle text-xs font-mono text-muted-foreground">
                <Icon className="w-3.5 h-3.5 text-primary" />
                {text}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div
        className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2"
      >
        <ChevronDown className="w-4 h-4 text-primary/40 animate-bounce" />
        <span className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground/40">Desplazar</span>
      </div>
    </section>
  );
}
