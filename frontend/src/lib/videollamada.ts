/** @param {string} alumnoId */
export function videollamadaRoomId(alumnoId) {
  return `uasspain-${alumnoId}`;
}

/** @param {{ room_id?: string, room_name?: string } | null | undefined} llamada @param {string} [alumnoId] */
export function getVideollamadaRoom(llamada, alumnoId) {
  return llamada?.room_id || llamada?.room_name || (alumnoId ? videollamadaRoomId(alumnoId) : '');
}
