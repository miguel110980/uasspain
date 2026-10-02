import React from 'react';
import { motion } from 'framer-motion';
import { Plane, CheckCircle, ArrowRight, ChevronLeft, Clock, Users, Award } from 'lucide-react';
import { Link } from 'react-router-dom';
import Navbar from '@/components/layout/Navbar';
import Footer from '@/components/layout/Footer';

const modules = [
  {
    title: 'Reglamentación de la aviación',
    description: 'Introducción a EASA, OACI, Cielo Único Europeo (CUE), Reglamentos europeos 1139/2018, 945/2019 y 947/2019. Registro de operadores, declaración operacional, responsabilidades del operador y del piloto.',
  },
  {
    title: 'Escenarios estándar STS-01 y STS-02',
    description: 'Requisitos del STS-01 (VLOS sobre entorno poblado con clase C5) y STS-02 (BVLOS sobre entorno poco poblado con clase C6). Limitaciones, requisitos de observadores, sistemas de identificación a distancia.',
  },
  {
    title: 'Limitaciones del rendimiento humano',
    description: 'Influencia de sustancias psicoactivas, alcohol, fatiga y medicación. Efecto de condiciones meteorológicas. Percepción humana, factores de alcance visual VLOS, evaluación de distancia y velocidad, consciencia situacional.',
  },
  {
    title: 'Procedimientos operacionales',
    description: 'Procedimientos previos al vuelo (planificación, verificación del UAS, listas de control), durante el vuelo (normales, contingencia y emergencia), y posteriores al vuelo (inspección, registros, informes).',
  },
  {
    title: 'Atenuaciones técnicas y operacionales del riesgo',
    description: 'Riesgo en aire, volúmenes operacionales y de contingencia, geografía de vuelo, consulta de espacio aéreo, coordinación con gestores de aeródromos, fraseología con observadores del espacio aéreo.',
  },
  {
    title: 'Conocimiento general del UAS',
    description: 'Principios de vuelo avanzados, sistemas de asistencia al vuelo (ESC, controladora, sensores GNSS, inerciales, barométricos), principios de mando y control, frecuencias y espectro, modos de vuelo, requisitos clase C5 y C6.',
  },
];

export default function FormacionSTS() {
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
              <Plane className="w-3.5 h-3.5" /> Categoría Específica
            </div>
            <h1 className="font-heading text-4xl sm:text-5xl md:text-6xl font-bold text-foreground tracking-tight mb-6">
              Piloto UAS{' '}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary via-cyan-300 to-blue-400 text-glow-cyan">
                STS
              </span>
            </h1>
            <p className="text-base md:text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              Curso preparación examen teórico de escenarios operacionales (STS) — formación avanzada para pilotos con certificación A2 que buscan operar en categoría específica.
            </p>
          </motion.div>
        </div>
      </section>

      {/* Info cards */}
      <section className="py-12 bg-background">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid sm:grid-cols-3 gap-6">
            {[
              { icon: Clock, label: 'Duración', value: '40 horas' },
              { icon: Users, label: 'Formato', value: '100% Online — Ritmo propio' },
              { icon: Award, label: 'Certificación', value: 'EASA STS' },
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
                Este curso está diseñado para pilotos que ya poseen la titulación A2 y desean obtener la autorización para operar en escenarios de categoría específica. Cubre la normativa completa de escenarios operacionales STS-01 (VLOS en entorno poblado) y STS-02 (BVLOS en entorno poco poblado), según el Reglamento europeo 1139/2018 y sus actos delegados y de ejecución.
              </p>
              <p className="text-muted-foreground leading-relaxed mb-5">
                El temario incluye la reglamentación europea de aviación (EASA, OACI, Cielo Único Europeo), limitaciones del rendimiento humano (percepción visual, fatiga, condiciones meteorológicas), procedimientos operacionales (previos, durante y posteriores al vuelo), y atenuaciones técnicas y operacionales del riesgo en aire.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                También aborda el conocimiento técnico avanzado de UAS: sistemas de asistencia al vuelo, sensores (GNSS, inerciales, barométricos), principios de mando y control, frecuencias de enlace, modos de vuelo, y requisitos específicos de las clases C5 y C6. Incluye familiarización con el manual de usuario del fabricante.
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

      {/* CTA */}
      <section className="py-16 bg-card border-y border-border-subtle">
        <div className="max-w-7xl mx-auto px-6 text-center">
          <h2 className="font-heading text-2xl md:text-3xl font-bold text-foreground mb-4">¿Listo para operar en categoría específica?</h2>
          <p className="text-muted-foreground mb-8 max-w-xl mx-auto">Accede al curso completo 100% online y prepárate para los escenarios STS-01 y STS-02 con el temario oficial de AESA.</p>
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
