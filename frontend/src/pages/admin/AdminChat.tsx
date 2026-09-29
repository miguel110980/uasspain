import React, { useEffect, useState, useMemo } from 'react';
import { Loader2 } from 'lucide-react';
import authService from '@/services/authService';
import conexionesService from '@/services/conexionesService';
import { usePanelAuthContext } from '@/context/PanelAuthContext';
import { profileHasInstructor, profileHasAdmin } from '@/lib/roles';
import { buildStaffPeers, countStaffUnread, profileDisplayName } from '@/lib/staffChat';
import StaffChatPanel from '@/components/chat/StaffChatPanel';

/** @param {{ onUnreadChange?: (count: number) => void }} props */
export default function AdminChat({ onUnreadChange }) {
  const { profile } = usePanelAuthContext();
  const [allPeers, setAllPeers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!profile?.id) return;
    (async () => {
      try {
        const [profileData, staffMsgs] = await Promise.all([
          authService.listProfiles('-created_date', 500),
          conexionesService.mensajesStaff.list('-created_date', 500),
        ]);
        setAllPeers(buildStaffPeers({
          myProfileId: profile.id,
          profiles: profileData,
          staffMsgs,
          roleFilter: (p) => profileHasAdmin(p) || profileHasInstructor(p),
          fallbackRole: 'instructor',
          fallbackLabel: 'Contacto',
        }));
        onUnreadChange?.(countStaffUnread(staffMsgs, profile.id));
      } catch {
        setAllPeers([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [profile?.id, onUnreadChange]);

  const contactGroups = useMemo(() => {
    const admins = allPeers.filter((p) => profileHasAdmin(p) && !profileHasInstructor(p));
    const instructores = allPeers.filter((p) => profileHasInstructor(p));
    return [
      { label: 'Administradores', peers: admins, role: 'admin' },
      { label: 'Instructores', peers: instructores, role: 'instructor' },
    ];
  }, [allPeers]);

  if (loading || !profile?.id) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  return (
    <StaffChatPanel
      peers={allPeers}
      myProfileId={profile.id}
      myRole="admin"
      myDisplayName={profileDisplayName(profile)}
      peerRoleLabel="Contactos"
      peerSingular="Contacto"
      emptyPeersText="No hay contactos disponibles. Aparecerán aquí al recibir o enviar un mensaje."
      selectPeerText="Selecciona un contacto para ver la conversación."
      onUnreadChange={onUnreadChange}
      contactGroups={contactGroups}
    />
  );
}
