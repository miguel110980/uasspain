/** Utilidades para chat staff (admin ↔ instructor). */

/**
 * @param {string} idA
 * @param {string} idB
 */
export function staffChatRoomId(idA, idB) {
  const [a, b] = [String(idA), String(idB)].sort();
  return `staff-${a}-${b}`;
}

/**
 * @param {{ id?: string, remitente_id?: string, destinatario_id?: string }} msg
 * @param {string} myProfileId
 */
export function staffMessageFromMe(msg, myProfileId) {
  return String(msg.remitente_id) === String(myProfileId);
}

/**
 * @param {object} profile
 */
export function profileDisplayName(profile) {
  if (!profile) return '—';
  const name = `${profile.nombre || ''} ${profile.apellidos || ''}`.trim();
  return name || profile.email || '—';
}

/** @param {string} myProfileId */
export function staffChatPeerStorageKey(myProfileId) {
  return `staff-chat-peer-${myProfileId}`;
}

/**
 * Lista de peers staff (perfiles + historial de mensajes).
 * @param {{
 *   myProfileId: string,
 *   profiles: object[],
 *   staffMsgs: object[],
 *   roleFilter: (p: object) => boolean,
 *   fallbackRole: string,
 *   fallbackLabel: string,
 * }} opts
 */
export function buildStaffPeers({
  myProfileId,
  profiles,
  staffMsgs,
  roleFilter,
  fallbackRole,
  fallbackLabel,
}) {
  const byId = new Map(
    profiles
      .filter((p) => roleFilter(p) && p.status === 'activo' && p.id !== myProfileId)
      .map((p) => [String(p.id), p]),
  );
  staffMsgs.forEach((m) => {
    const peerId = staffMessageFromMe(m, myProfileId) ? m.destinatario_id : m.remitente_id;
    if (!peerId || String(peerId) === String(myProfileId) || byId.has(String(peerId))) return;
    const nombre = staffMessageFromMe(m, myProfileId) ? m.destinatario_nombre : m.remitente_nombre;
    byId.set(String(peerId), {
      id: peerId,
      nombre: (nombre || fallbackLabel).split(' ')[0] || fallbackLabel,
      apellidos: (nombre || '').split(' ').slice(1).join(' '),
      status: 'activo',
      role: fallbackRole,
      ...(fallbackRole === 'admin' ? { roles: ['admin'] } : {}),
    });
  });
  return Array.from(byId.values());
}

/**
 * @param {object[]} staffMsgs
 * @param {string} myProfileId
 */
export function countStaffUnread(staffMsgs, myProfileId) {
  return staffMsgs.filter(
    (m) => String(m.destinatario_id) === String(myProfileId) && !m.leido_destinatario,
  ).length;
}
