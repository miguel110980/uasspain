export function mergeChatMessages(current: any[], incoming: any[], roomId: string) {
  const byId = new Map<string, any>();
  for (const message of [...current, ...incoming]) {
    if (typeof message?.id !== 'string' || String(message.alumno_id) !== roomId) continue;
    byId.set(message.id, message);
  }
  return [...byId.values()].sort((a,b) => new Date(a.created_date).getTime() - new Date(b.created_date).getTime() || a.id.localeCompare(b.id));
}

export function chatFailure(error: any, operation: string) {
  if (error?.code === 'ERR_CANCELED') return '';
  const status = error?.response?.status;
  if (status === 401) return 'La sesión ha caducado. Vuelve a iniciar sesión.';
  if (status === 403) return 'Ya no tienes acceso a esta conversación.';
  if (!navigator.onLine) return 'Estás sin conexión. Los mensajes se actualizarán al recuperar la red.';
  if (['ECONNABORTED','ETIMEDOUT'].includes(error?.code)) return 'El servidor está tardando en responder. Vuelve a intentarlo.';
  if (status >= 500) return 'El chat no está disponible temporalmente. Vuelve a intentarlo.';
  return operation === 'load' ? 'No se pudieron cargar los mensajes. Inténtalo de nuevo.' : 'No se pudo completar la operación del chat.';
}
