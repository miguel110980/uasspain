import React from 'react';
import { motion } from 'framer-motion';
import { Plane, CheckCircle, ArrowRight, ChevronLeft, Clock, Users, Award } from 'lucide-react';
import { Link } from 'react-router-dom';
import Navbar from '@/components/layout/Navbar';
import Footer from '@/components/layout/Footer';

const modules = [
  {
    title: 'Reglamentación EASA para STS-01',
    description: 'Marco normativo europeo: Reglamento 1139/2018, actos delegados 945/2019 y 947/2019. Requisitos para operar en escenario STS-01.',
  },
  {
    title: 'Operaciones VLOS en entorno poblado',
    description: 'Condiciones operacionales para vuelo visual (VLOS) sobre áreas pobladas. Requisitos de observadores, distancias de seguridad y procedimientos.',
  },
  {
    title: 'Clase C5 — Requisitos del UAS',
    description: 'Características técnicas obligatorias para drones clase C5: identificación remota, geo-awareness, límites de altura y distancia, corte de motor remoto.',
  },
  {
    title: 'Limitaciones del rendimiento humano',
    description: 'Percepción visual, alcance visual efectivo, factores de fatiga, condiciones meteorológicas adversas y su impacto en operaciones VLOS.',
  },
  {
    title: 'Procedimientos operacionales STS-01',
    description: 'Planificación de vuelo, listas de control, procedimientos de contingencia, coordinación con servicios de tránsito aéreo en entorno poblado.',
  },
  {
    title: 'Atenuaciones de riesgo',
    description: 'Evaluación de riesgos específicos para operaciones sobre entorno poblado. Volúmenes operacionales y de contingencia, geografía de vuelo.',
  },
];

export default function FormacionSTS01() {
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
            <Link to="/formacion/easa/sts" className="inline-flex items-center gap-2 mb-8 text-xs font-mono uppercase tracking-widest text-muted-foreground hover:text-primary transition-colors">
              <ChevronLeft className="w-3.5 h-3.5" /> Volver a STS
            </Link>
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.1 }}>
            <div className="inline-flex items-center gap-2 mb-6 px-3 py-1.5 border border-primary/20 bg-primary/5 text-primary text-xs font-mono uppercase tracking-widest">
              <Plane className="w-3.5 h-3.5" /> Escenario Operacional
            </div>
            <h1 className="font-heading text-4xl sm:text-5xl md:text-6xl font-bold text-foreground tracking-tight mb-6">
              Piloto UAS{' '}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary via-cyan-300 to-blue-400 text-glow-cyan">
                STS-01
              </span>
            </h1>
            <p className="text-base md:text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              Escenario operacional STS-01 — Vuelo visual (VLOS) sobre entorno poblado con drones de clase C5.
            </p>
          </motion.div>
        </div>
      </section>

      <section className="py-12 bg-background">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid sm:grid-cols-3 gap-6">
            {[
              { icon: Clock, label: 'Duración', value: '20 horas' },
              { icon: Users, label: 'Formato', value: '100% Online' },
              { icon: Award, label: 'Certificación', value: 'EASA STS-01' },
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

      <section className="py-20 md:py-24 bg-background">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid lg:grid-cols-2 gap-16 items-start">
            <motion.div initial={{ opacity: 0, x: -30 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ duration: 0.7 }}>
              <h2 className="font-heading text-3xl md:text-4xl font-bold text-foreground tracking-tight mb-6">
                Sobre el curso STS-01
              </h2>
              <p className="text-muted-foreground leading-relaxed mb-5">
                El escenario operacional STS-01 permite realizar operaciones VLOS (Vuelo Visual) sobre entorno poblado con drones de la clase C5. Este curso prepara al piloto para superar el examen teórico de AESA y obtener la autorización correspondiente.
              </p>
              <p className="text-muted-foreground leading-relaxed mb-5">
                Cubre la normativa específica para operaciones en áreas pobladas, incluyendo requisitos de distancia de seguridad, procedimientos de emergencia, coordinación con autoridades locales y uso obligatorio de sistemas de identificación remota.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                El alumno adquirirá conocimientos sobre planificación de vuelo en entorno urbano, evaluación de riesgos específicos, y procedimientos operacionales para garantizar la seguridad de terceros durante las operaciones.
              </p>
            </motion.div>

            <motion.div initial={{ opacity: 0, x: 30 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ duration: 0.7 }}>
              <div className="glass-card p-8">
                <h3 className="font-heading text-sm font-bold text-foreground uppercase tracking-widest mb-6">
                  Módulos del Curso
                </h3>
                <ul className="space-y-5">
                  {modules.map((m) => (
                    <li key={m.title} className="flex items-start gap-3">
                      <CheckCircle className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                      <div>
                        <span className="text-sm font-medium text-foreground">{m.title}</span>
                        <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{m.description}</p>
                      </div>
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
          <h2 className="font-heading text-2xl md:text-3xl font-bold text-foreground mb-4">¿Quieres operar en entorno poblado?</h2>
          <p className="text-muted-foreground mb-8 max-w-xl mx-auto">Accede al curso STS-01 100% online y obtén la autorización para operar VLOS sobre áreas pobladas.</p>
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
