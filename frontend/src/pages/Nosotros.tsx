import React from 'react';
import { motion } from 'framer-motion';
import { ShieldCheck, Award, Users, Target, Plane, Shield, Zap, AlertTriangle, Radio } from 'lucide-react';
import Navbar from '@/components/layout/Navbar';
import Footer from '@/components/layout/Footer';

const features = [
  { icon: ShieldCheck, title: 'Seguridad Operacional', desc: 'Protocolos EASA y normativa europea vigente en todas nuestras operaciones.' },
  { icon: Award, title: 'Pilotos Certificados', desc: 'Equipo con certificaciones STS, A1/A3 y licencias específicas AESA.' },
  { icon: Users, title: 'Equipo Experto', desc: 'Profesionales con más de 10 años de experiencia en el sector aeronáutico.' },
  { icon: Target, title: 'Precisión Milimétrica', desc: 'Tecnología RTK y PPK para resultados con precisión submilimétrica.' },
];

const easaFormations = [
  { code: 'A1/A3', name: 'Categoría abierta A1/A3', desc: 'Operaciones con drones de bajo riesgo (<25kg) en zona no poblada y sobrevuelo incidental de personas.' },
  { code: 'A2', name: 'Categoría abierta A2', desc: 'Operaciones con drones de bajo riesgo (<25kg) con vuelo controlado cerca de personas.' },
  { code: 'STS-01', name: 'Escenario estándar STS-01', desc: 'Operaciones VLOS con drones CS (>250g) en zona residencial/urbana.' },
  { code: 'STS-02', name: 'Escenario estándar STS-02', desc: 'Operaciones VLOS con drones CS (>250g) en zona no residencial/rural.' },
];

const authorizations = [
  { icon: Users, title: 'Instructor de pilotos', desc: 'Formación y certificación de nuevos pilotos de drones bajo certificación EASA.' },
  { icon: ShieldCheck, title: 'Examinador de pilotos', desc: 'Evaluación y certificación de competencias de pilotos según normativa AESA.' },
  { icon: Award, title: 'Evaluador de competencias', desc: 'Verificación y validación de competencias operacionales de pilotos y equipos.' },
  { icon: Radio, title: 'Operador de radiofonista', desc: 'Certificado de operador de estación de radiofonista para comunicaciones aeronáuticas.' },
  { icon: Users, title: 'Operadores SOC', desc: 'Operadores de estaciones de control de operaciones con drones (SOC).' },
];

const nonEasaFormations = [
  { icon: Plane, title: 'Escenario estándar no EASA', desc: 'Operaciones VLOS estándar fuera del marco EASA para categorías específicas.' },
  { icon: Zap, title: 'Categoría específica en escenario estándar no EASA', desc: 'Operaciones específicas con evaluación de riesgos bajo marco no EASA.' },
  { icon: Shield, title: 'STS-ES-01 NE / STS-ES-02 NE', desc: 'Escenarios nacionales españoles equivalentes para operaciones VLOS.' },
  { icon: ShieldCheck, title: 'Seguridad', desc: 'Formación en protocolos de seguridad operacional y gestión de riesgos.' },
  { icon: AlertTriangle, title: 'Emergencias / APO', desc: 'Formación en emergencias y actuaciones de protección civil con drones.' },
];

export default function Nosotros() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />

      <section className="relative min-h-[50vh] flex items-center justify-center overflow-hidden bg-background pt-24">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute inset-0 scanline opacity-10" />
          <div className="absolute top-0 left-1/4 w-px h-full bg-gradient-to-b from-transparent via-primary/8 to-transparent" />
          <div className="absolute top-0 right-1/4 w-px h-full bg-gradient-to-b from-transparent via-primary/5 to-transparent" />
          <div className="absolute w-[600px] h-[600px] border border-primary/5 rounded-full left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" />
        </div>
        <div className="relative z-10 max-w-7xl mx-auto px-6 text-center">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7 }}>
            <div className="inline-flex items-center gap-2 mb-6 px-3 py-1.5 border border-primary/20 bg-primary/5 text-primary text-xs font-mono uppercase tracking-widest">
              Quiénes Somos
            </div>
            <h1 className="font-heading text-4xl sm:text-5xl md:text-6xl font-bold text-foreground tracking-tight mb-6">
              Líderes en{' '}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary via-cyan-300 to-blue-400 text-glow-cyan">
                Operaciones Aéreas
              </span>
            </h1>
            <p className="text-base md:text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              Empresa española especializada en servicios profesionales con drones, combinando tecnología de vanguardia y experiencia aeronáutica.
            </p>
          </motion.div>
        </div>
      </section>

      <section className="py-20 md:py-24 bg-background">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid lg:grid-cols-2 gap-16 items-center mb-20">
            <motion.div initial={{ opacity: 0, x: -30 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ duration: 0.7 }}>
              <h2 className="font-heading text-3xl md:text-4xl font-bold text-foreground tracking-tight mb-6">
                Nuestra{' '}
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-blue-500">misión</span>
              </h2>
              <p className="text-muted-foreground leading-relaxed mb-5">
                UASSPAIN es una empresa española especializada en servicios profesionales con drones. Combinamos tecnología de vanguardia, experiencia aeronáutica y un compromiso absoluto con la seguridad para ofrecer soluciones aéreas de alta precisión a empresas, instituciones y organismos públicos en todo el territorio nacional.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                Nuestro equipo está formado por profesionales con más de 10 años de experiencia en el sector aeronáutico, pilotos certificados AESA y expertos en diversas disciplinas técnicas, garantizando el más alto estándar de calidad en cada operación.
              </p>
            </motion.div>
            <motion.div initial={{ opacity: 0, x: 30 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ duration: 0.7 }}>
              <div className="grid sm:grid-cols-2 gap-4">
                {features.map((f, i) => (
                  <motion.div
                    key={f.title}
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.5, delay: i * 0.1 }}
                    className="group p-5 border border-border-subtle hover:border-primary/20 bg-surface-subtle hover:bg-primary/5 transition-all duration-300"
                  >
                    <f.icon className="w-5 h-5 text-primary mb-3" />
                    <h4 className="font-heading text-sm font-semibold text-foreground mb-1">{f.title}</h4>
                    <p className="text-xs text-muted-foreground leading-relaxed">{f.desc}</p>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      <section className="py-20 md:py-24 bg-background">
        <div className="max-w-7xl mx-auto px-6">
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.7 }} className="text-center mb-12">
            <div className="inline-flex items-center gap-2 mb-4 px-3 py-1.5 border border-primary/20 bg-primary/5 text-primary text-xs font-mono uppercase tracking-widest">
              Formaciones y Autorizaciones
            </div>
            <h2 className="font-heading text-3xl md:text-4xl font-bold text-foreground tracking-tight mb-4">
              Nuestros{' '}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-cyan-300">certificados</span>
            </h2>
            <p className="text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              Certificaciones EASA, autorizaciones AESA y formaciones especializadas que nos permiten operar en cualquier escenario.
            </p>
          </motion.div>

          <div className="mb-16">
            <h3 className="font-heading text-xl font-semibold text-foreground mb-6 flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-primary" />
              Categorías EASA
            </h3>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {easaFormations.map((f, i) => (
                <motion.div
                  key={f.code}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.5, delay: i * 0.1 }}
                  className="p-5 border border-border-subtle hover:border-primary/20 bg-surface-subtle hover:bg-primary/5 transition-all duration-300"
                >
                  <div className="text-primary font-mono text-sm font-bold mb-2">{f.code}</div>
                  <h4 className="font-heading text-sm font-semibold text-foreground mb-1">{f.name}</h4>
                  <p className="text-xs text-muted-foreground leading-relaxed">{f.desc}</p>
                </motion.div>
              ))}
            </div>
          </div>

          <div className="mb-16">
            <h3 className="font-heading text-xl font-semibold text-foreground mb-6 flex items-center gap-2">
              <Award className="w-5 h-5 text-primary" />
              Autorizaciones
            </h3>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {authorizations.map((f, i) => (
                <motion.div
                  key={f.title}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.5, delay: i * 0.1 }}
                  className="p-5 border border-border-subtle hover:border-primary/20 bg-surface-subtle hover:bg-primary/5 transition-all duration-300"
                >
                  <f.icon className="w-5 h-5 text-primary mb-3" />
                  <h4 className="font-heading text-sm font-semibold text-foreground mb-1">{f.title}</h4>
                  <p className="text-xs text-muted-foreground leading-relaxed">{f.desc}</p>
                </motion.div>
              ))}
            </div>
          </div>

          <div>
            <h3 className="font-heading text-xl font-semibold text-foreground mb-6 flex items-center gap-2">
              <Plane className="w-5 h-5 text-primary" />
              Formaciones no EASA
            </h3>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {nonEasaFormations.map((f, i) => (
                <motion.div
                  key={f.title}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.5, delay: i * 0.1 }}
                  className="p-5 border border-border-subtle hover:border-primary/20 bg-surface-subtle hover:bg-primary/5 transition-all duration-300"
                >
                  <f.icon className="w-5 h-5 text-primary mb-3" />
                  <h4 className="font-heading text-sm font-semibold text-foreground mb-1">{f.title}</h4>
                  <p className="text-xs text-muted-foreground leading-relaxed">{f.desc}</p>
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}