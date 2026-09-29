import React, { useEffect, useState, useRef } from 'react';
import { motion } from 'framer-motion';
import {
  Shield, ShieldAlert, Ban, Lock, KeyRound, AlertTriangle, MapPin, Users,
} from 'lucide-react';
import authService from '@/services/authService';
import conexionesService from '@/services/conexionesService';
import { rolBadgeClass } from '@/lib/adminActivity';
import { useRefreshableLoad } from '@/hooks/useRefreshableLoad';

const fmt = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
};

export default function AdminSeguridad() {
  const [registro, setRegistro] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [authPolicy, setAuthPolicy] = useState({ enabled: false, required_roles: [] });
  const [systemStatus, setSystemStatus] = useState(null);
  const { loading, isBusy, lastUpdate, runLoad } = useRefreshableLoad();
  const hasData = useRef(false);

  const load = (manual = false) => runLoad(async () => {
    const [reg, prof, policy, status] = await Promise.all([
      conexionesService.registros.list('-created_date', 1000),
      authService.listProfiles('-created_date', 500),
      authService.getSystemAuthPolicy(),
      authService.getSystemStatus(),
    ]);
    setRegistro(reg);
    setProfiles(prof);
    setAuthPolicy(policy);
    setSystemStatus(status);
    hasData.current = true;
  }, { manual, silent: !manual && hasData.current });

  const usersWith2FA = profiles.filter((profile) => {
    if (profile.login_2fa_enabled_override === true) return true;
    if (profile.login_2fa_enabled_override === false) return false;
    return authPolicy.enabled && authPolicy.required_roles.includes(profile.role || 'alumno');
  }).length;
  const smtpConfigured = Boolean(systemStatus?.smtp?.configured);

  const updatePolicy = async (patch) => {
    const next = { ...authPolicy, ...patch };
    setAuthPolicy(next);
    try {
      const saved = await authService.updateSystemAuthPolicy(next);
      setAuthPolicy(saved);
    } catch {
      load(true);
    }
  };

  useEffect(() => {
    load();
    const timer = setInterval(() => load(false), 30000);
    const unsubscribe = conexionesService.subscribeConexiones((event) => {
      const payload = conexionesService.parseWsPayload(event);
      if (payload?.type === 'conexion' || event.type === 'poll') load(false);
    });
    return () => {
      clearInterval(timer);
      unsubscribe();
    };
  }, []);

  const intentosFallidos = registro.filter((r) => r.estado_acceso === 'fallido');
  const bloqueados = profiles.filter((p) => p.status === 'bloqueado');
  const accesosBloqueados = registro.filter((r) => r.estado_acceso === 'bloqueado');

  // IPs con múltiples intentos fallidos
  const ipCounts: Record<string, number> = {};
  intentosFallidos.forEach((r) => {
    const ip = r.direccion_ip || '—';
    ipCounts[ip] = (ipCounts[ip] || 0) + 1;
  });
  const ipsSospechosas = Object.entries(ipCounts)
    .filter(([, c]) => c >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  // Ubicaciones inusuales (fuera de España)
  const ubicacionesInusuales = registro.filter((r) => r.pais && r.pais !== 'España' && r.pais !== 'Spain' && r.estado_acceso === 'correcto').slice(0, 8);

  // Múltiples sesiones simultáneas por usuario
  const activas = registro.filter((r) => r.estado_sesion === 'activa');
  const sesionesPorUsuario: Record<string, number> = {};
  activas.forEach((r) => {
    const u = r.usuario || r.email;
    sesionesPorUsuario[u] = (sesionesPorUsuario[u] || 0) + 1;
  });
  const multiplesSesiones = Object.entries(sesionesPorUsuario).filter(([, c]) => c > 1).slice(0, 8);

  // Alertas recientes (derivadas)
  const alertas = [
    ...(ipsSospechosas.length > 0 ? [{ nivel: 'critica', txt: `${ipsSospechosas.length} IP con múltiples intentos fallidos`, icon: AlertTriangle }] : []),
    ...(bloqueados.length > 0 ? [{ nivel: 'advertencia', txt: `${bloqueados.length} usuario(s) bloqueado(s)`, icon: Ban }] : []),
    ...(ubicacionesInusuales.length > 0 ? [{ nivel: 'advertencia', txt: `${ubicacionesInusuales.length} acceso(s) desde ubicaciones inusuales`, icon: MapPin }] : []),
    ...(multiplesSesiones.length > 0 ? [{ nivel: 'info', txt: `${multiplesSesiones.length} usuario(s) con sesiones simultáneas`, icon: Users }] : []),
  ];

  const NIVEL_STYLE = {
    critica: 'border-danger-border bg-danger-soft text-danger',
    advertencia: 'border-warning-border bg-warning-soft text-warning',
  info: 'border-info-border bg-info-soft text-info',
  };

  const kpis = [
    { icon: ShieldAlert, label: 'Intentos fallidos', value: intentosFallidos.length, accent: 'orange' },
    { icon: Ban, label: 'Usuarios bloqueados', value: bloqueados.length, accent: 'orange' },
    { icon: Lock, label: 'Bloqueos automáticos', value: accesosBloqueados.length, accent: 'orange' },
    { icon: KeyRound, label: '2FA habilitado', value: `${usersWith2FA}/${profiles.length || 0}`, accent: 'blue' },
  ];

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-heading text-xl font-bold text-foreground flex items-center gap-2">
            <Shield className="w-5 h-5 text-primary" /> Panel de Seguridad
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            Supervisión de accesos y amenazas · Actualizado {lastUpdate.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>
      </div>

      {/* KPIs seguridad */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {kpis.map((k) => (
          <div key={k.label} className="glass-card p-4">
            <div className="flex items-center gap-2 mb-2">
              <k.icon className={`w-4 h-4 ${k.accent === 'orange' ? 'text-accent' : 'text-primary'}`} />
              <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground/70">{k.label}</span>
            </div>
            <p className="font-heading text-2xl font-bold text-foreground">{k.value}</p>
          </div>
        ))}
      </div>

      {/* Alertas */}
      <div className="glass-card p-5">
        <h3 className="font-heading text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-accent" /> Alertas de seguridad
        </h3>
        {alertas.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4 text-center">No hay alertas activas. El sistema está seguro.</p>
        ) : (
          <div className="space-y-2">
            {alertas.map((a, i) => (
              <div key={i} className={`flex items-center gap-3 px-3 py-2.5 border rounded ${NIVEL_STYLE[a.nivel]}`}>
                <a.icon className="w-4 h-4 shrink-0" />
                <p className="text-xs text-foreground">{a.txt}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* IPs sospechosas */}
        <div className="glass-card p-5">
          <h3 className="font-heading text-sm font-semibold text-foreground mb-1 flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-accent" /> IPs con intentos fallidos
          </h3>
          <p className="text-xs text-muted-foreground mb-4">Direcciones con 3 o más intentos fallidos</p>
          {ipsSospechosas.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">No se detectan IPs sospechosas.</p>
          ) : (
            <div className="space-y-2">
              {ipsSospechosas.map(([ip, count]) => (
                <div key={ip} className="flex items-center justify-between px-3 py-2 border border-border-subtle rounded">
                  <span className="font-mono text-xs text-foreground">{ip}</span>
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-mono uppercase border border-danger-border bg-danger-soft text-danger rounded">
                    {count} intentos
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Usuarios bloqueados */}
        <div className="glass-card p-5">
          <h3 className="font-heading text-sm font-semibold text-foreground mb-1 flex items-center gap-2">
            <Ban className="w-4 h-4 text-accent" /> Usuarios bloqueados
          </h3>
          <p className="text-xs text-muted-foreground mb-4">Cuentas con acceso restringido</p>
          {bloqueados.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">No hay usuarios bloqueados.</p>
          ) : (
            <div className="space-y-2">
              {bloqueados.map((p) => (
                <div key={p.id} className="flex items-center justify-between px-3 py-2 border border-border-subtle rounded">
                  <div className="min-w-0">
                    <p className="text-xs text-foreground truncate">{p.nombre} {p.apellidos}</p>
                    <p className="text-[10px] text-muted-foreground/60 truncate">{p.email}</p>
                  </div>
                  <span className={`inline-block px-2 py-0.5 text-[10px] font-mono uppercase border rounded ${rolBadgeClass(p.role || 'alumno')}`}>{p.role || 'alumno'}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Ubicaciones inusuales */}
        <div className="glass-card p-5">
          <h3 className="font-heading text-sm font-semibold text-foreground mb-1 flex items-center gap-2">
            <MapPin className="w-4 h-4 text-primary" /> Ubicaciones inusuales
          </h3>
          <p className="text-xs text-muted-foreground mb-4">Accesos correctos desde fuera de España</p>
          {ubicacionesInusuales.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">No se detectan accesos inusuales.</p>
          ) : (
            <div className="space-y-2">
              {ubicacionesInusuales.map((r) => (
                <div key={r.id} className="flex items-center justify-between px-3 py-2 border border-border-subtle rounded">
                  <div className="min-w-0">
                    <p className="text-xs text-foreground truncate">{r.nombre_completo || r.usuario}</p>
                    <p className="text-[10px] text-muted-foreground/60">{r.ciudad}, {r.pais}</p>
                  </div>
                  <span className="text-[10px] font-mono text-muted-foreground/60">{fmt(r.fecha_hora)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Sesiones simultáneas */}
        <div className="glass-card p-5">
          <h3 className="font-heading text-sm font-semibold text-foreground mb-1 flex items-center gap-2">
            <Users className="w-4 h-4 text-primary" /> Sesiones simultáneas
          </h3>
          <p className="text-xs text-muted-foreground mb-4">Usuarios con más de una sesión activa</p>
          {multiplesSesiones.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">No hay sesiones simultáneas.</p>
          ) : (
            <div className="space-y-2">
              {multiplesSesiones.map(([u, count]) => (
                <div key={u} className="flex items-center justify-between px-3 py-2 border border-border-subtle rounded">
                  <span className="text-xs text-foreground truncate">{u}</span>
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-mono uppercase border border-info-border bg-info-soft text-info rounded">
                    {count} sesiones
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 2FA / estado autenticación */}
      <div className="glass-card p-5">
        <h3 className="font-heading text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
          <KeyRound className="w-4 h-4 text-primary" /> Autenticación de doble factor (2FA)
        </h3>
        {!smtpConfigured && authPolicy.enabled && (
          <div className="mb-4 flex items-start gap-3 px-4 py-3 border border-danger-border bg-danger-soft rounded text-danger/80">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold">2FA activa, pero SMTP no está operativo</p>
              <p className="text-xs text-danger/70 mt-1">
                Los códigos de acceso no se enviarán por email mientras falten credenciales SMTP reales.
                Revise EMAIL_HOST_USER y EMAIL_HOST_PASSWORD antes de exigir 2FA a usuarios reales.
              </p>
            </div>
          </div>
        )}
        <div className="grid md:grid-cols-3 gap-3">
          <div className={`px-4 py-3 border rounded ${authPolicy.enabled ? 'border-success-border bg-success-soft/60' : 'border-warning-border bg-warning-soft/60'}`}>
            <p className="text-xs text-foreground">Estado global</p>
            <p className={`text-sm font-bold mt-1 ${authPolicy.enabled ? 'text-success' : 'text-warning'}`}>{authPolicy.enabled ? 'Habilitado' : 'Deshabilitado'}</p>
          </div>
          <div className="px-4 py-3 border border-border-subtle bg-surface-subtle rounded">
            <p className="text-xs text-foreground">Usuarios con 2FA</p>
            <p className="text-sm font-bold text-foreground mt-1">{usersWith2FA} / {profiles.length}</p>
          </div>
          <div className="px-4 py-3 border border-border-subtle bg-surface-subtle rounded">
            <p className="text-xs text-foreground">Roles obligatorios</p>
            <p className="text-sm font-bold text-primary mt-1">{authPolicy.enabled && authPolicy.required_roles.length ? authPolicy.required_roles.join(', ') : 'Sin roles obligatorios'}</p>
          </div>
        </div>

        <div className="mt-4 grid md:grid-cols-2 gap-4">
          <label className="flex items-center justify-between gap-3 px-4 py-3 border border-border-subtle rounded bg-surface-subtle">
            <span>
              <span className="block text-sm text-foreground">Activar 2FA</span>
              <span className="block text-xs text-muted-foreground">Habilita el segundo factor en login por contraseña.</span>
            </span>
            <input type="checkbox" checked={authPolicy.enabled} onChange={(e) => updatePolicy({ enabled: e.target.checked })} />
          </label>
          <div className="px-4 py-3 border border-border-subtle rounded bg-surface-subtle space-y-2">
            <p className="text-sm text-foreground">Obligatorio por rol</p>
            {['admin', 'instructor', 'alumno'].map((role) => (
              <label key={role} className="flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={authPolicy.required_roles.includes(role)}
                  onChange={(e) => {
                    const nextRoles = e.target.checked
                      ? [...authPolicy.required_roles, role]
                      : authPolicy.required_roles.filter((item) => item !== role);
                    updatePolicy({ required_roles: nextRoles });
                  }}
                />
                <span>{role}</span>
              </label>
            ))}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
