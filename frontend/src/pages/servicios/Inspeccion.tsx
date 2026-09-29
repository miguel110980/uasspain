import React from 'react';
import { motion } from 'framer-motion';
import { ScanLine, CheckCircle, ArrowRight, ChevronLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import Navbar from '@/components/layout/Navbar';
import Footer from '@/components/layout/Footer';

const features = [
  'Inspección de infraestructuras: líneas eléctricas, torres, parques eólicos',
  'Revisión de fachadas, cubiertas y estructuras de difícil acceso',
  'Detección de defectos con sensores ópticos de alta resolución',
  'Inspección de paneles solares y plantas fotovoltaicas',
  'Informes técnicos detallados con geolocalización de hallazgos',
  'Operación segura sin interrumpir el servicio de la instalación',
];

export default function Inspeccion() {
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
              <ScanLine className="w-3.5 h-3.5" /> Inspección
            </div>
            <h1 className="font-heading text-4xl sm:text-5xl md:text-6xl font-bold text-foreground tracking-tight mb-6">
              Inspección con{' '}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary via-cyan-300 to-blue-400 text-glow-cyan">
                Drones
              </span>
            </h1>
            <p className="text-base md:text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              Inspección técnica de infraestructuras e instalaciones con drones de alta precisión, sin riesgos para el personal y sin interrumpir la operación.
            </p>
          </motion.div>
        </div>
      </section>

      <section className="py-20 md:py-24 bg-background">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <motion.div initial={{ opacity: 0, x: -30 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ duration: 0.7 }}>
              <h2 className="font-heading text-3xl md:text-4xl font-bold text-foreground tracking-tight mb-6">
                Precisión en cada{' '}
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-blue-500">detalle</span>
              </h2>
              <p className="text-muted-foreground leading-relaxed mb-5">
                La inspección con drones permite acceder a infraestructuras de difícil alcance —líneas eléctricas, torres de comunicación, parques eólicos, fachadas y cubiertas— sin exponer al personal a riesgos ni requerir medios de elevación costosos.
              </p>
              <p className="text-muted-foreground leading-relaxed mb-5">
                Nuestros equipos capturan imágenes ópticas de alta resolución que permiten detectar defectos, fisuras, corrosión y anomalías con un nivel de detalle que las inspecciones visuales tradicionales no alcanzan.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                Cada inspección se entrega con un informe técnico detallado, geolocalizado y con las recomendaciones necesarias para el mantenimiento de la instalación.
              </p>
            </motion.div>

            <motion.div initial={{ opacity: 0, x: 30 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ duration: 0.7 }}>
              <div className="glass-card p-8">
                <h3 className="font-heading text-sm font-bold text-foreground uppercase tracking-widest mb-6">
                  Áreas de Inspección
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
          <h2 className="font-heading text-2xl md:text-3xl font-bold text-foreground mb-4">¿Necesitas inspeccionar una infraestructura?</h2>
          <p className="text-muted-foreground mb-8 max-w-xl mx-auto">Contacta con nuestro equipo y preparamos un plan de inspección a medida.</p>
          <Link to="/contacto" className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-8 py-4 font-bold uppercase tracking-tighter text-sm hover:bg-primary/80 transition-all duration-300 group">
            Solicitar Información <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
          </Link>
        </div>
      </section>

      <Footer />
    </div>
  );
}