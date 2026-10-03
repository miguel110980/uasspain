import PanelModal from '@/components/ui/PanelModal';
import React from 'react';
import { AnimatePresence } from 'framer-motion';
import { X, Globe, Monitor, Clock, MapPin, Activity } from 'lucide-react';

const FIELD_GROUPS = [
  {
    icon: Activity, title: 'Información del acceso',
    fields: ['id', 'fecha_hora', 'estado_acceso', 'motivo_fallo', 'metodo_autenticacion', 'ultima_actividad'],
  },
  {
    icon: Globe, title: 'Usuario',
    fields: ['usuario', 'nombre_completo', 'email', 'rol'],
  },
  {
    icon: MapPin, title: 'Geolocalización',
    fields: ['direccion_ip', 'pais', 'ciudad', 'region', 'isp', 'hostname', 'zona_horaria'],
  },
  {
    icon: Monitor, title: 'Dispositivo',
    fields: ['navegador', 'version_navegador', 'sistema_operativo', 'tipo_dispositivo'],
  },
  {
    icon: Clock, title: 'Sesión',
    fields: ['session_id', 'estado_sesion', 'tiempo_sesion', 'fecha_cierre'],
  },
];

const LABELS = {
  id: 'ID', fecha_hora: 'Fecha y hora', estado_acceso: 'Estado del acceso', motivo_fallo: 'Motivo del fallo',
  metodo_autenticacion: 'Método de autenticación', ultima_actividad: 'Última actividad',
  usuario: 'Usuario', nombre_completo: 'Nombre completo', email: 'Email', rol: 'Rol',
  direccion_ip: 'Dirección IP', pais: 'País', ciudad: 'Ciudad', region: 'Región', isp: 'ISP',
  hostname: 'Hostname', zona_horaria: 'Zona horaria',
  navegador: 'Navegador', version_navegador: 'Versión del navegador',
  sistema_operativo: 'Sistema operativo', tipo_dispositivo: 'Tipo de dispositivo',
  session_id: 'ID de sesión', estado_sesion: 'Estado de la sesión',
  tiempo_sesion: 'Tiempo de sesión', fecha_cierre: 'Fecha de cierre',
};

const ACCESS_BADGE = {
  correcto: 'border-success-border bg-success-soft text-success',
  fallido: 'border-danger-border bg-danger-soft text-danger',
  bloqueado: 'border-warning-border bg-warning-soft text-warning',
  expirado: 'border-info-border bg-info-soft text-info',
};
const SESSION_BADGE = {
  activa: 'border-success-border bg-success-soft text-success',
  finalizada: 'border-info-border bg-info-soft text-info',
  expirada: 'border-warning-border bg-warning-soft text-warning',
};

const formatVal = (key, val) => {
  if (val == null || val === '') return '—';
  if (key === 'fecha_hora' || key === 'fecha_cierre' || key === 'ultima_actividad') {
    const d = new Date(val);
    return Number.isNaN(d.getTime()) ? String(val) : d.toLocaleString('es-ES');
  }
  if (key === 'tiempo_sesion') {
    const total = Number(val);
    if (Number.isNaN(total)) return String(val);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }
  if (key === 'session_id') return val;
  if (key === 'estado_acceso') return <span className={`inline-flex px-2 py-0.5 text-[10px] font-mono uppercase tracking-widest border ${ACCESS_BADGE[val] || ''}`}>{val}</span>;
  if (key === 'estado_sesion') return <span className={`inline-flex px-2 py-0.5 text-[10px] font-mono uppercase tracking-widest border ${SESSION_BADGE[val] || ''}`}>{val}</span>;
  return String(val);
};

export default function ConexionesDetailModal({ record, onClose }) {
  return (
    <AnimatePresence>
      {record && (
        <PanelModal label="Detalles de la conexion" onClose={onClose} className="glass-card max-w-3xl no-scrollbar">
            <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 border-b border-border-subtle bg-card/90 backdrop-blur-xl">
              <div>
                <h3 className="font-heading text-lg font-bold text-foreground">Detalle del registro de conexión</h3>
                <p className="text-xs text-muted-foreground font-mono mt-0.5">{record.id}</p>
              </div>
              <button onClick={onClose} aria-label="Cerrar" className="text-muted-foreground hover:text-foreground transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-6">
              {FIELD_GROUPS.map((group) => (
                <div key={group.title}>
                  <div className="flex items-center gap-2 mb-3">
                    <group.icon className="w-4 h-4 text-primary" />
                    <h4 className="font-heading text-xs font-bold uppercase tracking-widest text-foreground">{group.title}</h4>
                  </div>
                  <div className="grid sm:grid-cols-2 gap-3">
                    {group.fields.map((key) => (
                      <div key={key} className="p-3 border border-border-subtle bg-surface-subtle rounded">
                        <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground/60 mb-1">{LABELS[key]}</p>
                        <p className="text-sm text-foreground break-all">{formatVal(key, record[key])}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </PanelModal>
      )}
    </AnimatePresence>
  );
}
