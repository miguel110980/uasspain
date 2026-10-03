/** Estados de servicios desde GET /api/system/status/ (admin). */

export const STATUS_UI = {
  ok: { dot: 'bg-success', text: 'text-success', label: 'Operativo' },
  warn: { dot: 'bg-warning', text: 'text-warning', label: 'Advertencia' },
  err: { dot: 'bg-danger', text: 'text-danger', label: 'Error' },
};

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
  const backend = ws.backend || redis.backend || 'inmemory';
  const operational = ws.operational ?? (backend === 'inmemory' ? true : Boolean(redis.connected));

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

  const dbOk = databaseConnected(status);
  const redis = status.redis || {};
  const smtp = status.smtp || {};
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
      name: 'Usuarios activos',
      iconKey: 'server',
      status: 'ok',
      value: String((users.admin || 0) + (users.instructor || 0) + (users.alumno || 0)),
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
      value: `${cpu.percent}%`,
      desc: `${cpu.cores} núcleos lógicos`,
      percent: cpu.percent,
    },
    {
      name: 'Memoria RAM',
      iconKey: 'memory',
      status: memory.status || 'ok',
      value: `${memory.percent}%`,
      desc: `${memory.used_gb} / ${memory.total_gb} GB`,
      percent: memory.percent,
    },
    {
      name: 'Disco',
      iconKey: 'disk',
      status: disk.status || 'ok',
      value: `${disk.percent}%`,
      desc: `${disk.used_gb} / ${disk.total_gb} GB · ${disk.path}`,
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
