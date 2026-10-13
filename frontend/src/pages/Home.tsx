import React, { useEffect } from 'react';
import authService from '@/services/authService';
import { useToast } from '@/components/ui/use-toast';
import Navbar from '@/components/layout/Navbar';
import HeroSection from '@/components/sections/HeroSection';
import AboutSection from '@/components/sections/AboutSection';
import ServicesSection from '@/components/sections/ServicesSection';
import TechSection from '@/components/sections/TechSection';
import Footer from '@/components/layout/Footer';

import { IMAGES } from '@/lib/images';

export default function Home() {
  const { toast } = useToast();
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get('account') !== 'deactivated') return;
    const message = authService.consumeAuthNotice();
    if (message) toast({ title: 'Cuenta dada de baja', description: message });
    url.searchParams.delete('account'); window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
  }, [toast]);
  return (
    <div className="home-page min-h-screen bg-background text-foreground">
      <Navbar />
      <main className="public-content">
      <HeroSection />
      <AboutSection aboutImage={IMAGES.about} />
      <ServicesSection />
      <TechSection techImage={IMAGES.tech} />
      </main>
      <Footer />
    </div>
  );
}
