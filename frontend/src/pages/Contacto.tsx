import React from 'react';
import Navbar from '@/components/layout/Navbar';
import Footer from '@/components/layout/Footer';
import ContactSection from '@/components/sections/ContactSection';

export default function Contacto() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />
      <main className="public-content">
      <div className="pt-20">
        <ContactSection skipReveal />
      </div>
      </main>
      <Footer />
    </div>
  );
}