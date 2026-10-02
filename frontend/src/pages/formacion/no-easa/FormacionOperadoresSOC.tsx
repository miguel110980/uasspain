import React from 'react';
import { motion } from 'framer-motion';
import { Shield, CheckCircle, ArrowRight, ChevronLeft, Clock, Users, Award } from 'lucide-react';
import { Link } from 'react-router-dom';
import Navbar from '@/components/layout/Navbar';
import Footer from '@/components/layout/Footer';

const modules = [
  'Marco normativo SOC',
  'Equipos y sensores para observación',
  'Procedimientos de vigilancia',
  'Coordinación con fuerzas de seguridad',
  'Recopilación y análisis de datos',
  'Evaluación y certificación',
];

export default function FormacionOperadoresSOC() {
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
            <Link to="/#formacion" className="inline-flex items-center gap-2 mb-8 text-xs font-mono uppercase tracking-widest text-muted-foreground hover:text-primary transition-colors">
              <ChevronLeft className="w-3.5 h-3.5" /> Volver a Formación
            </Link>
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.1 }}>
            <div className="inline-flex items-center gap-2 mb-6 px-3 py-1.5 border border-primary/20 bg-primary/5 text-primary text-xs font-mono uppercase tracking-widest">
              <Shield className="w-3.5 h-3.5" /> Cursos no EASA
            </div>
            <h1 className="font-heading text-4xl sm:text-5xl md:text-6xl font-bold text-foreground tracking-tight mb-6">
              Operadores{' '}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary via-cyan-300 to-blue-400 text-glow-cyan">
                SOC
              </span>
            </h1>
            <p className="text-base md:text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              Formación para operadores SOC (Servicio de Observación con drones), vigilancia y seguridad.
            </p>
          </motion.div>
        </div>
      </section>

      {/* Info cards */}
      <section className="py-12 bg-background">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid sm:grid-cols-3 gap-6">
            {[
              { icon: Clock, label: 'Duración', value: '20 horas' },
              { icon: Users, label: 'Formato', value: 'Online / Presencial' },
              { icon: Award, label: 'Certificación', value: 'Interna' },
            ].map((item, i) => (
              <motion.div
                key={item.label}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: i * 0.1 }}
                className="glass-card p-6 text-center"
              >
                <item.icon className="w-6 h-6 text-primary mx-auto mb-3" />
                <div className="text-xs text-muted-foreground uppercase tracking-widest mb-1">{item.label}</div>
                <div className="font-heading text-lg font-bold text-foreground">{item.value}</div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Content */}
      <section className="py-20 md:py-24 bg-background">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid lg:grid-cols-2 gap-16 items-start">
            <motion.div initial={{ opacity: 0, x: -30 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ duration: 0.7 }}>
              <h2 className="font-heading text-3xl md:text-4xl font-bold text-foreground tracking-tight mb-6">
                Sobre el curso
              </h2>
              <p className="text-muted-foreground leading-relaxed mb-5">
                Los Servicios de Observación con drones (SOC) son una especialidad en crecimiento dentro del sector UAS. Este curso prepara a los operadores para realizar misiones de vigilancia, inspección y seguridad utilizando drones.
              </p>
              <p className="text-muted-foreground leading-relaxed mb-5">
                Aprenderás a manejar equipos y sensores especializados, a coordinar con fuerzas de seguridad y a recopilar y analizar datos de forma efectiva para cada misión de observación.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                El curso cubre el marco normativo específico para operaciones SOC y prepara a los pilotos para certificarse como operadores especializados en vigilancia con drones.
              </p>
            </motion.div>

            <motion.div initial={{ opacity: 0, x: 30 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ duration: 0.7 }}>
              <div className="glass-card p-8">
                <h3 className="font-heading text-sm font-bold text-foreground uppercase tracking-widest mb-6">
                  Módulos del Curso
                </h3>
                <ul className="space-y-4">
                  {modules.map((m) => (
                    <li key={m} className="flex items-start gap-3">
                      <CheckCircle className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                      <span className="text-sm text-muted-foreground">{m}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 bg-card border-y border-border-subtle">
        <div className="max-w-7xl mx-auto px-6 text-center">
          <h2 className="font-heading text-2xl md:text-3xl font-bold text-foreground mb-4">¿Necesitas formación como operador SOC?</h2>
          <p className="text-muted-foreground mb-8 max-w-xl mx-auto">Contacta con nosotros para información sobre próximas convocatorias, precios y disponibilidad.</p>
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
