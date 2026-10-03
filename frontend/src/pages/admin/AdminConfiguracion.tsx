import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Settings, Shield, Mail, Users, Plug, ScrollText, Loader2,
} from 'lucide-react';
import authService from '@/services/authService';
import RuntimeIntegrationForm from '@/components/admin/RuntimeIntegrationForm';
import type { SystemStatusResponse } from '@/api/systemStatus';
import { websocketServiceStatus } from '@/lib/systemStatus';

const SECCIONES = [
  { id: 'general', label: 'Configuración general', icon: Settings },
  { id: 'seguridad', label: 'Seguridad', icon: Shield },
  { id: 'smtp', label: 'SMTP / Correo', icon: Mail },
  { id: 'roles', label: 'Roles y permisos', icon: Users },
  { id: 'integraciones', label: 'Integraciones', icon: Plug },
  { id: 'auditoria', label: 'Registro de auditoría', icon: ScrollText },
];

const badge = (ok) => (ok
  ? 'border-success-border bg-success-soft text-success'
  : 'border-warning-border bg-warning-soft text-warning');

export default function AdminConfiguracion() {
  const [activa, setActiva] = useState('general');
  const [status, setStatus] = useState<SystemStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const data = await authService.getSystemStatus();
        setStatus(data);
      } catch {
        setStatus(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const detalle = (() => {
    if (!status) return [];
    const p = status.platform;
    const redis = status.redis;
    const smtp = status.smtp;
    const oauth = status.google_oauth;
    const users = status.users;
    const sec = status.security;
    const twoFactor = status.two_factor;
    const ws = websocketServiceStatus(status);

    const map = {
      general: [
        { label: 'Nombre de la plataforma', value: p.name || 'UASSPAIN' },
        { label: 'URL frontend', value: p.frontend_url || '—' },
        { label: 'Zona horaria', value: p.timezone || 'Europe/Madrid' },
        { label: 'Modo', value: p.production ? 'Producción' : 'Desarrollo', estado: p.production ? 'ok' : 'warning' },
      ],
      seguridad: [
        { label: 'Cookies JWT seguras', value: sec.jwt_cookie_secure ? 'HTTPS only' : 'HTTP permitido (dev)', estado: sec.jwt_cookie_secure ? 'ok' : 'warning' },
        { label: 'Proxy inverso', value: sec.reverse_proxy === 'nginx' ? 'Nginx activo' : 'Sin proxy inverso', estado: sec.reverse_proxy === 'nginx' ? 'ok' : 'warning' },
        { label: 'Trust proxy (Nginx)', value: sec.trust_proxy ? 'Activado' : 'Desactivado', estado: sec.trust_proxy ? 'ok' : 'warning' },
        { label: 'Hosts permitidos', value: (sec.allowed_hosts || []).join(', ') || '—' },
        { label: 'Cabeceras CSP / HSTS', value: 'Activas vía Rust + Nginx' },
      ],
      smtp: [
        { label: 'Servidor SMTP', value: smtp.host || 'No configurado' },
        { label: 'Estado', value: smtp.configured ? 'Configurado' : 'Sin credenciales', estado: smtp.configured ? 'ok' : 'warning' },
        { label: 'Impacto en 2FA', value: smtp.configured ? 'Los códigos de acceso pueden enviarse por email' : '2FA no enviará correos hasta configurar SMTP', estado: smtp.configured ? 'ok' : 'warning' },
      ],
      roles: [
        { label: 'Administradores', value: users.admin == null ? 'N/D' : String(users.admin) },
        { label: 'Instructores', value: users.instructor == null ? 'N/D' : String(users.instructor) },
        { label: 'Alumnos', value: users.alumno == null ? 'N/D' : String(users.alumno) },
      ],
      integraciones: [
        { label: 'Google OAuth', value: oauth.configured ? 'Configurado' : 'No configurado', estado: oauth.configured ? 'ok' : 'warning' },
        { label: 'WebSockets', value: ws.value, estado: ws.status === 'ok' ? 'ok' : 'warning' },
        { label: 'Backend de canales', value: redis.backend || status?.websockets?.backend || 'N/D' },
        { label: '2FA por roles', value: twoFactor.enabled ? ((twoFactor.required_roles || []).join(', ') || 'Sin roles obligatorios') : 'Desactivada', estado: twoFactor.enabled ? 'ok' : 'warning' },
      ],
      auditoria: [
        { label: 'Registros de conexión', value: 'Disponibles en Admin → Actividad / Auditoría' },
        { label: 'Retención', value: 'Según política del servidor' },
      ],
    };
    return map[activa] || [];
  })();

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
      <div>
        <h2 className="font-heading text-xl font-bold text-foreground flex items-center gap-2">
          <Settings className="w-5 h-5 text-primary" /> Configuración del sistema
        </h2>
        <p className="text-xs text-muted-foreground mt-1">Estado real del backend, integraciones y seguridad.</p>
      </div>

      <div className="grid lg:grid-cols-4 gap-4">
        <div className="lg:col-span-1 space-y-1">
          {SECCIONES.map((s) => (
            <button
              key={s.id}
              onClick={() => setActiva(s.id)}
              className={`w-full text-left px-4 py-3 text-sm flex items-center gap-2 border transition-colors ${
                activa === s.id ? 'border-primary/30 bg-primary/10 text-primary' : 'border-border-subtle hover:bg-surface-hover text-muted-foreground'
              }`}
            >
              <s.icon className="w-4 h-4 shrink-0" /> {s.label}
            </button>
          ))}
        </div>

        <div className="lg:col-span-3 glass-card p-6">
          {!status && <p role="alert">No se pudo consultar el estado del sistema.</p>}
          <ul className="space-y-4">
            {detalle.map((item) => (
              <li key={item.label} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border-subtle pb-4 last:border-0 last:pb-0">
                <span className="text-sm text-muted-foreground">{item.label}</span>
                <span className={`text-sm font-medium text-foreground ${item.estado ? `px-2 py-0.5 border rounded text-xs ${badge(item.estado === 'ok')}` : ''}`}>
                  {item.value}
                </span>
              </li>
            ))}
          </ul>
          {(activa === 'smtp' || activa === 'integraciones') && <RuntimeIntegrationForm kind={activa === 'smtp' ? 'smtp' : 'google'} onSaved={() => { void authService.getSystemStatus().then(setStatus).catch(() => setStatus(null)); }} />}
        </div>
      </div>
    </motion.div>
  );
}
