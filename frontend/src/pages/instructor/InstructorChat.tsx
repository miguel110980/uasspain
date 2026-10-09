import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Loader2 } from 'lucide-react';
import conexionesService from '@/services/conexionesService';
import { profileHasAdmin, profileHasInstructor } from '@/lib/roles';
import { buildStaffPeers, countStaffUnread, profileDisplayName } from '@/lib/staffChat';
import { usePanelAuthContext } from '@/context/PanelAuthContext';
import StaffChatPanel from '@/components/chat/StaffChatPanel';
import StudentChats from '@/components/chat/StudentChats';

/** @type {{ id: 'alumnos' | 'admin', label: string }[]} */
const TABS = [
  { id: 'alumnos', label: 'Alumnos' },
  { id: 'admin', label: 'Administración' },
];

function chatPeerProfiles(profiles, myProfileId) {
  return (profiles || []).filter((p) => {
    if (myProfileId && String(p.id) === String(myProfileId)) return false;
    return p.status === 'activo';
  });
}

/** @param {{ profiles: object[], initialTab?: 'alumnos' | 'admin', alumnoUnread?: number, staffUnread?: number }} props */
export default function InstructorChat({
  profiles,
  initialTab,
  alumnoUnread: externalAlumnoUnread,
  staffUnread: externalStaffUnread,
}) {
  const { profile } = usePanelAuthContext();
  const [tab, setTab] = useState(/** @type {'alumnos' | 'admin'} */ (initialTab || 'alumnos'));
  const [admins, setAdmins] = useState([]);
  const [loadingAdmins, setLoadingAdmins] = useState(true);
  const [staffUnread, setStaffUnread] = useState(externalStaffUnread ?? 0);
  const [alumnoUnread, setAlumnoUnread] = useState(externalAlumnoUnread ?? 0);
  const tabInitialized = useRef(false);
  const useExternalUnread = typeof externalAlumnoUnread === 'number' && typeof externalStaffUnread === 'number';

  useEffect(() => {
    if (typeof externalAlumnoUnread === 'number') setAlumnoUnread(externalAlumnoUnread);
    if (typeof externalStaffUnread === 'number') setStaffUnread(externalStaffUnread);
  }, [externalAlumnoUnread, externalStaffUnread]);

  useEffect(() => {
    if (!profile?.id) return;
    (async () => {
      try {
        const [staffContacts, staffMsgs] = await Promise.all([
          conexionesService.mensajesStaff.contacts(),
          conexionesService.mensajesStaff.list('-created_date', 500),
        ]);
        setAdmins(buildStaffPeers({
          myProfileId: profile.id,
          profiles: staffContacts,
          staffMsgs,
          roleFilter: (p) => profileHasAdmin(p) || profileHasInstructor(p),
          fallbackRole: 'admin',
          fallbackLabel: 'Contacto',
        }));
        const staffCount = countStaffUnread(staffMsgs, profile.id);
        if (!useExternalUnread) {
          setStaffUnread(staffCount);
          const alumnoMsgs = await conexionesService.mensajes.filter({
            remitente: 'alumno',
            leido_instructor: false,
          });
          setAlumnoUnread(alumnoMsgs.length);
        }
        if (!tabInitialized.current && !initialTab) {
          setTab(staffCount > 0 ? 'admin' : 'alumnos');
          tabInitialized.current = true;
        }
      } finally {
        setLoadingAdmins(false);
      }
    })();
  }, [profile?.id, initialTab, useExternalUnread]);

  useEffect(() => {
    if (initialTab) setTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    if (useExternalUnread || !profile?.id) return undefined;
    const refreshUnread = async () => {
      try {
        const [alumnoMsgs, staffMsgs] = await Promise.all([
          conexionesService.mensajes.filter({ remitente: 'alumno', leido_instructor: false }),
          conexionesService.mensajesStaff.filter({ leido_destinatario: false }),
        ]);
        setAlumnoUnread(alumnoMsgs.length);
        setStaffUnread(countStaffUnread(staffMsgs, profile.id));
      } catch {
        // ignore
      }
    };
    refreshUnread();
    const unsubscribe = conexionesService.subscribeMensajes((event) => {
      const payload = conexionesService.parseWsPayload(event);
      if (payload?.type === 'mensaje' || payload?.type === 'mensaje_staff' || event.type === 'poll') {
        refreshUnread();
      }
    });
    return () => unsubscribe();
  }, [profile?.id, useExternalUnread]);

  const chatProfiles = useMemo(
    () => chatPeerProfiles(profiles, profile?.id),
    [profiles, profile?.id],
  );

  const adminContactGroups = useMemo(() => {
    const administradores = admins.filter((p) => profileHasAdmin(p) && !profileHasInstructor(p));
    const instructores = admins.filter((p) => profileHasInstructor(p));
    return [
      { label: 'Administradores', peers: administradores, role: 'admin' },
      { label: 'Instructores', peers: instructores, role: 'instructor' },
    ];
  }, [admins]);

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {TABS.map((t) => {
          const unread = t.id === 'admin' ? staffUnread : alumnoUnread;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`inline-flex items-center gap-2 px-4 py-2 text-xs font-mono uppercase tracking-widest border rounded transition-all ${
                tab === t.id
                  ? 'border-primary/50 bg-primary/10 text-primary'
                  : 'border-border-subtle text-muted-foreground hover:border-primary/30 hover:text-primary'
              }`}
            >
              {t.label}
              {unread > 0 && (
                <span className="w-5 h-5 flex items-center justify-center bg-primary text-primary-foreground text-[10px] font-bold rounded-full">
                  {unread}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div className={tab === 'alumnos' ? '' : 'hidden'}>
        <StudentChats profiles={chatProfiles} />
      </div>
      {profile?.id && (
        <div className={tab === 'admin' ? '' : 'hidden'}>
          {loadingAdmins ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-8 h-8 text-primary animate-spin" />
            </div>
          ) : (
            <StaffChatPanel
              peers={admins}
              myProfileId={profile.id}
              myRole="instructor"
              myDisplayName={profileDisplayName(profile)}
              peerRoleLabel="Contactos"
              peerSingular="Contacto"
              emptyPeersText="No hay contactos disponibles."
              selectPeerText="Selecciona un contacto para ver la conversación."
              contactGroups={adminContactGroups}
            />
          )}
        </div>
      )}
    </div>
  );
}
