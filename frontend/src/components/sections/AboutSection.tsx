import React from 'react';
import { motion } from 'framer-motion';
import useScrollReveal from '@/hooks/useScrollReveal';
import { ShieldCheck, Award, Users, Target } from 'lucide-react';

const features = [
  { icon: ShieldCheck, title: 'Seguridad Operacional', desc: 'Protocolos EASA y normativa europea vigente en todas nuestras operaciones.' },
  { icon: Award, title: 'Pilotos Certificados', desc: 'Equipo con certificaciones STS, A1/A3 y licencias específicas AESA.' },
  { icon: Users, title: 'Equipo Experto', desc: 'Profesionales con más de 10 años de experiencia en el sector aeronáutico.' },
  { icon: Target, title: 'Precisión Milimétrica', desc: 'Tecnología RTK y PPK para resultados con precisión submilimétrica.' },
];

export default function AboutSection({ aboutImage }) {
  const { ref, isVisible } = useScrollReveal(0.1);

  return (
    <section id="nosotros" className="relative py-24 md:py-32 bg-background overflow-hidden">
      {/* Background decoration */}
      <div className="absolute top-0 right-0 w-1/2 h-full bg-gradient-to-l from-primary/3 to-transparent pointer-events-none" />
      
      <div ref={ref} className="max-w-7xl mx-auto px-6">
        <div className="grid lg:grid-cols-2 gap-16 items-center">
          {/* Image Side */}
          <motion.div
            initial={{ opacity: 0, x: -40 }}
            animate={isVisible ? { opacity: 1, x: 0 } : {}}
            transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
            className="relative"
          >
            <div className="relative overflow-hidden">
              <img
                src={aboutImage}
                loading="lazy"
                width={1280}
                height={720}
                alt="Centro de operaciones UASSPAIN"
                className="w-full aspect-video object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-background/60 to-transparent" />
              <div className="absolute inset-0 border border-primary/10" />
            </div>
            {/* Floating stat card */}
            <div className="absolute -bottom-6 -right-4 md:right-8 glass-card p-5 glow-border-cyan">
              <div className="font-heading text-3xl font-bold text-primary text-glow-cyan">+10</div>
              <div className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Años de Experiencia</div>
            </div>
          </motion.div>

          {/* Content Side */}
          <motion.div
            initial={{ opacity: 0, x: 40 }}
            animate={isVisible ? { opacity: 1, x: 0 } : {}}
            transition={{ duration: 0.8, delay: 0.2 }}
          >
            <div className="inline-flex items-center gap-2 mb-6 px-3 py-1.5 border border-primary/20 bg-primary/5 text-primary text-xs font-mono uppercase tracking-widest">
              Quiénes Somos
            </div>
            <h2 className="font-heading text-4xl md:text-5xl font-bold text-foreground tracking-tight mb-6">
              Líderes en{' '}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-blue-500">
                Operaciones Aéreas
              </span>
            </h2>
            <p className="text-muted-foreground leading-relaxed mb-8">
              UASSPAIN es una empresa española especializada en servicios profesionales
              con drones. Combinamos tecnología de vanguardia, experiencia aeronáutica y un
              compromiso absoluto con la seguridad para ofrecer soluciones aéreas de alta precisión
              a empresas, instituciones y organismos públicos en todo el territorio nacional.
            </p>

            <div className="grid sm:grid-cols-2 gap-4">
              {features.map((f, i) => (
                <motion.div
                  key={f.title}
                  initial={{ opacity: 0, y: 20 }}
                  animate={isVisible ? { opacity: 1, y: 0 } : {}}
                  transition={{ duration: 0.5, delay: 0.3 + i * 0.1 }}
                  className="group p-4 border border-border-subtle hover:border-primary/20 bg-surface-subtle hover:bg-primary/5 transition-all duration-300"
                >
                  <f.icon className="w-5 h-5 text-primary mb-3 group-hover:scale-110 transition-transform" />
                  <h3 className="font-heading text-sm font-semibold text-foreground mb-1">{f.title}</h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">{f.desc}</p>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}