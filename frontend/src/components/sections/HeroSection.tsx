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
        <svg className="hero-radar" fill="none" focusable="false">
          <defs>
            <linearGradient id="hero-radar-sector" x1="830" y1="145" x2="922" y2="211" gradientUnits="userSpaceOnUse">
              <stop stopColor="currentColor" stopOpacity="0.5" />
              <stop offset="1" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="hero-radar-ray" x1="684" y1="541" x2="886" y2="137" gradientUnits="userSpaceOnUse">
              <stop stopColor="currentColor" stopOpacity="0" />
              <stop offset="0.65" stopColor="currentColor" stopOpacity="0.85" />
              <stop offset="1" stopColor="currentColor" stopOpacity="0.45" />
            </linearGradient>
            <filter id="hero-radar-glow" x="-100%" y="-100%" width="300%" height="300%">
              <feGaussianBlur stdDeviation="3" />
            </filter>
            <radialGradient id="hero-radar-flare">
              <stop stopColor="currentColor" stopOpacity="0.8" />
              <stop offset="0.16" stopColor="currentColor" stopOpacity="0.45" />
              <stop offset="1" stopColor="currentColor" stopOpacity="0" />
            </radialGradient>
            {/* Occlude the overlay with the silhouette in the existing photo's coordinates. */}
            <path id="hero-drone-silhouette" d="M593 222l7-36q19-12 40 0l8 31 149-7q22-20 57-18l26 9 6-20q21-12 35 3l4 39 120-8 3-32q19-8 33 7l2 50-14 11-4 31-11-24-115-11-22 14-12 23-50 1 3 32-38 13-38-18-4-32-35-28-95-8-12 37-14-6v-34z" />
            <mask id="hero-radar-drone-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="100%" height="100%">
              <rect width="100%" height="100%" fill="white" />
              <svg className="hero-radar-mask-desktop" width="100%" height="100%" viewBox="0 0 1672 941" preserveAspectRatio="xMidYMid slice">
                <use href="#hero-drone-silhouette" fill="black" />
              </svg>
              <svg className="hero-radar-mask-mobile" width="100%" height="100%" viewBox="600 0 472 941" preserveAspectRatio="xMidYMid slice">
                <use href="#hero-drone-silhouette" fill="black" />
              </svg>
            </mask>
          </defs>
          <g mask="url(#hero-radar-drone-mask)">
            <svg className="hero-radar-dial" width="100%" height="100%" viewBox="0 0 1395 1127">
              <g stroke="currentColor" strokeWidth="1.2">
                <ellipse cx="680" cy="542" rx="510" ry="480" opacity="0.25" />
                <ellipse cx="680" cy="542" rx="480" ry="457" opacity="0.6" />
                <ellipse cx="680" cy="542" rx="440" ry="428" strokeDasharray="0.1 12" strokeLinecap="round" strokeWidth="2" opacity="0.8" />
                <ellipse cx="680" cy="542" rx="393" ry="387" opacity="0.55" />
                <ellipse cx="680" cy="542" rx="313" ry="281" strokeDasharray="0.1 5" strokeLinecap="round" opacity="0.4" />
                <ellipse cx="680" cy="542" rx="284" ry="278" opacity="0.5" />
                <ellipse cx="680" cy="542" rx="250" ry="247" strokeDasharray="0.1 5" strokeLinecap="round" opacity="0.35" />
              </g>
              <g stroke="currentColor" strokeWidth="1.3" opacity="0.45">
                <path d="M685 99l-2 899M186 540l987 2" />
                <path d="M675 114h24M676 155h16M675 920h16M675 968h15M209 463h8M207 616h10M1142 466h12M1141 616h13M263 393h13M1086 395h13M1085 686h14M262 684h12" />
              </g>
              <g className="hero-radar-sweep">
                <circle cx="830" cy="231" r="42" fill="url(#hero-radar-flare)" />
                <path d="M816 285L886 137A480 457 0 0 1 960 178L860 313A284 278 0 0 0 816 285Z" fill="url(#hero-radar-sector)" />
                <path d="M806 282L857 194" stroke="currentColor" strokeWidth="6" opacity="0.8" filter="url(#hero-radar-glow)" />
                <path d="M684 541L886 137" stroke="url(#hero-radar-ray)" strokeWidth="2" />
              </g>
              <g stroke="currentColor" strokeWidth="2" opacity="0.85">
                <path d="M200 616Q187 542 203 466M208 616Q196 542 211 467M1155 468Q1166 542 1154 616M1148 468Q1158 542 1147 615M383 170Q442 135 500 120M918 144Q953 161 979 184M1087 822l-41 50" />
              </g>
              <g stroke="currentColor" strokeWidth="1.5" opacity="0.8">
                <rect x="253" y="267" width="10" height="10" />
                <rect x="142" y="537" width="10" height="5" />
                <rect x="1206" y="539" width="11" height="5" />
                <rect x="684" y="86" width="3" height="6" opacity="0.5" />
                <rect x="681" y="989" width="5" height="6" opacity="0.5" />
              </g>
              <g fill="currentColor" filter="url(#hero-radar-glow)">
                <circle cx="830" cy="231" r="8" />
                <circle cx="927" cy="365" r="7" />
                <circle cx="1109" cy="277" r="4" />
                <circle cx="999" cy="922" r="4" />
              </g>
              <g className="hero-radar-nodes">
                <circle cx="830" cy="231" r="4" />
                <circle cx="927" cy="365" r="3.5" />
              </g>
              <g fill="currentColor" opacity="0.9">
                <circle cx="1109" cy="277" r="2.8" />
                <circle cx="999" cy="922" r="3.5" />
                <circle cx="685" cy="155" r="2" />
              </g>
            </svg>
          </g>
        </svg>
      </div>

      <div className="hero-content relative z-10 w-full max-w-7xl mx-auto px-6 pt-28 pb-16 flex flex-col items-center text-center">
        <div
          className="hero-copy"
        >
          <h1 className="hero-title font-heading font-bold mb-5">
            <span className="hero-title-line">
              SOLUCIONES{' '}<span className="hero-title-cyan">AÉREAS</span>
            </span>
            <span className="hero-title-line hero-title-second">INTELIGENTES</span>
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
