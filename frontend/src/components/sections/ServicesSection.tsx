import React from 'react';
import { Link } from 'react-router-dom';
import useScrollReveal from '@/hooks/useScrollReveal';
import { Shield, Siren, Camera, Radio, SprayCan, ScanLine, Thermometer, ArrowRight } from 'lucide-react';

const services = [
  {
    icon: Siren,
    title: 'Emergencias',
    desc: 'Soporte aéreo crítico para Fuerzas y Cuerpos de Seguridad, equipos de emergencias y Protección Civil con drones de despliegue inmediato.',
    coord: '40.4168° N',
    href: '/servicios/emergencias',
  },
  {
    icon: Shield,
    title: 'Seguridad',
    desc: 'Vigilancia aérea perimetral con cámaras térmicas y ópticas, asesoramiento conforme a normativa AESA y experiencia en unidades especiales.',
    coord: '38.3452° N',
    href: '/servicios/seguridad',
  },
  {
    icon: Radio,
    title: 'Radiofonista',
    desc: 'Formación práctica en comunicaciones radiofónicas para operadores de drones, con simulación real de escenarios y fraseología aeronáutica.',
    coord: '41.3851° N',
    href: '/servicios/radiofonista',
  },
  {
    icon: Camera,
    title: 'Audiovisuales',
    desc: 'Imágenes aéreas de máxima resolución para proyectos creativos, corporativos y técnicos. Perspectivas únicas desde el aire.',
    coord: '37.3891° N',
    href: '/servicios/audiovisuales',
  },
  {
    icon: SprayCan,
    title: 'Fumigación',
    desc: 'Pulverización agrícola de precisión con drones, reduciendo hasta un 90% el consumo de productos fitosanitarios y optimizando cada hectárea.',
    coord: '39.4699° N',
    href: '/servicios/fumigacion',
  },
  {
    icon: ScanLine,
    title: 'Inspección',
    desc: 'Inspección técnica de infraestructuras e instalaciones con drones de alta precisión, sin riesgos para el personal y sin interrumpir la operación.',
    coord: '36.7213° N',
    href: '/servicios/inspeccion',
  },
  {
    icon: Thermometer,
    title: 'Termografía',
    desc: 'Inspección térmica aérea con cámaras de alta sensibilidad para detectar anomalías invisibles en instalaciones eléctricas, solares y edificios.',
    coord: '39.5717° N',
    href: '/servicios/termografia',
  },
];

function ServiceCard({ service }) {
  return (
    <div
      className="group relative p-8 glass-card hover:border-primary/30 transition-all duration-500 overflow-hidden"
    >
      {/* Coord label */}
      <div className="absolute top-4 right-4 text-[10px] font-mono text-primary/20 group-hover:text-primary/40 tracking-widest transition-colors">
        {service.coord}
      </div>

      {/* Hover glow */}
      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 bg-gradient-to-br from-primary/5 via-transparent to-transparent pointer-events-none" />

      <div className="relative z-10">
        <div className="w-12 h-12 flex items-center justify-center border border-primary/20 bg-primary/5 mb-6 group-hover:border-primary/40 group-hover:bg-primary/10 transition-all duration-300">
          <service.icon className="w-5 h-5 text-primary" />
        </div>

        <h3 className="font-heading text-xl font-bold text-foreground mb-3 uppercase tracking-tight">
          {service.title}
        </h3>

        <p className="text-sm text-muted-foreground leading-relaxed mb-6">
          {service.desc}
        </p>

        <Link to={service.href} className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-primary group-hover:gap-3 transition-all duration-300">
          Ver {service.title}
          <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </div>

      {/* Bottom border animation */}
      <div className="absolute bottom-0 left-0 w-0 h-[2px] bg-gradient-to-r from-primary to-blue-500 group-hover:w-full transition-all duration-500" />
    </div>
  );
}

export default function ServicesSection() {
  const { ref, isVisible } = useScrollReveal(0.05);

  return (
    <section id="servicios" className="relative py-24 md:py-32 bg-background overflow-hidden">
      {/* Subtle grid bg */}
      <div className="absolute inset-0 opacity-[0.03] pointer-events-none"
        style={{
          backgroundImage: `linear-gradient(hsl(186 100% 50%) 1px, transparent 1px), linear-gradient(90deg, hsl(186 100% 50%) 1px, transparent 1px)`,
          backgroundSize: '60px 60px',
        }}
      />

      <div ref={ref} className={`max-w-7xl mx-auto px-6 home-reveal ${isVisible ? 'is-visible' : ''}`}>
        {/* Header */}
        <div
          className="text-center mb-16"
        >
          <div className="inline-flex items-center gap-2 mb-6 px-3 py-1.5 border border-primary/20 bg-primary/5 text-primary text-xs font-mono uppercase tracking-widest">
            Nuestros Servicios
          </div>
          <h2 className="font-heading text-4xl md:text-5xl lg:text-6xl font-bold text-foreground tracking-tight mb-4">
            Capacidades{' '}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-blue-500">
              Operativas
            </span>
          </h2>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            Soluciones aéreas profesionales adaptadas a las necesidades específicas de cada sector y operación.
          </p>
        </div>

        {/* Grid */}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {services.map((service) => (
            <ServiceCard key={service.title} service={service} />
          ))}
        </div>
      </div>
    </section>
  );
}
