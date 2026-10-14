export const BACKUP_SLOTS = [
  { role: 'local', label: 'Copias de seguridad locales' },
  { role: 'external_1', label: 'Servidor externo de copias 1' },
  { role: 'external_2', label: 'Servidor externo de copias 2' },
] as const;

const legacyNames = { local: 'Servidor local', external_1: 'Servidor externo 1', external_2: 'Servidor externo 2' };
export const backupDisplayName = (name: string, role: string) => name && name !== legacyNames[role]
  ? name : BACKUP_SLOTS.find(slot => slot.role === role)?.label || 'Servidor de copias de seguridad';

export const INFORMATION_UNAVAILABLE = 'No se puede consultar esta información actualmente.';
export const infrastructureState = (value?: string) => ({
  NOT_CONFIGURED: 'Pendiente de configuración', CONFIGURED: 'Configuración guardada, pendiente de comprobación',
  VALIDATING: 'Comprobación en curso', VERIFIED: 'Comprobación verificada', ACTIVE: 'Conexión activa verificada',
  DEGRADED: 'Algunos servicios requieren atención', DISCONNECTED: 'Desconectada', FAILED: 'La comprobación ha fallado',
  BLOCKED: 'Configuración pendiente o servicio no disponible.', NOT_RUN: 'Pendiente de comprobación',
  PASS: 'Comprobación correcta', FAIL: 'La comprobación ha fallado', 'N/A': 'No corresponde',
  running: 'En funcionamiento', stopped: 'Detenido', unavailable: INFORMATION_UNAVAILABLE,
})[value || 'NOT_RUN'] || 'Estado desconocido: no hay una comprobación válida.';

export const infrastructureMessage = (value?: string, fallback = INFORMATION_UNAVAILABLE) => ({
  STALE_OR_INVALID_AGENT_MESSAGE: 'No se han recibido datos válidos del servicio de supervisión VPN.',
  INVALID_AGENT_MESSAGE: 'No se han recibido datos válidos del servicio de supervisión VPN.',
  INVALID_AGENT_SIGNATURE: 'No se ha podido verificar el origen de los datos del servicio de supervisión VPN.',
  INVALID_AGENT_CONFIGURATION: 'El servicio de supervisión VPN necesita revisar su configuración.',
  AGENT_NOT_CONFIGURED: 'El servicio de supervisión VPN está pendiente de configuración.',
  AGENT_UNAVAILABLE: 'El servicio de supervisión VPN no está disponible; no se puede verificar la conexión.',
  WG_UNAVAILABLE: 'WireGuard no está disponible en el equipo que gestiona la VPN.',
  WG_QUERY_DENIED: 'El servicio de supervisión no tiene permiso para consultar WireGuard.',
  INTERFACE_NOT_SELECTED_OR_UNAVAILABLE: 'Selecciona un adaptador VPN detectado o revisa su disponibilidad en el equipo.',
  CONFIGURATION_RUNTIME_MISMATCH: 'La configuración guardada no coincide con los datos detectados en el equipo.',
  'Handshake unavailable': 'Todavía no se ha verificado la comunicación con el otro equipo.',
  'Peer disconnected': 'El equipo remoto no tiene una conexión VPN activa verificada.',
  'No disponible': INFORMATION_UNAVAILABLE,
  legacy_operation_error: 'La operación anterior registró un error.',
  destination_or_generation_failed: 'Falló la creación de la copia o la conexión con alguno de sus servidores.',
})[value || ''] || (!value || /^[A-Z_\d]+$/.test(value) || /^[a-z\d]+(?:_[a-z\d]+)+$/.test(value) ? fallback : value);

export const platformLabel = (value?: string) => ({ windows: 'Windows', linux: 'Linux', other: 'Otro entorno', unknown: 'No identificado' })[value || ''] || 'No identificado';
export const validationLabel = (value: string) => ({ syntax: 'Configuración', host: 'Equipo anfitrión', agent: 'Servicio de supervisión VPN',
  network_conflicts: 'Conflictos de red', vpn: 'Conexión VPN', infrastructure: 'Datos del servidor', server_dns: 'Dirección del servidor',
  save: 'Configuración guardada', export_public_configuration: 'Configuración descargada', service_observation: 'Supervisión de servicios',
})[value] || 'Comprobación de servicios';

// Suggestions are public observations, never credentials or evidence of connectivity.
// Only fill missing values; a saved value or an intentional edit must be preserved.
export function vpnDraftFromObservation(saved, observation) {
  const draft = structuredClone(saved);
  if (observation?.agent_state !== 'VERIFIED') return draft;
  const names = Array.isArray(observation.interfaces) ? observation.interfaces.filter(name => typeof name === 'string') : [];
  if (!draft.interface) draft.interface = observation.interface || (names.length === 1 ? names[0] : '');
  if (!observation.interface || observation.interface !== draft.interface) return draft;
  if (!draft.public_key && observation.public_key) draft.public_key = observation.public_key;
  if (!draft.port && Number.isInteger(observation.listen_port) && observation.listen_port > 0) draft.port = observation.listen_port;
  // This endpoint's address is configured data. Only a matching identity confirms it was observed.
  if (!draft.address && !observation.error && observation.ip_address) draft.address = observation.ip_address;
  if (!draft.peers.length && Array.isArray(observation.peers)) {
    draft.peers = observation.peers.filter(peer => typeof peer.public_key === 'string' && peer.public_key
      && typeof peer.endpoint === 'string' && Array.isArray(peer.allowed_ips) && Number.isInteger(peer.keepalive))
      .map(({ public_key, endpoint, allowed_ips, keepalive }) => ({ public_key, endpoint, allowed_ips: [...allowed_ips], keepalive }));
  }
  return draft;
}

// Both screens edit the same versioned row. Preserve changes in the other screen,
// reject conflicts in the fields being edited, then retain the backend revision check.
export function mergeInfrastructureDraft(base, draft, fresh, section: 'vpn' | 'setup') {
  const fields = section === 'vpn' ? ['vpn'] : ['host_platform', 'server_name', 'server_address', 'installation', 'timezone', 'step', 'paths', 'reserved_networks'];
  const merged = structuredClone(fresh);
  for (const key of fields) {
    if (JSON.stringify(draft[key]) === JSON.stringify(base[key])) continue;
    if (JSON.stringify(fresh[key]) !== JSON.stringify(base[key]) && JSON.stringify(fresh[key]) !== JSON.stringify(draft[key])) {
      throw new Error('Esta configuración cambió en otra ventana. Actualiza los datos antes de guardar; tus cambios pendientes se conservan.');
    }
    merged[key] = structuredClone(draft[key]);
  }
  return merged;
}

export function availableStorage(server) {
  const total = server?.disk_total_bytes, used = server?.disk_used_bytes;
  return Number.isFinite(total) && total > 0 && Number.isFinite(used) && used >= 0 && used <= total
    ? `${(total - used).toLocaleString('es-ES')} bytes` : 'Pendiente de comprobación';
}
