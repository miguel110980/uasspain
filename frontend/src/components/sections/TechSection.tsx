import React from 'react';
import useScrollReveal from '@/hooks/useScrollReveal';
import { Brain, Satellite, Navigation, Cpu, Thermometer, Radio, Wifi, Eye } from 'lucide-react';

const techs = [
  { icon: Brain, title: 'Inteligencia Artificial', desc: 'Detección automática de objetos y análisis predictivo en tiempo real.' },
  { icon: Satellite, title: 'RTK / PPK', desc: 'Posicionamiento centimétrico para levantamientos de alta precisión.' },
  { icon: Navigation, title: 'GPS Multi-Constelación', desc: 'Navegación con GPS, GLONASS, Galileo y BeiDou simultáneo.' },
  { icon: Cpu, title: 'Vuelo Autónomo', desc: 'Planificación de misiones y waypoints con ejecución automatizada.' },
  { icon: Thermometer, title: 'Cámaras Térmicas', desc: 'Sensores radiométricos para inspección térmica e industrial.' },
  { icon: Radio, title: 'Sensores Avanzados', desc: 'LiDAR, multiespectrales e hiperespectrales para análisis de datos.' },
  { icon: Wifi, title: 'Enlace en Tiempo Real', desc: 'Transmisión de vídeo y telemetría con latencia inferior a 100ms.' },
  { icon: Eye, title: 'Visión por Computador', desc: 'Rastreo automatizado y reconocimiento de patrones avanzado.' },
];

export default function TechSection({ techImage }) {
  const { ref, isVisible } = useScrollReveal(0.05);

  return (
    <section id="tecnologia" className="relative py-24 md:py-32 bg-card overflow-hidden">
      {/* Decorative line */}
      <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent" />
      <div className="absolute bottom-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent" />

      <div ref={ref} className={`max-w-7xl mx-auto px-6 home-reveal ${isVisible ? 'is-visible' : ''}`}>
        <div className="grid lg:grid-cols-5 gap-12 items-start">
          {/* Left - Image & header */}
          <div
            className="lg:col-span-2"
          >
            <div className="inline-flex items-center gap-2 mb-6 px-3 py-1.5 border border-primary/20 bg-primary/5 text-primary text-xs font-mono uppercase tracking-widest">
              Tecnología
            </div>
            <h2 className="font-heading text-4xl md:text-5xl font-bold text-foreground tracking-tight mb-6">
              Stack{' '}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-blue-500">
                Tecnológico
              </span>
            </h2>
            <p className="text-muted-foreground leading-relaxed mb-8">
              Nuestras aeronaves integran las tecnologías más avanzadas del sector, 
              garantizando resultados de máxima calidad y fiabilidad operacional.
            </p>
            <div className="relative overflow-hidden hidden lg:block">
              <img src={techImage} srcSet="/images/tech-480.webp 480w, /images/tech-960.webp 960w, /images/tech-1280.webp 1280w" sizes="(max-width: 1023px) calc(100vw - 48px), 600px" decoding="async" loading="lazy" width={1280} height={720} alt="Drone profesional con sensores avanzados" className="w-full aspect-video object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-card via-card/20 to-transparent" />
              <div className="absolute inset-0 border border-primary/10" />
            </div>
          </div>

          {/* Right - Tech grid */}
          <div className="lg:col-span-3 grid sm:grid-cols-2 gap-4">
            {techs.map((tech) => (
              <div
                key={tech.title}
                className="group p-6 border border-border-subtle hover:border-primary/20 bg-surface-subtle hover:bg-primary/5 transition-all duration-300"
              >
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 flex items-center justify-center border border-primary/15 bg-primary/5 shrink-0 group-hover:border-primary/30 transition-colors">
                    <tech.icon className="w-4 h-4 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-heading text-sm font-semibold text-foreground mb-1">{tech.title}</h3>
                    <p className="text-xs text-muted-foreground leading-relaxed">{tech.desc}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
