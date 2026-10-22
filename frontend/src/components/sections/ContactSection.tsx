import React, { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import contentService from '@/services/contentService';
import { motion } from 'framer-motion';
import { useTheme } from 'next-themes';
import useScrollReveal from '@/hooks/useScrollReveal';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Send, MapPin, Phone, Mail, Facebook, Instagram } from 'lucide-react';
import { sanitizeInput, sanitizePayload, type SanitizeKind } from '@/lib/sanitize';
import { extractErrorMessage } from '@/lib/errors';
import { sendContactMessage } from '@/services/contactService';
import { corporateContactEmail, contactField } from '@/lib/contactConfig';

const CONTACT_SCHEMA = {
  nombre: 'text',
  empresa: 'text',
  email: 'email',
  telefono: 'phone',
  servicio: 'text',
  asunto: 'text',
  mensaje: 'message',
} satisfies Record<string, SanitizeKind>;

const FIELD_KIND: Record<string, SanitizeKind> = {
  nombre: 'text',
  empresa: 'text',
  email: 'email',
  telefono: 'phone',
  servicio: 'text',
  asunto: 'text',
  mensaje: 'message',
};

const MAP_ADDRESS = 'Patio de Empresas, Calle Cipriano Alhambra 18, 23440 Baeza, Jaén';
const MAP_URL = 'https://www.google.com/maps?q=Patio%20de%20Empresas%20Calle%20Cipriano%20Alhambra%2018%2023440%20Baeza%20Ja%C3%A9n%20Spain&hl=es&z=16&output=embed';

const EMPTY_FORM = {
  nombre: '', empresa: '', email: '', telefono: '', servicio: '', asunto: '', mensaje: '', website: '',
};

export default function ContactSection({ skipReveal = false }) {
  const { data: services = [] } = useQuery({ queryKey: ['public', 'services'], queryFn: contentService.publicServices, staleTime: 0 });
  const serviceOptions = [...services.map(service => service.title), 'Otro'];
  const { ref, isVisible } = useScrollReveal(0.1);
  const show = skipReveal || isVisible;
  const { resolvedTheme } = useTheme();
  const [form, setForm] = useState(EMPTY_FORM);
  const [sending, setSending] = useState(false);
  const submitInFlight = useRef(false);
  const contactRequest = useRef<{ id: string; payload: string } | null>(null);
  const [sent, setSent] = useState(false);
  const [deliveryNotice, setDeliveryNotice] = useState('');
  const [error, setError] = useState('');
  const [mapStatus, setMapStatus] = useState('loading');

  useEffect(() => {
    if (mapStatus !== 'loading') return undefined;
    const timeout = window.setTimeout(() => setMapStatus('error'), 12000);
    return () => window.clearTimeout(timeout);
  }, [mapStatus]);

  const handleChange = (field, value) => {
    const kind = FIELD_KIND[field] ?? 'text';
    const clean = field === 'mensaje' ? contactField(value, field) : field === 'email' ? value : sanitizeInput(value, kind);
    setForm((prev) => ({ ...prev, [field]: clean }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitInFlight.current) return;
    setError('');
    setSent(false);

    const payload = /** @type {{ nombre: string; empresa: string; email: string; telefono: string; servicio: string; mensaje: string }} */ (
      sanitizePayload(form, CONTACT_SCHEMA)
    );
    payload.email = form.email.trim();
    payload.mensaje = form.mensaje;

    if (!payload.servicio || !serviceOptions.includes(payload.servicio)) {
      setError('Selecciona un servicio válido.');
      return;
    }
    if (!payload.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) {
      setError('Introduce un email válido.');
      return;
    }
    if (!payload.nombre?.trim()) {
      setError('Completa todos los campos obligatorios.');
      return;
    }
    if (payload.asunto.trim().length < 3) {
      setError('El asunto debe tener entre 3 y 120 caracteres.');
      return;
    }
    if (payload.mensaje.trim().length < 10) {
      setError('El mensaje debe tener entre 10 y 2000 caracteres.');
      return;
    }

    submitInFlight.current = true;
    setSending(true);
    try {
      const fingerprint = JSON.stringify(payload);
      if (contactRequest.current?.payload !== fingerprint) contactRequest.current = { id: crypto.randomUUID(), payload: fingerprint };
      const result = await sendContactMessage({ ...payload, request_id: contactRequest.current.id });
      setDeliveryNotice(result.state === 'DELIVERED' && result.delivery_confirmed ? 'Consulta entregada al servidor de correo según el proveedor. Te contactaremos pronto.' : result.state === 'UNKNOWN' ? 'Consulta registrada. Estamos comprobando el envío; no es necesario repetirla.' : result.delivery_accepted ? 'Consulta aceptada para su envío. Te contactaremos pronto.' : 'Consulta registrada y pendiente de envío. Te contactaremos pronto.');
      setSent(true);
      setForm(EMPTY_FORM);
      contactRequest.current = null;
    } catch (err) {
      if (['FAILED', 'EXPIRED'].includes(err?.response?.data?.state)) contactRequest.current = null;
      setError(extractErrorMessage(err, 'Error al enviar. Inténtalo de nuevo más tarde.'));
    } finally {
      submitInFlight.current = false;
      setSending(false);
    }
  };

  return (
    <section id="contacto" className="relative py-24 md:py-32 bg-background overflow-hidden">

      <div ref={ref} className="max-w-7xl mx-auto px-6">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={show ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <div className="inline-flex items-center gap-2 mb-6 px-3 py-1.5 border border-primary/20 bg-primary/5 text-primary text-xs font-mono uppercase tracking-widest">
            Contacto
          </div>
          <h1 className="font-heading text-4xl md:text-5xl font-bold text-foreground tracking-tight mb-4">
            Hablemos de tu{' '}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-blue-500">
              Proyecto
            </span>
          </h1>
          <p className="text-muted-foreground max-w-xl mx-auto">
            Cuéntanos qué necesitas y diseñaremos una solución aérea a medida para tu operación.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-12">
          {/* Form */}
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            animate={show ? { opacity: 1, x: 0 } : {}}
            transition={{ duration: 0.7, delay: 0.2 }}
            className="lg:col-span-3"
          >
            <form onSubmit={handleSubmit} className="glass-card min-w-0 p-5 sm:p-8 space-y-6" noValidate>
              <div className="grid sm:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label htmlFor="contactsection-field-1" className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Nombre *</Label>
                  <Input id="contactsection-field-1"
                    required
                    maxLength={120}
                    placeholder="Tu nombre completo"
                    value={form.nombre}
                    onChange={(e) => handleChange('nombre', e.target.value)}
                    className="bg-surface-muted border-border-subtle focus:border-transparent text-foreground placeholder:text-muted-foreground/40"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="contactsection-field-2" className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Empresa</Label>
                  <Input id="contactsection-field-2"
                    maxLength={120}
                    placeholder="Nombre de tu empresa"
                    value={form.empresa}
                    onChange={(e) => handleChange('empresa', e.target.value)}
                    className="bg-surface-muted border-border-subtle focus:border-transparent text-foreground placeholder:text-muted-foreground/40"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="contactsection-field-3" className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Email *</Label>
                  <Input id="contactsection-field-3"
                    required
                    type="email"
                    maxLength={254}
                    placeholder="tu@email.com"
                    value={form.email}
                    onChange={(e) => handleChange('email', e.target.value)}
                    className="bg-surface-muted border-border-subtle focus:border-transparent text-foreground placeholder:text-muted-foreground/40"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="contactsection-field-4" className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Teléfono</Label>
                  <Input id="contactsection-field-4"
                    type="tel"
                    maxLength={20}
                    placeholder="+34 600 000 000"
                    value={form.telefono}
                    onChange={(e) => handleChange('telefono', e.target.value)}
                    className="bg-surface-muted border-border-subtle focus:border-transparent text-foreground placeholder:text-muted-foreground/40"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="contactsection-field-5" className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Servicio *</Label>
                <Select value={form.servicio} onValueChange={(v) => handleChange('servicio', v)}>
                  <SelectTrigger id="contactsection-field-5" className="bg-surface-muted border-border-subtle focus:border-transparent text-foreground">
                    <SelectValue placeholder="Selecciona un servicio" />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-border-subtle">
                    {serviceOptions.map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="contactsection-subject" className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Asunto *</Label>
                <Input id="contactsection-subject" required maxLength={120} placeholder="Asunto de tu consulta" value={form.asunto}
                  onChange={(e) => handleChange('asunto', e.target.value)}
                  className="bg-surface-muted border-border-subtle focus:border-transparent text-foreground placeholder:text-muted-foreground/40" />
              </div>
              <div className="hidden" aria-hidden="true">
                <label htmlFor="contactsection-website">Website</label>
                <input id="contactsection-website" name="website" tabIndex={-1} autoComplete="off" value={form.website} onChange={(e) => handleChange('website', e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="contactsection-field-6" className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Mensaje *</Label>
                <Textarea id="contactsection-field-6"
                  required
                  rows={5}
                  maxLength={2000}
                  placeholder="Describe tu proyecto o necesidad..."
                  value={form.mensaje}
                  onChange={(e) => handleChange('mensaje', e.target.value)}
                  className="bg-surface-muted border-border-subtle focus:border-transparent text-foreground placeholder:text-muted-foreground/40 resize-none"
                />
              </div>

              {sent && (
                <p role="status" className="text-sm text-primary font-mono text-center">{deliveryNotice}</p>
              )}
              {error && (
                <p role="alert" className="text-sm text-destructive font-mono text-center">{error}</p>
              )}
              <button
                type="submit"
                disabled={sending}
                className="w-full inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground px-8 py-4 font-bold uppercase tracking-tighter text-sm hover:bg-primary/80 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Send className="w-4 h-4" />
                {sending ? 'Enviando...' : 'Enviar Mensaje'}
              </button>
            </form>
          </motion.div>

          {/* Info sidebar */}
          <motion.div
            initial={{ opacity: 0, x: 30 }}
            animate={show ? { opacity: 1, x: 0 } : {}}
            transition={{ duration: 0.7, delay: 0.3 }}
            className="lg:col-span-2 space-y-8"
          >
            {/* Contact info */}
            <div className="space-y-6">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 flex items-center justify-center border border-primary/20 bg-primary/5 shrink-0">
                  <MapPin className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <h4 className="font-heading text-sm font-semibold text-foreground mb-1">Oficina Central</h4>
                  <p className="text-sm text-muted-foreground">Patio de Empresas, Calle Cipriano Alhambra 18<br />23440 Baeza, Jaén, España</p>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 flex items-center justify-center border border-primary/20 bg-primary/5 shrink-0">
                  <Phone className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <h4 className="font-heading text-sm font-semibold text-foreground mb-1">Teléfono</h4>
                  <p className="text-sm text-muted-foreground">+34 607 95 17 41</p>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 flex items-center justify-center border border-primary/20 bg-primary/5 shrink-0">
                  <Mail className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <h4 className="font-heading text-sm font-semibold text-foreground mb-1">Email</h4>
                  <a href={`mailto:${corporateContactEmail}`} className="text-sm text-muted-foreground">{corporateContactEmail}</a>
                </div>
              </div>
            </div>

            {/* Social */}
            <div>
              <h4 className="font-heading text-sm font-semibold text-foreground mb-4">Síguenos</h4>
              <div className="flex gap-3">
                {[
                  { label: 'Facebook', href: 'https://www.facebook.com/UAS-SPAIN-108789101578287', Icon: Facebook },
                  { label: 'Instagram', href: 'https://www.instagram.com/uasspain_drones/', Icon: Instagram },
                ].map(({ label, href, Icon }) => (
                  <a
                    key={label}
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={label}
                    className="w-10 h-10 flex items-center justify-center border border-border-subtle text-muted-foreground hover:border-primary/30 hover:text-primary hover:bg-primary/5 transition-all duration-300"
                  >
                    <Icon className="w-4 h-4" />
                  </a>
                ))}
              </div>
            </div>

            {/* Map */}
            <div className="relative aspect-video min-h-[240px] border border-border-subtle overflow-hidden bg-[#e8eaed]">
              <iframe
                title="UASSPAIN Ubicación"
                src={MAP_URL}
                width="100%"
                height="100%"
                style={{
                  border: 0,
                  filter: resolvedTheme === 'dark' ? 'invert(0.9) hue-rotate(180deg)' : 'none',
                }}
                loading="eager"
                referrerPolicy="no-referrer-when-downgrade"
                onLoad={() => setMapStatus('loaded')}
                onError={() => setMapStatus('error')}
                className={`absolute inset-0 w-full h-full transition-opacity ${mapStatus === 'loaded' ? 'opacity-100' : 'opacity-0'}`}
              />
              {mapStatus !== 'loaded' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center bg-surface-muted text-foreground">
                  <MapPin className="w-7 h-7 text-primary" aria-hidden="true" />
                  <p className="text-sm font-medium">{MAP_ADDRESS}</p>
                  {mapStatus === 'loading' ? (
                    <p className="text-xs text-muted-foreground" role="status">Cargando mapa…</p>
                  ) : (
                    <a
                      href={MAP_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-bold uppercase tracking-widest text-primary hover:text-foreground"
                    >
                      Abrir ubicación en Google Maps
                    </a>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
