import { useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import PanelModal from '@/components/ui/PanelModal';
import apiClient from '@/api/apiClient';
import authService from '@/services/authService';
import { extractErrorMessage } from '@/lib/errors';

export default function AccountDeactivation() {
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [blocked, setBlocked] = useState('');
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const requestId = useRef('');
  const close = () => { if (!pending) { setOpen(false); setPassword(''); setConfirmation(''); setError(''); } };
  const prepare = async () => {
    setOpen(true); setLoading(true); setError(''); setBlocked(''); setPassword(''); setConfirmation('');
    requestId.current = crypto.randomUUID();
    try { const result = await apiClient.get('/api/account/deactivation/'); setBlocked(result.data.blocked_reason || ''); }
    catch (e) { setBlocked(extractErrorMessage(e, 'No se pudieron comprobar las condiciones de baja.')); }
    finally { setLoading(false); }
  };
  const confirm = async (event: React.FormEvent) => {
    event.preventDefault(); if (inFlight.current || pending || loading || blocked || confirmation !== 'DARME DE BAJA' || !password) return;
    inFlight.current = true;
    setPending(true); setError('');
    try {
      const result = await apiClient.post('/api/account/deactivate/', { confirmation, current_password: password, request_id: requestId.current });
      if (result.data.deactivated !== true) throw new Error('No se pudo verificar la baja.');
      setPassword(''); authService.finishDeactivation(result.data.detail);
    } catch (e) { setPassword(''); setError(extractErrorMessage(e, 'No se pudo completar la baja.')); setPending(false); inFlight.current = false; }
  };
  return <section aria-label="Baja de cuenta" className="mt-8 border-t border-danger-border pt-6 space-y-3">
    <h3 className="font-heading text-lg font-bold text-foreground">Baja de cuenta</h3>
    <p className="text-sm text-muted-foreground">Puedes deshabilitar tu cuenta sin eliminar automáticamente tu historial.</p>
    <button type="button" onClick={() => void prepare()} className="rounded-sm border border-danger-border bg-danger-soft px-5 py-3 text-sm font-bold text-danger">Dar de baja mi cuenta</button>
    {open && <PanelModal label="Confirmar baja de cuenta" onClose={close}>
      <h2 className="text-xl font-bold font-heading text-foreground mb-3">Confirmar baja de cuenta</h2>
      <p className="text-sm text-muted-foreground mb-4">Se cerrarán todas tus sesiones y quedará deshabilitado el acceso a paneles, chat, videollamadas y materiales privados. Determinados datos históricos podrán conservarse por motivos legítimos o legales, sujetos a la política de retención. La baja no es una solicitud de supresión de datos. Para volver a acceder será necesaria una reactivación autorizada.</p>
      {loading && <p role="status" className="text-sm text-muted-foreground">Comprobando condiciones…</p>}
      {blocked && <p role="alert" className="text-sm text-danger mb-4">{blocked}</p>}
      <form onSubmit={confirm} className="space-y-4">
        <div><label htmlFor="deactivation-confirmation" className="block text-sm text-foreground mb-1">Escribe DARME DE BAJA</label>
          <input id="deactivation-confirmation" autoComplete="off" value={confirmation} disabled={pending || loading || Boolean(blocked)} onChange={e => setConfirmation(e.target.value)} className="w-full min-w-0 rounded-sm border border-border-subtle bg-surface-muted p-3 text-foreground" /></div>
        <div><label htmlFor="deactivation-password" className="block text-sm text-foreground mb-1">Contraseña actual para confirmar tu identidad</label>
          <input id="deactivation-password" type="password" autoComplete="current-password" maxLength={128} value={password} disabled={pending || loading || Boolean(blocked)} onChange={e => setPassword(e.target.value)} className="w-full min-w-0 rounded-sm border border-border-subtle bg-surface-muted p-3 text-foreground" /></div>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <div className="flex flex-wrap justify-end gap-3"><button type="button" disabled={pending} onClick={close} className="border border-border-subtle rounded-sm px-4 py-3 text-foreground">Cancelar</button>
          <button type="submit" disabled={pending || loading || Boolean(blocked) || confirmation !== 'DARME DE BAJA' || !password} className="inline-flex items-center gap-2 bg-danger text-danger-foreground rounded-sm px-4 py-3 font-bold disabled:opacity-50">{pending && <Loader2 className="w-4 h-4 animate-spin" />}{pending ? 'Procesando…' : 'Confirmar baja'}</button></div>
      </form>
    </PanelModal>}
  </section>;
}
