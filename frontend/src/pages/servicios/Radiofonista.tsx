import React from 'react';
import { motion } from 'framer-motion';
import { Radio, CheckCircle, ArrowRight, ChevronLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import Navbar from '@/components/layout/Navbar';
import Footer from '@/components/layout/Footer';

const features = [
  'Práctica real de comunicaciones radiofónicas para operadores de drones',
  'Simulación de escenarios operacionales con tráfico aéreo',
  'Entrenamiento en fraseología aeronáutica y procedimientos ATS',
  'Uso de equipos de radio reales para vía aérea y tierra',
  'Coordinación con torres de control y otros operadores',
  'Cumplimiento de normativa AESA y OACI aplicable',
];

export default function Radiofonista() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />
      <main className="public-content">

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
              <Radio className="w-3.5 h-3.5" /> Radiofonista
            </div>
            <h1 className="font-heading text-4xl sm:text-5xl md:text-6xl font-bold text-foreground tracking-tight mb-6">
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary via-cyan-300 to-blue-400 text-glow-cyan">
                Radiofonista
              </span>
            </h1>
            <p className="text-base md:text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              Formación práctica en comunicaciones radiofónicas para operadores de drones, con simulación real de escenarios y fraseología aeronáutica.
            </p>
          </motion.div>
        </div>
      </section>

      <section className="py-20 md:py-24 bg-background">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <motion.div initial={{ opacity: 0, x: -30 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ duration: 0.7 }}>
              <h2 className="font-heading text-3xl md:text-4xl font-bold text-foreground tracking-tight mb-6">
                Comunicaciones{' '}
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-blue-500">profesionales</span>
              </h2>
              <p className="text-muted-foreground leading-relaxed mb-5">
                La práctica de radiofonista es un pilar fundamental para la operación segura de drones en entornos controlados y no controlados. Nuestro programa proporciona entrenamiento real con equipos de comunicación utilizados en operaciones aéreas.
              </p>
              <p className="text-muted-foreground leading-relaxed mb-5">
                Los alumnos practican fraseología aeronáutica, procedimientos de coordinación con torres de control y gestión de emergencias, en escenarios simulados que reproducen situaciones operacionales reales.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                Todo el contenido se ajusta a la normativa AESA y OACI aplicable, garantizando que el operador adquiera las competencias necesarias para comunicarse eficazmente durante sus vuelos.
              </p>
            </motion.div>

            <motion.div initial={{ opacity: 0, x: 30 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ duration: 0.7 }}>
              <div className="glass-card p-8">
                <h3 className="font-heading text-sm font-bold text-foreground uppercase tracking-widest mb-6">
                  Capacidades del Programa
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
          <h2 className="font-heading text-2xl md:text-3xl font-bold text-foreground mb-4">¿Quieres formar parte de nuestro programa?</h2>
          <p className="text-muted-foreground mb-8 max-w-xl mx-auto">Contacta con nuestro equipo y te informamos sobre las próximas convocatorias.</p>
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