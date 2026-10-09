import { useEffect, useState } from 'react';
import conexionesService from '@/services/conexionesService';
import { usePanelAuthContext } from '@/context/PanelAuthContext';
import { hasRole } from '@/lib/roles';
import Videoconferencia from './Videoconferencia';

/** Uses the same video API and WebRTC engine, with an isolated staff channel. */
export default function StaffVideo({ role, peerRole: requestedPeerRole }: { role: 'admin' | 'instructor'; peerRole?: 'admin' | 'instructor' }) {
  const { profile } = usePanelAuthContext();
  const [contacts, setContacts] = useState([]);
  const [calls, setCalls] = useState([]);
  const [current, setCurrent] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const peerRole = requestedPeerRole || (role === 'instructor' ? 'admin' : 'instructor');
  const instructorChannel = role === 'instructor' && peerRole === 'instructor';
  const channel = instructorChannel ? 'instructores' : 'administracion';
  const peerId = (call) => instructorChannel
    ? String(call.instructor_id) === String(profile?.id) ? call.instructor_peer_id : call.instructor_id
    : call[role === 'instructor' ? 'administrador_id' : 'instructor_id'];
  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const [people, active] = await Promise.all([
          conexionesService.mensajesStaff.contacts(),
          conexionesService.videollamadas.filter({ canal: channel, estado: 'activa' }),
        ]);
        if (mounted) {
          setContacts(people.filter(p => String(p.id) !== String(profile?.id) && p.status === 'activo' && hasRole(p, peerRole)));
          setCalls(active);
          setCurrent(previous => previous && active.some(call => call.id === previous.id) ? previous : null);
          setError('');
        }
      } catch { if (mounted) setError('No se pudieron actualizar las videollamadas.'); }
    };
    void load();
    const unsubscribe = conexionesService.subscribeVideollamadas(() => { void load(); });
    return () => { mounted = false; unsubscribe(); };
  }, [profile?.id, peerRole, channel]);
  const callPeer = async (peer) => {
    if (String(peer.id) === String(profile?.id)) return;
    setBusy(peer.id); setError('');
    try {
      const existing = calls.find(c => String(peerId(c)) === String(peer.id));
      const call = existing || await conexionesService.videollamadas.create({
        canal: channel, estado: 'activa',
        [instructorChannel ? 'instructor_peer_id' : role === 'instructor' ? 'administrador_id' : 'instructor_id']: peer.id,
      });
      setCurrent(call);
    } catch { setError('No se pudo iniciar la videollamada. Vuelve a intentarlo.'); }
    finally { setBusy(''); }
  };
  const hangup = async () => {
    if (!current) return;
    try {
      await conexionesService.videollamadas.update(current.id, { estado: 'finalizada' });
      setCalls(previous => previous.filter(call => call.id !== current.id));
      setCurrent(null);
    } catch { setError('No se pudo finalizar la llamada. Vuelve a pulsar Colgar.'); }
  };
  if (current) return <>
    <Videoconferencia callId={current.id} displayName={`${profile?.nombre || ''} ${profile?.apellidos || ''}`.trim()} onColgar={hangup} />
    {error && <p role="alert" className="fixed bottom-4 left-4 z-[70] bg-card text-danger p-3">{error}</p>}
  </>;
  return <section aria-label={peerRole === 'admin' ? 'Videollamadas con administradores' : 'Videollamadas con instructores'} className="space-y-4">
    <h2 className="font-heading text-xl">{peerRole === 'admin' ? 'Administradores' : 'Instructores'}</h2>
    <p className="text-sm text-muted-foreground">{instructorChannel ? 'Sala privada entre instructores.' : 'Sala privada entre administrador e instructor.'} Quien inicia la llamada es el moderador.</p>
    {error && <p role="alert" className="text-danger">{error}</p>}
    {contacts.map(peer => {
      const call = calls.find(c => String(peerId(c)) === String(peer.id));
      return <article key={peer.id} className="glass-card p-4 flex items-center justify-between gap-3">
        <div><p className="font-semibold">{peer.nombre} {peer.apellidos}</p>
          {call && <p className="text-xs text-primary">{String(call.iniciador_id) === String(profile?.id) ? 'Llamada en curso' : 'Llamada entrante'}</p>}
        </div>
        <button disabled={busy === peer.id} onClick={() => { void callPeer(peer); }} className="bg-primary text-primary-foreground px-4 py-2 text-sm disabled:opacity-50">
          {busy === peer.id ? 'Conectando…' : call ? 'Unirse' : 'Llamar'}
        </button>
      </article>;
    })}
    {!contacts.length && !error && <p className="text-muted-foreground">No hay contactos disponibles.</p>}
  </section>;
}
