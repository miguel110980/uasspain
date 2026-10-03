import { useCallback, useEffect, useState } from 'react';
import conexionesService from '@/services/conexionesService';

/** Mapa profileId → true si tiene sesión activa (registros-conexion). */
export function useActiveProfileSessions() {
  const [conectados, setConectados] = useState({});

  const load = useCallback(async () => {
    const data = await conexionesService.sesionesActivas();
    if (!Array.isArray(data)) return;
    const estado = {};
    data.forEach((r) => {
      const profileId = r.profile ?? r.profile_id;
      if (profileId) estado[String(profileId)] = true;
    });
    setConectados(estado);
  }, []);

  useEffect(() => {
    void load().catch(() => setConectados({}));
    const timer = setInterval(() => { void load().catch(() => setConectados({})); }, 15000);
    const unsubscribe = conexionesService.subscribeConexiones((event) => {
      const payload = conexionesService.parseWsPayload(event);
      if (payload?.type === 'conexion' || payload?.type === 'resync_required' || event.type === 'poll') void load().catch(() => setConectados({}));
    });
    return () => { clearInterval(timer); unsubscribe(); };
  }, [load]);

  const isOnline = useCallback((profileId) => Boolean(conectados[String(profileId)]), [conectados]);

  return { conectados, isOnline, refresh: load };
}
