import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowUp, Facebook, Instagram } from 'lucide-react';
import Logo from '@/components/layout/Logo';

const quickLinks = [
  { label: 'Inicio', href: '/' },
  { label: 'Quiénes Somos', href: '/nosotros' },
  { label: 'Tecnología', href: '/tecnologia' },
  { label: 'Blog', href: '/blog' },
  { label: 'Contacto', href: '/contacto' },
];

const serviceLinks = [
  { label: 'Emergencias', href: '/servicios/emergencias' },
  { label: 'Seguridad', href: '/servicios/seguridad' },
  { label: 'Radiofonista', href: '/servicios/radiofonista' },
  { label: 'Audiovisuales', href: '/servicios/audiovisuales' },
  { label: 'Fumigación', href: '/servicios/fumigacion' },
  { label: 'Inspección', href: '/servicios/inspeccion' },
  { label: 'Termografía', href: '/servicios/termografia' },
];

const formacionLinks = [
  { label: 'A1/A3', href: '/formacion/easa/a1-a3' },
  { label: 'A2', href: '/formacion/easa/a2' },
  { label: 'STS', href: '/formacion/easa/sts' },
  { label: 'STS-01', href: '/formacion/easa/sts-01' },
  { label: 'STS-02', href: '/formacion/easa/sts-02' },
  { label: 'Radiofonista', href: '/formacion/no-easa/radiofonista' },
  { label: 'Seguridad', href: '/formacion/no-easa/seguridad' },
  { label: 'Emergencias / APO', href: '/formacion/no-easa/emergencias-apo' },
  { label: 'EN01', href: '/formacion/no-easa/en01' },
  { label: 'EN02', href: '/formacion/no-easa/en02' },
  { label: 'Operadores SOC', href: '/formacion/no-easa/operadores-soc' },
  { label: 'Certificación Instructor', href: '/formacion/instructor/certificacion' },
  { label: 'Revalidación Instructor', href: '/formacion/instructor/revalidacion' },
  { label: 'Formación Continua', href: '/formacion/instructor/continua' },
];

const legalLinks = [
  { label: 'Política de Privacidad', href: '/politica-privacidad' },
  { label: 'Aviso Legal', href: '/aviso-legal' },
  { label: 'Política de Cookies', href: '/politica-cookies' },
];

const socialLinks = [
  { label: 'Facebook', href: 'https://www.facebook.com/UAS-SPAIN-108789101578287', Icon: Facebook },
  { label: 'Instagram', href: 'https://www.instagram.com/uasspain_drones/', Icon: Instagram },
];

export default function Footer() {
  return (
    <footer className="relative bg-card overflow-hidden">
      <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent" />

      {/* Perspective grid background */}
      <div className="absolute bottom-0 left-0 w-full h-40 opacity-[0.04] pointer-events-none"
        style={{
          backgroundImage: `linear-gradient(hsl(186 100% 50%) 1px, transparent 1px), linear-gradient(90deg, hsl(186 100% 50%) 1px, transparent 1px)`,
          backgroundSize: '40px 40px',
          transform: 'perspective(500px) rotateX(60deg)',
          transformOrigin: 'bottom center',
        }}
      />

      <div className="max-w-7xl mx-auto px-6 pt-16 pb-8 relative z-10">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-12 mb-16">
          {/* Brand */}
          <div className="col-span-2 md:col-span-1">
            <Logo size="footer" withTagline={false} className="mb-5" />
            <p className="text-sm text-muted-foreground leading-relaxed mb-2">
              Servicios aéreos profesionales con drones. Tecnología, seguridad y precisión al servicio de tu operación.
            </p>
            <p className="text-xs text-muted-foreground/60 leading-relaxed mb-6">
              Patio de Empresas, Calle Cipriano Alhambra 18<br />23440 Baeza, Jaén, España<br />+34 607 95 17 41 · info@uasspain.com
            </p>
            <div className="flex gap-3">
              {socialLinks.map(({ label, href, Icon }) => (
                <a
                  key={label}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={label}
                  className="w-9 h-9 flex items-center justify-center border border-border-subtle text-muted-foreground hover:border-primary/30 hover:text-primary hover:bg-primary/5 transition-all duration-300"
                >
                  <Icon className="w-4 h-4" />
                </a>
              ))}
            </div>
          </div>

          {/* Quick Links */}
          <div>
            <h4 className="font-heading text-xs font-bold uppercase tracking-widest text-foreground mb-4">
              Navegación
            </h4>
            <ul className="space-y-3">
              {quickLinks.map((link) => (
                <li key={link.label}>
                  <Link to={link.href} className="text-sm text-muted-foreground hover:text-primary transition-colors">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Services */}
          <div>
            <h4 className="font-heading text-xs font-bold uppercase tracking-widest text-foreground mb-4">
              Servicios
            </h4>
            <ul className="space-y-3">
              {serviceLinks.map((s) => (
                <li key={s.label}>
                  <Link to={s.href} className="text-sm text-muted-foreground hover:text-primary transition-colors">
                    {s.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Formación */}
          <div>
            <h4 className="font-heading text-xs font-bold uppercase tracking-widest text-foreground mb-4">
              Formación
            </h4>
            <ul className="space-y-3">
              {formacionLinks.map((f) => (
                <li key={f.label}>
                  <Link to={f.href} className="text-sm text-muted-foreground hover:text-primary transition-colors">
                    {f.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Legal */}
          <div>
            <h4 className="font-heading text-xs font-bold uppercase tracking-widest text-foreground mb-4">
              Legal
            </h4>
            <ul className="space-y-3">
              {legalLinks.map((link) => (
                <li key={link.label}>
                  <Link to={link.href} className="text-sm text-muted-foreground hover:text-primary transition-colors">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="pt-8 border-t border-border-subtle flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-xs text-muted-foreground/60 font-mono">
            © {new Date().getFullYear()} UASSPAIN. Todos los derechos reservados.
          </p>
          <button
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            className="w-10 h-10 flex items-center justify-center border border-border-subtle text-muted-foreground hover:border-primary/30 hover:text-primary transition-all duration-300"
            aria-label="Volver arriba"
          >
            <ArrowUp className="w-4 h-4" />
          </button>
        </div>
      </div>
    </footer>
  );
}