import { useCallback, useEffect, useState } from 'react';
import conexionesService from '@/services/conexionesService';

/** Mapa profileId → true si tiene sesión activa (registros-conexion). */
export function useActiveProfileSessions() {
  const [conectados, setConectados] = useState({});

  const load = useCallback(async () => {
    const data = await conexionesService.registros.list('-fecha_hora', 500, { estado_sesion: 'activa' });
    if (!Array.isArray(data)) return;
    const estado = {};
    data.forEach((r) => {
      const profileId = r.profile ?? r.profile_id;
      if (profileId) estado[String(profileId)] = true;
    });
    setConectados(estado);
  }, []);

  useEffect(() => {
    load();
    const unsubscribe = conexionesService.subscribeConexiones((event) => {
      const payload = conexionesService.parseWsPayload(event);
      if (payload?.type === 'conexion' || event.type === 'poll') load();
    });
    return unsubscribe;
  }, [load]);

  const isOnline = useCallback((profileId) => Boolean(conectados[String(profileId)]), [conectados]);

  return { conectados, isOnline, refresh: load };
}
