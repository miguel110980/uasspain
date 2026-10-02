import React from 'react';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { ArrowRight, ChevronDown, Shield, Cpu, Globe } from 'lucide-react';
import { useTheme } from 'next-themes';

const badges = [
  { icon: Shield, text: 'Certificado AESA' },
  { icon: Cpu, text: 'Tecnología RTK' },
  { icon: Globe, text: 'Cobertura Nacional' },
];

export default function HeroSection({ bgImageLight, bgImageDark }) {
  const { resolvedTheme } = useTheme();
  const bgImage = (resolvedTheme || 'dark') === 'dark' ? bgImageDark : bgImageLight;
  return (
    <section id="inicio" className="relative min-h-screen w-full flex flex-col items-center justify-center overflow-hidden bg-background">
      <div className="absolute inset-0">
        <img src={bgImage} alt="Drone aéreo profesional" fetchPriority="high" className="hero-image w-full h-full object-cover opacity-55 dark:opacity-65" />
        <div className="hero-shade absolute inset-0 bg-gradient-to-b from-background/45 via-background/15 to-background" />
        <div className="hero-side-shade absolute inset-0 bg-gradient-to-r from-background/40 via-transparent to-background/40" />
      </div>

      <div className="absolute inset-0 pointer-events-none overflow-hidden flex items-center justify-center">
        <div className="absolute w-[500px] h-[500px] border border-primary/8 rounded-full animate-pulse-glow" />
        <div className="absolute w-[800px] h-[800px] border border-primary/4 rounded-full" />
        <div className="absolute top-0 left-1/4 w-px h-full bg-gradient-to-b from-transparent via-primary/8 to-transparent" />
        <div className="absolute inset-0 scanline opacity-20" />
      </div>

      <div className="relative z-10 w-full max-w-7xl mx-auto px-6 pt-28 pb-16 flex flex-col items-center text-center">
        <motion.div
          initial={false}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
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
        </motion.div>
      </div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.2 }}
        className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2"
      >
        <ChevronDown className="w-4 h-4 text-primary/40 animate-bounce" />
        <span className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground/40">Desplazar</span>
      </motion.div>
    </section>
  );
}
