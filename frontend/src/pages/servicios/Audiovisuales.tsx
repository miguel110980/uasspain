import React from 'react';
import { motion } from 'framer-motion';
import { Camera, ChevronLeft, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import Navbar from '@/components/layout/Navbar';
import Footer from '@/components/layout/Footer';

const trabajo = [
  'Vídeos corporativos',
  'Agencias de publicidad',
  'Comunicación',
  'Eventos',
  'Celebraciones',
  'Cine',
  'Televisión',
];

const adicional = [
  'Seguimiento de obras',
  'Inspecciones técnicas',
  'Revisión de cubiertas',
  'Producción audiovisual',
  'Grabaciones en interiores',
  'Grabaciones en exteriores',
];

export default function Audiovisuales() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />
      <main className="public-content">

      {/* Hero */}
      <section className="relative min-h-[55vh] flex items-center justify-center overflow-hidden bg-background pt-24">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute inset-0 bg-gradient-to-b from-background/60 via-background/40 to-background" />
          <div className="absolute inset-0 scanline opacity-10" />
          <div className="absolute top-0 left-1/4 w-px h-full bg-gradient-to-b from-transparent via-primary/8 to-transparent" />
          <div className="absolute top-0 right-1/4 w-px h-full bg-gradient-to-b from-transparent via-primary/5 to-transparent" />
          <div className="absolute w-[600px] h-[600px] border border-primary/5 rounded-full left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" />
        </div>
        <div className="relative z-10 max-w-7xl mx-auto px-6 text-center">
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
            <Link to="/#servicios" className="inline-flex items-center gap-2 mb-8 text-xs font-mono uppercase tracking-widest text-muted-foreground hover:text-primary transition-colors">
              <ChevronLeft className="w-3.5 h-3.5" /> Volver a Servicios
            </Link>
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.1 }}>
            <div className="inline-flex items-center gap-2 mb-6 px-3 py-1.5 border border-primary/20 bg-primary/5 text-primary text-xs font-mono uppercase tracking-widest">
              <Camera className="w-3.5 h-3.5" /> Audiovisuales
            </div>
            <h1 className="font-heading text-4xl sm:text-5xl md:text-6xl font-bold text-foreground tracking-tight mb-6">
              Fotografía y Producción{' '}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary via-cyan-300 to-blue-400 text-glow-cyan">
                Audiovisual
              </span>
            </h1>
            <p className="text-base md:text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              Imágenes aéreas de máxima resolución para proyectos creativos, corporativos y técnicos. Perspectivas únicas desde el aire.
            </p>
          </motion.div>
        </div>
      </section>

      {/* Descripción */}
      <section className="py-20 md:py-24 bg-background">
        <div className="max-w-7xl mx-auto px-6">
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.7 }} className="max-w-3xl mx-auto text-center mb-16">
            <h2 className="font-heading text-3xl md:text-4xl font-bold text-foreground tracking-tight mb-6">
              Una perspectiva{' '}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-blue-500">única desde el aire</span>
            </h2>
            <p className="text-muted-foreground leading-relaxed mb-4">
              Gracias a los drones podemos realizar impresionantes fotografías aéreas de máxima resolución. La fotografía aérea puede utilizarse tanto para fines civiles como artísticos o personales, permitiendo capturar escenarios espectaculares desde una perspectiva única.
            </p>
            <p className="text-muted-foreground leading-relaxed">
              También ofrecemos fotografía panorámica aérea en 360°. Nuestra flota de drones permite obtener imágenes de alta calidad para cualquier proyecto audiovisual.
            </p>
          </motion.div>

          <div className="grid md:grid-cols-2 gap-8">
            <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6 }} className="glass-card p-8">
              <h3 className="font-heading text-sm font-bold text-foreground uppercase tracking-widest mb-6">Nuestro Trabajo</h3>
              <ul className="space-y-3">
                {trabajo.map((item) => (
                  <li key={item} className="flex items-start gap-3">
                    <span className="w-1.5 h-1.5 bg-primary rounded-full mt-2 shrink-0" />
                    <span className="text-sm text-muted-foreground">{item}</span>
                  </li>
                ))}
              </ul>
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6, delay: 0.1 }} className="glass-card p-8">
              <h3 className="font-heading text-sm font-bold text-foreground uppercase tracking-widest mb-6">Además Realizamos</h3>
              <ul className="space-y-3">
                {adicional.map((item) => (
                  <li key={item} className="flex items-start gap-3">
                    <span className="w-1.5 h-1.5 bg-primary rounded-full mt-2 shrink-0" />
                    <span className="text-sm text-muted-foreground">{item}</span>
                  </li>
                ))}
              </ul>
            </motion.div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 bg-card border-y border-border-subtle">
        <div className="max-w-7xl mx-auto px-6 text-center">
          <h2 className="font-heading text-2xl md:text-3xl font-bold text-foreground mb-4">¿Tienes un proyecto audiovisual en mente?</h2>
          <p className="text-muted-foreground mb-8 max-w-xl mx-auto">Cuéntanos tu idea y te ofrecemos la solución aérea más adecuada.</p>
          <Link to="/contacto" className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-8 py-4 font-bold uppercase tracking-tighter text-sm hover:bg-primary/80 transition-all duration-300 group">
            Solicitar Información <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
          </Link>
        </div>
      </section>

      </main>
      <Footer />
    </div>
  );
}