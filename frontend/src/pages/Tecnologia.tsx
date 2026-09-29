import React from 'react';
import { motion } from 'framer-motion';
import { Brain, Satellite, Navigation, Cpu, Thermometer, Radio, Wifi, Eye } from 'lucide-react';
import Navbar from '@/components/layout/Navbar';
import Footer from '@/components/layout/Footer';

const techs = [
  { icon: Brain, title: 'Inteligencia Artificial', desc: 'Detección automática de objetos y análisis predictivo en tiempo real.' },
  { icon: Satellite, title: 'RTK / PPK', desc: 'Posicionamiento centimétrico para levantamientos de alta precisión.' },
  { icon: Navigation, title: 'GPS Multi-Constelación', desc: 'Navegación con GPS, GLONASS, Galileo y BeiDou simultáneo.' },
  { icon: Cpu, title: 'Vuelo Autónomo', desc: 'Planificación de misiones y waypoints con ejecución automatizada.' },
  { icon: Thermometer, title: 'Cámaras Térmicas', desc: 'Sensores radiométricos para inspección térmica e industrial.' },
  { icon: Radio, title: 'Sensores Avanzados', desc: 'LiDAR, multiespectrales e hiperespectrales para análisis de datos.' },
  { icon: Wifi, title: 'Enlace en Tiempo Real', desc: 'Transmisión de vídeo y telemetría con latencia inferior a 100ms.' },
  { icon: Eye, title: 'Visión por Computador', desc: 'Rastreo automatizado y reconocimiento de patrones avanzado.' },
];

export default function Tecnologia() {
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
              Tecnología
            </div>
            <h1 className="font-heading text-4xl sm:text-5xl md:text-6xl font-bold text-foreground tracking-tight mb-6">
              Stack{' '}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary via-cyan-300 to-blue-400 text-glow-cyan">
                Tecnológico
              </span>
            </h1>
            <p className="text-base md:text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              Nuestras aeronaves integran las tecnologías más avanzadas del sector, garantizando resultados de máxima calidad y fiabilidad operacional.
            </p>
          </motion.div>
        </div>
      </section>

      <section className="py-20 md:py-24 bg-background">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {techs.map((tech, i) => (
              <motion.div
                key={tech.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.07 }}
                className="group p-6 border border-border-subtle hover:border-primary/20 bg-surface-subtle hover:bg-primary/5 transition-all duration-300"
              >
                <div className="w-10 h-10 flex items-center justify-center border border-primary/15 bg-primary/5 mb-4 group-hover:border-primary/30 transition-colors">
                  <tech.icon className="w-4 h-4 text-primary" />
                </div>
                <h4 className="font-heading text-sm font-semibold text-foreground mb-2">{tech.title}</h4>
                <p className="text-xs text-muted-foreground leading-relaxed">{tech.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}