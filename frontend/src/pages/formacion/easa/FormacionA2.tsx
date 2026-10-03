import React from 'react';
import { motion } from 'framer-motion';
import { GraduationCap, CheckCircle, ArrowRight, ChevronLeft, Clock, Users, Award } from 'lucide-react';
import { Link } from 'react-router-dom';
import Navbar from '@/components/layout/Navbar';
import Footer from '@/components/layout/Footer';

const requirements = [
  'Completar el curso de formación online A1/A3 y superar el examen online',
  'Superar un examen de conocimientos teóricos adicional para la subcategoría A2',
  'Familiarización con las instrucciones del fabricante del UAS',
  'Autoformación práctica en zona aislada (150 m de zonas residenciales)',
];


export default function FormacionA2() {
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
            <Link to="/formacion" className="inline-flex items-center gap-2 mb-8 text-xs font-mono uppercase tracking-widest text-muted-foreground hover:text-primary transition-colors">
              <ChevronLeft className="w-3.5 h-3.5" /> Volver a Formación
            </Link>
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.1 }}>
            <div className="inline-flex items-center gap-2 mb-6 px-3 py-1.5 border border-primary/20 bg-primary/5 text-primary text-xs font-mono uppercase tracking-widest">
              <GraduationCap className="w-3.5 h-3.5" /> Categoría Abierta — Subcategoría A2
            </div>
            <h1 className="font-heading text-4xl sm:text-5xl md:text-6xl font-bold text-foreground tracking-tight mb-6">
              Piloto UAS{' '}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary via-cyan-300 to-blue-400 text-glow-cyan">
                A2
              </span>
            </h1>
            <p className="text-base md:text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              Certificación EASA para operar drones con UAS de clase C2 cercanos a personas no participantes. Formación 100% online según el temario oficial de AESA.
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
              { icon: Users, label: 'Formato', value: '100% Online' },
              { icon: Award, label: 'Certificación', value: 'EASA A2' },
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

      {/* Sobre el curso */}
      <section className="py-20 md:py-24 bg-background">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid lg:grid-cols-2 gap-16 items-start">
            <motion.div initial={{ opacity: 0, x: -30 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ duration: 0.7 }}>
              <h2 className="font-heading text-3xl md:text-4xl font-bold text-foreground tracking-tight mb-6">
                Sobre el curso
              </h2>
              <p className="text-muted-foreground leading-relaxed mb-5">
                La subcategoría A2 permite el vuelo a una distancia horizontal segura de al menos <strong className="text-foreground">30 m</strong> de personas no participantes, que podrá reducirse hasta un mínimo de <strong className="text-foreground">5 m</strong> cuando se active la función de modo de baja velocidad.
              </p>
              <p className="text-muted-foreground leading-relaxed mb-5">
                La altura se reducirá en la misma proporción que se reduzca la distancia horizontal segura (regla 1:1). Se mantiene la prohibición de vuelo sobre concentraciones de personas.
              </p>
              <p className="text-muted-foreground leading-relaxed mb-5">
                Los pilotos deben completar el curso online A1/A3, superar el examen de la subcategoría A2, y realizar autoformación práctica en una zona aislada a 150 m de zonas residenciales, comerciales, industriales o recreativas.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                Desde el 1 de enero de 2024, es requisito indispensable disponer de un UAS con marcado de clase C2 para operaciones en subcategoría A2.
              </p>
            </motion.div>

            <motion.div initial={{ opacity: 0, x: 30 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ duration: 0.7 }}>
              <div className="glass-card p-8">
                <h3 className="font-heading text-sm font-bold text-foreground uppercase tracking-widest mb-6">
                  Requisitos del piloto
                </h3>
                <ul className="space-y-4">
                  {requirements.map((r) => (
                    <li key={r} className="flex items-start gap-3">
                      <CheckCircle className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                      <span className="text-sm text-muted-foreground">{r}</span>
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
          <h2 className="font-heading text-2xl md:text-3xl font-bold text-foreground mb-4">¿Quieres certificarte en A2?</h2>
          <p className="text-muted-foreground mb-8 max-w-xl mx-auto">Formación 100% online según el temario oficial de AESA. Contacta con nosotros para información sobre próximas convocatorias y precios.</p>
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
