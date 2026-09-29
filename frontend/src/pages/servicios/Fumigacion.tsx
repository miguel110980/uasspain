import React from 'react';
import { motion } from 'framer-motion';
import { SprayCan, CheckCircle, ArrowRight, ChevronLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import Navbar from '@/components/layout/Navbar';
import Footer from '@/components/layout/Footer';

const features = [
  'Fumigación de precisión con drones agrícolas multirrotor',
  'Reducción de hasta un 90% en el uso de productos fitosanitarios',
  'Sistemas de pulverización inteligente con control de gota',
  'Operación en terrenos de difícil acceso y pendientes pronunciadas',
  'Planificación de vuelo por hectárea con cartografía previa',
  'Cumplimiento de normativa de uso de productos fitosanitarios',
];

export default function Fumigacion() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />

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
              <SprayCan className="w-3.5 h-3.5" /> Fumigación
            </div>
            <h1 className="font-heading text-4xl sm:text-5xl md:text-6xl font-bold text-foreground tracking-tight mb-6">
              Fumigación con{' '}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary via-cyan-300 to-blue-400 text-glow-cyan">
                Drones
              </span>
            </h1>
            <p className="text-base md:text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              Pulverización agrícola de precisión con drones, reduciendo el consumo de productos fitosanitarios y optimizando el rendimiento de cada hectárea.
            </p>
          </motion.div>
        </div>
      </section>

      <section className="py-20 md:py-24 bg-background">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <motion.div initial={{ opacity: 0, x: -30 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ duration: 0.7 }}>
              <h2 className="font-heading text-3xl md:text-4xl font-bold text-foreground tracking-tight mb-6">
                Agricultura de{' '}
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-blue-500">precisión</span>
              </h2>
              <p className="text-muted-foreground leading-relaxed mb-5">
                La fumigación con drones representa un avance decisivo en la agricultura moderna. Nuestros equipos permiten aplicar productos fitosanitarios con una precisión milimétrica, reduciendo hasta un 90% el consumo respecto a métodos tradicionales.
              </p>
              <p className="text-muted-foreground leading-relaxed mb-5">
                Los sistemas de pulverización inteligente controlan el tamaño de gota y el caudal en tiempo real, adaptándose a las condiciones meteorológicas y al tipo de cultivo para maximizar la eficacia del tratamiento.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                Operamos en terrenos de difícil acceso, pendientes pronunciadas y cultivos de todo tipo, con planificación previa mediante cartografía detallada por hectárea.
              </p>
            </motion.div>

            <motion.div initial={{ opacity: 0, x: 30 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ duration: 0.7 }}>
              <div className="glass-card p-8">
                <h3 className="font-heading text-sm font-bold text-foreground uppercase tracking-widest mb-6">
                  Ventajas Operativas
                </h3>
                <ul className="space-y-4">
                  {features.map((f) => (
                    <li key={f} className="flex items-start gap-3">
                      <CheckCircle className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                      <span className="text-sm text-muted-foreground">{f}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      <section className="py-16 bg-card border-y border-border-subtle">
        <div className="max-w-7xl mx-auto px-6 text-center">
          <h2 className="font-heading text-2xl md:text-3xl font-bold text-foreground mb-4">¿Necesitas fumigación de precisión?</h2>
          <p className="text-muted-foreground mb-8 max-w-xl mx-auto">Contacta con nuestro equipo y diseñamos un plan de tratamiento para tu cultivo.</p>
          <Link to="/contacto" className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-8 py-4 font-bold uppercase tracking-tighter text-sm hover:bg-primary/80 transition-all duration-300 group">
            Solicitar Información <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
          </Link>
        </div>
      </section>

      <Footer />
    </div>
  );
}