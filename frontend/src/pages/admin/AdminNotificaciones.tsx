import DataLoadNotice from '@/components/ui/DataLoadNotice';
import React, { useEffect, useState, useRef } from 'react';
import { motion } from 'framer-motion';
import { Bell, CheckCircle2, AlertTriangle, Loader2, X } from 'lucide-react';
import authService from '@/services/authService';
import examenesService from '@/services/examenesService';
import { useRefreshableLoad } from '@/hooks/useRefreshableLoad';

const TIPO = {
  success: { icon: CheckCircle2, color: 'text-success', border: 'border-success-border bg-success-soft/60' },
  warning: { icon: AlertTriangle, color: 'text-warning', border: 'border-warning-border bg-warning-soft/60' },
  info: { icon: Bell, color: 'text-primary', border: 'border-primary/20 bg-primary/5' },
};

const fmt = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return 'Hace un momento';
  if (diff < 3600) return `Hace ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `Hace ${Math.floor(diff / 3600)} h`;
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' });
};

export default function AdminNotificaciones() {
  const [notifs, setNotifs] = useState([]);
  const [leidas, setLeidas] = useState(new Set());
  const { loading, lastUpdate, runLoad, error: loadError } = useRefreshableLoad();
  const hasData = useRef(false);

  const load = (manual = false) => {
    runLoad(async () => {
    const [profiles, status, pendientesRegistro] = await Promise.all([
      authService.listProfiles('-created_date', 200),
      authService.getSystemStatus(),
      authService.listProfiles('created_date', 200, { status: 'pendiente' }),
    ]);

    const lista = [];
    const now = Date.now();

    if (!status.smtp?.configured) {
      lista.push({
        id: 'smtp-missing',
        tipo: 'warning',
        titulo: 'SMTP no configurado',
        desc: 'Los emails (OTP, reset, contacto) no se enviarán hasta configurar EMAIL_HOST_PASSWORD.',
        fecha: new Date().toISOString(),
      });
    }

    if (!status.google_oauth?.configured) {
      lista.push({
        id: 'oauth-missing',
        tipo: 'info',
        titulo: 'Google OAuth no configurado',
        desc: 'Configura y habilita el Client ID de Google Cloud en Configuración → Integraciones. La configuración guardada en el panel tiene prioridad sobre el entorno.',
        fecha: new Date().toISOString(),
      });
    }

    const dbOk = status.platform?.database_connected;
    if (status.platform && dbOk === false) {
      lista.push({
        id: 'storage-error',
        tipo: 'warning',
        titulo: 'Base de datos con incidencias',
        desc: 'Compruebe PostgreSQL y las variables DB_* del .env raíz.',
        fecha: new Date().toISOString(),
      });
    }

    if (status.redis?.configured && !status.redis.connected) {
      lista.push({
        id: 'redis-error',
        tipo: 'warning',
        titulo: 'Redis no responde',
        desc: 'Los WebSockets en tiempo real pueden no funcionar correctamente.',
        fecha: new Date().toISOString(),
      });
    }

    if (pendientesRegistro.length > 0) {
      lista.push({
        id: 'users-pending',
        tipo: 'info',
        titulo: `${pendientesRegistro.length} usuario(s) pendiente(s) de validación`,
        desc: 'Aprueba o rechaza solicitudes desde Gestión de Usuarios.',
        fecha: pendientesRegistro[0]?.created_date || new Date().toISOString(),
      });
    }

    const recientes = profiles.filter(
      (p) => p.created_date && now - new Date(p.created_date).getTime() < 86400000 * 3,
    );
    if (recientes.length > 0) {
      lista.push({
        id: 'users-recent',
        tipo: 'success',
        titulo: `${recientes.length} registro(s) en los últimos 3 días`,
        desc: 'Nuevas cuentas creadas en la plataforma.',
        fecha: recientes[0].created_date,
      });
    }

    const bloqueados = profiles.filter((p) => p.status === 'bloqueado');
    if (bloqueados.length > 0) {
      lista.push({
        id: 'users-blocked',
        tipo: 'warning',
        titulo: `${bloqueados.length} cuenta(s) bloqueada(s)`,
        desc: 'Revisa el estado en Gestión de Usuarios si es necesario.',
        fecha: bloqueados[0]?.updated_date || new Date().toISOString(),
      });
    }

    try {
      const resultados = await examenesService.resultados.list('-created_date', 50);
      const hoy = resultados.filter((r) => r.fecha && now - new Date(r.fecha).getTime() < 86400000);
      if (hoy.length > 0) {
        lista.push({
          id: 'exams-today',
          tipo: 'success',
          titulo: `${hoy.length} examen(es) completado(s) hoy`,
          desc: 'Actividad académica reciente de alumnos.',
          fecha: hoy[0].fecha,
        });
      }
    } catch {
      // sin permiso o sin datos
    }

    lista.sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime());
    setNotifs(lista);
    hasData.current = true;
  }, { manual, silent: !manual && hasData.current }).catch(() => {
    setNotifs([]);
  });
  };

  useEffect(() => {
    load();
    const timer = setInterval(() => load(false), 60000);
    return () => clearInterval(timer);
  }, []);

  const marcarLeida = (id) => setLeidas((prev) => new Set(prev).add(id));
  const marcarTodas = () => setLeidas(new Set(notifs.map((n) => n.id)));
  const noLeidas = notifs.filter((n) => !leidas.has(n.id)).length;

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
      <DataLoadNotice error={loadError} retry={() => load(true)} />
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-heading text-xl font-bold text-foreground flex items-center gap-2">
            <Bell className="w-5 h-5 text-primary" /> Notificaciones del sistema
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            {noLeidas} sin leer · {notifs.length} totales · Actualizado {lastUpdate.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={marcarTodas} className="px-3 py-2 border border-border-subtle text-xs font-mono uppercase tracking-widest text-muted-foreground hover:border-primary/30 hover:text-primary rounded transition-all">
            Marcar todo leído
          </button>
        </div>
      </div>

      <div className="glass-card p-2 space-y-2">
        {loading && notifs.length === 0 ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="w-6 h-6 text-primary animate-spin" />
          </div>
        ) : notifs.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-10">No hay alertas pendientes. Todo en orden.</p>
        ) : notifs.map((n) => {
          const t = TIPO[n.tipo] || TIPO.info;
          const leida = leidas.has(n.id);
          return (
            <div
              key={n.id}
              className={`flex items-start gap-3 px-4 py-3 border rounded transition-all ${t.border} ${leida ? 'opacity-50' : ''}`}
            >
              <t.icon className={`w-5 h-5 shrink-0 mt-0.5 ${t.color}`} />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-foreground font-medium">{n.titulo}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{n.desc}</p>
                <p className="text-[10px] font-mono text-muted-foreground/50 mt-1">{fmt(n.fecha)}</p>
              </div>
              {!leida && (
                <button aria-label="Marcar como leída" onClick={() => marcarLeida(n.id)} className="shrink-0 text-muted-foreground hover:text-primary transition-colors" title="Marcar como leída">
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}
