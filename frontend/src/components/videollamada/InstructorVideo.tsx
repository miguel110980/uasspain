import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import conexionesService from '@/services/conexionesService';
import { Video, Phone, Loader2, VideoIcon, Bell, Search, User } from 'lucide-react';
import Videoconferencia from '@/components/videollamada/Videoconferencia';
import StaffVideo from './StaffVideo';
import { usePanelAuthContext } from '@/context/PanelAuthContext';
import { hasRole } from '@/lib/roles';

export default function InstructorVideo({ profiles }) {
  const { profile: ownProfile } = usePanelAuthContext();
  const [section, setSection] = useState('alumnos');
  const [llamadas, setLlamadas] = useState([]);
  const [enLlamada, setEnLlamada] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [iniciando, setIniciando] = useState({});
  const [groupLoading, setGroupLoading] = useState(false);
  const [callError, setCallError] = useState('');

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const activas = await conexionesService.videollamadas.filter({ canal: 'alumnos', estado: 'activa' });
        if (mounted) {
          setLlamadas(activas);
          setEnLlamada(previous => previous && activas.some(call => call.id === previous.id || (previous.is_conference && call.is_conference && call.room_id === previous.room_id)) ? previous : null);
          setLoading(false);
        }
      } catch {
        if (mounted) setLoading(false);
      }
    };
    load();
    const unsubscribe = conexionesService.subscribeVideollamadas(() => load());
    return () => { mounted = false; unsubscribe(); };
  }, []);

  const alumnos = (profiles || []).filter((p) => String(p.id) !== String(ownProfile?.id) &&
    (p.role || p.roles?.length) && hasRole(p, 'alumno') && p.status === 'activo' &&
    String(p.assigned_instructor_id) === String(ownProfile?.id));
  const filtered = alumnos.filter((p) => {
    const nombre = `${p.nombre || ''} ${p.apellidos || ''}`.toLowerCase();
    return nombre.includes(search.toLowerCase());
  });

  const getLlamadaActiva = (alumnoId) => llamadas.find((l) => l.alumno_id === alumnoId && l.estado === 'activa');

  const handleIniciar = async (profile) => {
    if (String(profile.id) === String(ownProfile?.id)) return;
    const nombre = `${profile.nombre || ''} ${profile.apellidos || ''}`.trim();
    setIniciando((prev) => ({ ...prev, [profile.id]: true }));
    try {
      let existente = getLlamadaActiva(profile.id);
      if (!existente) {
        existente = await conexionesService.videollamadas.create({
          alumno_id: profile.id,
          alumno_nombre: nombre,
          estado: 'activa',
          iniciada_por: 'instructor',
        });
        setLlamadas((prev) => [...prev, existente]);
      }
      setEnLlamada(existente);
    } catch {
      setCallError('No se pudo iniciar la llamada. Comprueba tu conexión y la asignación del alumno.');
    } finally {
      setIniciando((prev) => ({ ...prev, [profile.id]: false }));
    }
  };

  const handleUnirse = (llamada) => {
    setEnLlamada(llamada);
  };
  const handleRechazar = async (llamada) => {
    try {
      await conexionesService.videollamadas.update(llamada.id, { estado: 'finalizada' });
      setLlamadas(previous => previous.filter(call => call.id !== llamada.id));
    } catch { setCallError('No se pudo rechazar la llamada. Vuelve a intentarlo.'); }
  };

  const handleGroup = async () => {
    if (groupLoading) return;
    setGroupLoading(true);
    setCallError('');
    try {
      const invited = [];
      for (const profile of alumnos) {
        invited.push(await conexionesService.videollamadas.create({
          alumno_id: profile.id,
          alumno_nombre: `${profile.nombre || ''} ${profile.apellidos || ''}`.trim(),
          estado: 'activa',
          is_conference: true,
          ...(invited[0] ? { conference_call_id: invited[0].id } : {}),
        }));
      }
      setLlamadas(invited);
      if (invited[0]) setEnLlamada(invited[0]);
    } catch {
      setCallError('No se pudo invitar a todos los alumnos. Comprueba las llamadas activas y vuelve a intentarlo.');
    } finally { setGroupLoading(false); }
  };

  const handleColgar = async () => {
    if (enLlamada) {
      const activa = llamadas.find(
        (l) => l.estado === 'activa' && (l.id === enLlamada.id || (enLlamada.is_conference && l.is_conference && l.room_id === enLlamada.room_id)),
      );
      if (activa) {
        try {
          await conexionesService.videollamadas.update(activa.id, { estado: 'finalizada' });
          const rows = await conexionesService.videollamadas.filter({ canal: 'alumnos', estado: 'activa' });
          setLlamadas(rows);
        } catch { setCallError('No se pudo finalizar la llamada en el servidor. Vuelve a entrar y pulsa Colgar.'); }
      }
    }
    setEnLlamada(null);
  };

  if (enLlamada) {
    return (
      <Videoconferencia
        callId={enLlamada.id}
        displayName={`${ownProfile?.nombre || ''} ${ownProfile?.apellidos || ''}`.trim()}
        onColgar={handleColgar}
      />
    );
  }

  // Llamadas activas iniciadas por alumnos
  const llamadasEntrantes = llamadas.filter((l) => l.iniciada_por === 'alumno');
  const llamadasIniciadas = llamadas.filter((l) => l.iniciada_por === 'instructor');

  const tabs = <div role="tablist" aria-label="Tipo de videollamada" className="flex flex-wrap gap-3 mb-6">
    <button role="tab" aria-selected={section === 'alumnos'} onClick={() => setSection('alumnos')} className="px-4 py-2 border border-primary/30">Alumnos</button>
    <button role="tab" aria-selected={section === 'administracion'} onClick={() => setSection('administracion')} className="px-4 py-2 border border-primary/30">Administradores</button>
    <button role="tab" aria-selected={section === 'instructores'} onClick={() => setSection('instructores')} className="px-4 py-2 border border-primary/30">Instructores</button>
  </div>;
  if (section === 'administracion') return <>{tabs}<StaffVideo role="instructor" /></>;
  if (section === 'instructores') return <>{tabs}<StaffVideo role="instructor" peerRole="instructor" /></>;
  return (
    <motion.div role="region" aria-label="Videollamadas con alumnos" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="max-w-4xl">
      {tabs}
      <div className="mb-8">
        <div className="inline-flex items-center gap-2 mb-3 px-3 py-1.5 border border-primary/20 bg-primary/5 text-primary text-xs font-mono uppercase tracking-widest">
          <Video className="w-3.5 h-3.5" /> Videollamada
        </div>
        <h2 className="font-heading text-2xl font-bold text-foreground tracking-tight">Videoconferencia</h2>
        <p className="text-sm text-muted-foreground mt-1">Inicia o únete a una videollamada con tus alumnos.</p>
      </div>

      {/* Llamadas entrantes (iniciadas por alumnos) */}
      {callError && <p role="alert" className="text-sm text-danger mb-4">{callError}</p>}
      <button onClick={handleGroup} disabled={groupLoading || alumnos.length === 0}
        className="mb-6 px-5 py-3 bg-primary text-primary-foreground text-xs font-bold disabled:opacity-50">
        {groupLoading ? 'Invitando…' : 'Llamar a todos los alumnos'}
      </button>
      {llamadasEntrantes.length > 0 && (
        <div className="mb-6">
          <h3 className="text-xs font-mono uppercase tracking-widest text-primary mb-3 flex items-center gap-2">
            <Bell className="w-3.5 h-3.5" /> Llamadas entrantes
          </h3>
          <div className="space-y-3">
            {llamadasEntrantes.map((l) => (
              <motion.div
                key={l.id}
                initial={{ opacity: 0, x: -16 }}
                animate={{ opacity: 1, x: 0 }}
                className="glass-card p-4 flex items-center justify-between border-primary/30"
              >
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <div className="w-10 h-10 flex items-center justify-center bg-primary/10 border border-primary/30 rounded-full">
                      <User className="w-4 h-4 text-primary" />
                    </div>
                    <div className="absolute inset-0 rounded-full border border-primary/20 animate-ping" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">{l.alumno_nombre || 'Alumno'}</p>
                    <p className="text-xs text-muted-foreground font-mono">Te está llamando</p>
                  </div>
                </div>
                <button
                  onClick={() => handleUnirse(l)}
                  className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-5 py-2 font-bold uppercase tracking-tighter text-xs hover:bg-primary/80 transition-all duration-300"
                >
                  <Phone className="w-3.5 h-3.5" />
                  Unirse
                </button>
                <button onClick={() => { void handleRechazar(l); }} className="px-3 py-2 border border-border-subtle text-sm">Rechazar llamada</button>
              </motion.div>
            ))}
          </div>
        </div>
      )}

      {/* Llamadas activas iniciadas por el instructor */}
      {llamadasIniciadas.length > 0 && (
        <div className="mb-6">
          <h3 className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-2">
            <VideoIcon className="w-3.5 h-3.5" /> Llamadas activas
          </h3>
          <div className="space-y-3">
            {llamadasIniciadas.map((l) => (
              <div key={l.id} className="glass-card p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 flex items-center justify-center bg-surface-muted border border-border-subtle rounded-full">
                    <User className="w-4 h-4 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">{l.alumno_nombre || 'Alumno'}</p>
                    <p className="text-xs text-primary font-mono">En curso</p>
                  </div>
                </div>
                <button
                  onClick={() => handleUnirse(l)}
                  className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-5 py-2 font-bold uppercase tracking-tighter text-xs hover:bg-primary/80 transition-all duration-300"
                >
                  <Phone className="w-3.5 h-3.5" />
                  Reunirse
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Buscador */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/50" />
        <input aria-label="Buscar alumno..."
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar alumno..."
          className="w-full bg-surface-muted border border-border-subtle focus:border-transparent text-foreground placeholder:text-muted-foreground/40 pl-10 pr-4 py-2.5 text-sm outline-none transition-colors rounded-sm"
        />
      </div>

      {/* Lista de alumnos */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 text-primary animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="glass-card p-8 text-center">
          <p className="text-sm text-muted-foreground">No hay alumnos activos disponibles.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((p) => {
            const activa = getLlamadaActiva(p.id);
            return (
              <div key={p.id} className="glass-card p-4 flex items-center justify-between">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 flex items-center justify-center bg-surface-muted border border-border-subtle rounded-full shrink-0">
                    <User className="w-4 h-4 text-muted-foreground" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">
                      {p.nombre || ''} {p.apellidos || ''}
                    </p>
                    <p className="text-xs text-muted-foreground font-mono truncate">{p.email}</p>
                  </div>
                </div>
                {activa ? (
                  <button
                    onClick={() => handleUnirse(activa)}
                    className="inline-flex items-center gap-2 bg-primary/20 border border-primary/30 text-primary px-4 py-2 font-bold uppercase tracking-tighter text-xs hover:bg-primary/30 transition-all duration-200 shrink-0"
                  >
                    <Phone className="w-3.5 h-3.5" />
                    Unirse
                  </button>
                ) : (
                  <button
                    onClick={() => handleIniciar(p)}
                    disabled={iniciando[p.id]}
                    className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 font-bold uppercase tracking-tighter text-xs hover:bg-primary/80 transition-all duration-200 disabled:opacity-50 shrink-0"
                  >
                    {iniciando[p.id] ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Video className="w-3.5 h-3.5" />}
                    Llamar
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Info */}
      <div className="mt-6 flex items-start gap-3 text-xs text-muted-foreground/70 px-4">
        <User className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        <p>Al iniciar una llamada se crea una sala privada. El alumno verá la llamada entrante en su panel y podrá unirse. Al colgar, la sala se cierra para ambos.</p>
      </div>
    </motion.div>
  );
}
