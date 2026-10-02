import React from 'react';
import Navbar from '@/components/layout/Navbar';
import HeroSection from '@/components/sections/HeroSection';
import AboutSection from '@/components/sections/AboutSection';
import ServicesSection from '@/components/sections/ServicesSection';
import TechSection from '@/components/sections/TechSection';
import Footer from '@/components/layout/Footer';

import { IMAGES } from '@/lib/images';

export default function Home() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />
      <main className="public-content">
      <HeroSection bgImageLight={IMAGES.heroLight} bgImageDark={IMAGES.heroDark} />
      <AboutSection aboutImage={IMAGES.about} />
      <ServicesSection />
      <TechSection techImage={IMAGES.tech} />
      </main>
      <Footer />
    </div>
  );
}