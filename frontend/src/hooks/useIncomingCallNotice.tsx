import React, { useCallback, useRef } from 'react';
import { useToast } from '@/components/ui/use-toast';

type Call = { id: string; iniciador_id?: string; estado?: string };

/** Use the already-authorized call list; do not fetch or broaden recipients. */
export function useIncomingCallNotice(profileId: string | undefined, openCall: () => void) {
  const { toast } = useToast();
  const seen = useRef(new Set<string>());
  const open = useRef(openCall);
  open.current = openCall;
  return useCallback((calls: Call[]) => {
    if (!profileId) return;
    for (const call of calls) {
      if (!call.iniciador_id || String(call.iniciador_id) === String(profileId) || call.estado !== 'activa' || seen.current.has(call.id)) continue;
      seen.current.add(call.id);
      toast({ title: 'Llamada entrante', description: 'Tienes una videollamada pendiente de aceptar o rechazar.', duration: 15_000,
        action: <button type="button" className="px-3 py-2 border border-border-subtle text-sm" onClick={() => open.current()}>Ver llamada</button> });
    }
  }, [profileId, toast]);
}
