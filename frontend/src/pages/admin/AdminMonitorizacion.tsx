import DataLoadNotice from '@/components/ui/DataLoadNotice';
import React, { useEffect, useState, useRef } from 'react';
import { motion } from 'framer-motion';
import {
  Server, Wifi, Globe, Mail, Activity, Loader2, Cpu, HardDrive, MemoryStick,
} from 'lucide-react';
import authService from '@/services/authService';
import { useRefreshableLoad } from '@/hooks/useRefreshableLoad';
import { buildMonitorServices, buildHostResourceCards, statusUiFor } from '@/lib/systemStatus';

const ICONS = {
  globe: Globe,
  wifi: Wifi,
  mail: Mail,
  activity: Activity,
  server: Server,
  cpu: Cpu,
  memory: MemoryStick,
  disk: HardDrive,
};

/**
 * @param {string | undefined} iconKey
 */
function monitorIconFor(iconKey) {
  if (iconKey && iconKey in ICONS) {
    return ICONS[/** @type {keyof typeof ICONS} */ (iconKey)];
  }
  return Activity;
}

/** @typedef {'ok' | 'warn' | 'err'} ServiceStatus */

/**
 * @param {{ percent?: number | null, status?: ServiceStatus | string }} props
 */
function MetricBar({ percent, status }) {
  if (percent == null) return null;
  const barColor = status === 'err' ? 'bg-danger' : status === 'warn' ? 'bg-warning' : 'bg-success';
  return (
    <div className="mt-3 h-1.5 w-full bg-surface rounded-full overflow-hidden">
      <div
        className={`h-full rounded-full transition-all duration-500 ${barColor}`}
        style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
      />
    </div>
  );
}

/**
 * @param {{ s: { name: string, iconKey?: string, status?: string, value: string, desc?: string, percent?: number | null } }} props
 */
function ServiceCard({ s }) {
  const st = statusUiFor(s.status);
  const Icon = monitorIconFor(s.iconKey);
  return (
    <div className="glass-card p-5 min-w-0">
      <div className="flex flex-wrap gap-2 items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold text-foreground">{s.name}</span>
        </div>
        <span className={`flex items-center gap-1.5 text-[10px] font-mono uppercase ${st.text}`}>
          <span className={`w-2 h-2 rounded-full ${st.dot}`} /> {st.label}
        </span>
      </div>
      <p className="text-2xl font-heading font-bold text-foreground break-words">{s.value}</p>
      <p className="text-xs text-muted-foreground mt-1 truncate" title={s.desc}>{s.desc}</p>
      <MetricBar percent={s.percent} status={s.status} />
    </div>
  );
}

export default function AdminMonitorizacion() {
  const [status, setStatus] = useState(null);
  const { loading, lastUpdate, runLoad, error: loadError } = useRefreshableLoad();
  const hasData = useRef(false);

  const load = (manual = false) => runLoad(async () => {
    setStatus(await authService.getSystemStatus());
    hasData.current = true;
  }, { manual, silent: !manual && hasData.current });

  useEffect(() => {
    load();
    const timer = setInterval(() => load(false), 30000);
    return () => clearInterval(timer);
  }, []);

  if (loading && !status) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  const servicios = buildMonitorServices(status).map((s) => ({
    ...s,
    iconKey: s.iconKey,
    percent: null,
  }));

  const recursos = buildHostResourceCards(status);

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
      <DataLoadNotice error={loadError} retry={() => load(true)} />
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-heading text-xl font-bold text-foreground flex items-center gap-2">
            <Activity className="w-5 h-5 text-primary" /> Monitorización
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            Estado en tiempo real · Actualizado {lastUpdate.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>
      </div>

      <div>
        <h3 className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-3">
          {status?.host?.scope || 'Recursos disponibles'}
        </h3>
        <div className="grid sm:grid-cols-3 gap-4">
          {recursos.map((s) => (
            <ServiceCard key={s.name} s={s} />
          ))}
        </div>
      </div>

      <div>
        <h3 className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-3">
          Servicios
        </h3>
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {servicios.map((s) => (
            <ServiceCard key={s.name} s={s} />
          ))}
        </div>
      </div>
    </motion.div>
  );
}
