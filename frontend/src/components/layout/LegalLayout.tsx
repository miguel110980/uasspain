import React from 'react';
import { motion } from 'framer-motion';
import Navbar from '@/components/layout/Navbar';
import Footer from '@/components/layout/Footer';

export default function LegalLayout({ title, subtitle, children }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />

      <section className="relative pt-32 pb-16 overflow-hidden">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute inset-0 scanline opacity-10" />
          <div className="absolute top-0 left-1/4 w-px h-full bg-gradient-to-b from-transparent via-primary/8 to-transparent" />
          <div className="absolute top-0 right-1/4 w-px h-full bg-gradient-to-b from-transparent via-primary/5 to-transparent" />
        </div>
        <div className="relative z-10 max-w-3xl mx-auto px-6 text-center">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7 }}>
            <div className="inline-flex items-center gap-2 mb-6 px-3 py-1.5 border border-primary/20 bg-primary/5 text-primary text-xs font-mono uppercase tracking-widest">
              {subtitle || 'Legal'}
            </div>
            <h1 className="font-heading text-4xl md:text-5xl font-bold text-foreground tracking-tight">
              {title}
            </h1>
          </motion.div>
        </div>
      </section>

      <section className="pb-24">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="max-w-3xl mx-auto px-6"
        >
          <div className="glass-card p-8 md:p-12 space-y-6 text-sm md:text-base text-muted-foreground leading-relaxed">
            {children}
          </div>
          <p className="mt-8 text-xs font-mono uppercase tracking-widest text-muted-foreground/60 text-center">
            Última actualización: julio 2026
          </p>
        </motion.div>
      </section>

      <Footer />
    </div>
  );
}