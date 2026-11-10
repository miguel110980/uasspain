/** Estados de servicios desde GET /api/system/status/ (admin). */

export const STATUS_UI = {
  ok: { dot: 'bg-success', text: 'text-success', label: 'Operativo' },
  warn: { dot: 'bg-warning', text: 'text-warning', label: 'Advertencia' },
  err: { dot: 'bg-danger', text: 'text-danger', label: 'Error' },
};

/** The backend field is an operator-maintained routing blocklist, not a TLS probe. */
export function publicTlsBlocklistStatus(hosts: unknown) {
  const available = Array.isArray(hosts)
    && hosts.every((host) => typeof host === 'string' && host.trim().length > 0);
  return {
    label: 'Bloqueos TLS configurados',
    value: !available
      ? 'No disponible; validación de certificados no comprobada.'
      : hosts.length
        ? hosts.map((host: string) => host.trim()).join(', ')
        : 'Sin bloqueos configurados; validación de certificados no comprobada.',
    estado: 'warning' as const,
  };
}

export function databaseConnected(status) {
  const p = status?.platform;
  if (!p) return false;
  if (p.database_connected != null) return Boolean(p.database_connected);
  return Boolean(p.storage_connected);
}

export function isProductionMode(status) {
  const p = status?.platform;
  if (!p) return false;
  if (p.production != null) return Boolean(p.production);
  return !p.debug;
}

export function websocketServiceStatus(status) {
  const redis = status?.redis || {};
  const ws = status?.websockets || {};
  const production = isProductionMode(status);
  const backend = ws.backend || redis.backend || 'unknown';
  const operational = ws.operational === true;

  if (backend === 'redis') {
    if (redis.connected && operational) {
      return { status: 'ok', value: 'Conectado', desc: 'Redis / WebSocket' };
    }
    return {
      status: 'err',
      value: 'Sin conexión',
      desc: redis.configured ? 'Revisa redis-server y REDIS_URL' : 'REDIS_URL no definida',
    };
  }

  if (operational) {
    return {
      status: production ? 'warn' : 'ok',
      value: production ? 'Memoria local' : 'Memoria (dev)',
      desc: production ? 'Añade REDIS_URL en producción' : 'Canal en memoria',
    };
  }

  return { status: 'warn', value: 'No disponible', desc: 'WebSockets inactivos' };
}

export function buildMonitorServices(status) {
  if (!status) return [];

  const dbOk = databaseConnected(status) && status.backend?.status === 'ok';
  const redis = status.redis || {};
  const smtp = status.smtp || {};
  const oauth = status.google_oauth || {};
  const users = status.users || {};
  const ws = websocketServiceStatus(status);

  return [
    {
      name: 'API REST',
      iconKey: 'globe',
      status: dbOk ? 'ok' : 'err',
      value: dbOk ? 'Online' : 'Degradado',
      desc: isProductionMode(status) ? 'Producción' : 'Modo desarrollo',
    },
    {
      name: 'Redis / WebSockets',
      iconKey: 'wifi',
      status: ws.status,
      value: ws.value,
      desc: ws.desc,
    },
    {
      name: 'SMTP',
      iconKey: 'mail',
      status: smtp.configured ? 'ok' : 'warn',
      value: smtp.configured ? 'Configurado' : 'Sin credenciales',
      desc: smtp.host || '—',
    },
    {
      name: 'Google OAuth',
      iconKey: 'activity',
      status: oauth.configured ? 'ok' : 'warn',
      value: oauth.configured ? 'Listo' : 'Pendiente',
      desc: oauth.configured ? 'Login social' : 'Configurar en Integraciones',
    },
    {
      name: 'Usuarios activos',
      iconKey: 'server',
      status: 'ok',
      value: users.unique_active == null ? 'N/D' : String(users.unique_active),
      desc: `${users.alumno || 0} alumnos · ${users.instructor || 0} instructores`,
    },
  ];
}

export function buildHostResourceCards(status) {
  const host = status?.host;
  if (!host?.available) {
    return [
      {
        name: 'Recursos del servidor',
        iconKey: 'cpu',
        status: 'warn',
        value: 'N/D',
        desc: host?.reason || 'Métricas no disponibles',
        percent: null,
      },
    ];
  }

  const { cpu, memory, disk } = host;
  return [
    {
      name: 'CPU',
      iconKey: 'cpu',
      status: cpu.status || 'ok',
      value: cpu.percent == null ? 'N/D' : `${Number(cpu.percent).toFixed(1)}%`,
      desc: `${cpu.cores} núcleos lógicos`,
      percent: cpu.percent,
    },
    {
      name: 'Memoria RAM',
      iconKey: 'memory',
      status: memory.status || 'ok',
      value: memory.percent == null ? 'N/D' : `${memory.percent}%`,
      desc: memory.total_gb == null ? 'Limite no disponible' : `${Number(memory.used_gb).toFixed(2)} / ${Number(memory.total_gb).toFixed(2)} GB`,
      percent: memory.percent,
    },
    {
      name: 'Disco',
      iconKey: 'disk',
      status: disk.status || 'ok',
      value: disk.percent == null ? 'N/D' : `${disk.percent}%`,
      desc: disk.total_gb == null ? 'No disponible' : `${Number(disk.used_gb).toFixed(2)} / ${Number(disk.total_gb).toFixed(2)} GB · ${disk.path}`,
      percent: disk.percent,
    },
  ];
}

/** @typedef {keyof typeof STATUS_UI} ServiceStatusKey */

/**
 * @param {string | undefined} status
 */
export function statusUiFor(status) {
  /** @type {ServiceStatusKey} */
  const key = status === 'ok' || status === 'err' ? status : 'warn';
  return STATUS_UI[key];
}
