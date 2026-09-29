import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  LayoutDashboard, Activity, BarChart2, Radio, Network, Shield, ScrollText,
  Users, UserCheck, Server, Bell, Settings, User, MessageCircle, DatabaseBackup, ShieldCheck,
  Newspaper, BookOpen,
} from 'lucide-react';
import authService from '@/services/authService';
import conexionesService from '@/services/conexionesService';
import { usePanelAuthContext } from '@/context/PanelAuthContext';
import AdminSidebar from '@/components/admin/AdminSidebar';
import AdminTopbar from '@/components/admin/AdminTopbar';
import AdminDashboard from '@/pages/admin/AdminDashboard';
import AdminUsuarios from '@/pages/admin/AdminUsuarios';
import AdminConexiones from '@/pages/admin/AdminConexiones';
import AdminActividad from '@/pages/admin/AdminActividad';
import AdminEstadisticas from '@/pages/admin/AdminEstadisticas';
import AdminConexionesTiempoReal from '@/pages/admin/AdminConexionesTiempoReal';
import AdminSeguridad from '@/pages/admin/AdminSeguridad';
import AdminAuditoria from '@/pages/admin/AdminAuditoria';
import AdminMonitorizacion from '@/pages/admin/AdminMonitorizacion';
import AdminNotificaciones from '@/pages/admin/AdminNotificaciones';
import AdminConfiguracion from '@/pages/admin/AdminConfiguracion';
import AdminBackups from '@/pages/admin/AdminBackups';
import AdminVpn from '@/pages/admin/AdminVpn';
import AdminInstructores from '@/pages/admin/AdminInstructores';
import AdminChat from '@/pages/admin/AdminChat';
import AdminCuenta from '@/components/admin/AdminCuenta';
import AdminBlog from '@/pages/admin/AdminBlog';
import AdminCursos from '@/pages/admin/AdminCursos';

const NAV_GROUPS = [
  {
    label: 'Supervisión',
    items: [
      { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { id: 'actividad', label: 'Actividad en tiempo real', icon: Activity },
      { id: 'estadisticas', label: 'Estadísticas', icon: BarChart2 },
    ],
  },
  {
    label: 'Seguridad',
    items: [
      { id: 'conexiones-rt', label: 'Conexiones en vivo', icon: Radio },
      { id: 'registro-conexiones', label: 'Registro de Conexiones', icon: Network },
      { id: 'seguridad', label: 'Seguridad', icon: Shield },
      { id: 'auditoria', label: 'Auditoría', icon: ScrollText },
    ],
  },
  {
    label: 'Comunicación',
    items: [{ id: 'chat', label: 'Chat', icon: MessageCircle }],
  },
  {
    label: 'Gestión',
    items: [
      { id: 'usuarios', label: 'Gestión de Usuarios', icon: Users },
      { id: 'instructores', label: 'Instructores', icon: UserCheck },
      { id: 'blog', label: 'Blog / Publicaciones', icon: Newspaper },
      { id: 'cursos', label: 'Formación / Cursos', icon: BookOpen },
    ],
  },
  {
    label: 'Sistema',
    items: [
      { id: 'monitorizacion', label: 'Monitorización', icon: Server },
      { id: 'notificaciones', label: 'Notificaciones', icon: Bell },
      { id: 'backups', label: 'Backups', icon: DatabaseBackup },
      { id: 'vpn', label: 'VPN', icon: ShieldCheck },
      { id: 'configuracion', label: 'Configuración', icon: Settings },
    ],
  },
  {
    label: 'Cuenta',
    items: [{ id: 'cuenta', label: 'Mi cuenta', icon: User }],
  },
];

const TITLES = Object.fromEntries(NAV_GROUPS.flatMap((g) => g.items.map((i) => [i.id, i.label])));

export default function AdminPanel() {
  const [section, setSection] = useState('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { user, profile: authProfile } = usePanelAuthContext();
  const [pendingCount, setPendingCount] = useState(0);
  const [staffUnread, setStaffUnread] = useState(0);
  const [accountProfile, setAccountProfile] = useState(null);
  const [visitedTabs, setVisitedTabs] = useState(() => new Set(['dashboard']));

  const handleStaffUnreadChange = useCallback((count) => {
    setStaffUnread(typeof count === 'number' ? count : 0);
  }, []);

  const handleSelectSection = (id) => {
    setSection(id);
    setVisitedTabs((prev) => new Set(prev).add(id));
  };

  useEffect(() => {
    if (authProfile) setAccountProfile(authProfile);
  }, [authProfile]);

  useEffect(() => {
    document.title = 'Centro de Operaciones | UASSPAIN';
  }, []);

  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const pendientes = await authService.filterProfiles({ status: 'pendiente' });
        setPendingCount(pendientes.length);
      } catch {}
    })();
  }, [user]);

  useEffect(() => {
    if (!authProfile?.id) return undefined;
    const checkStaffUnread = async () => {
      try {
        const staffMsgs = await conexionesService.mensajesStaff.filter({ leido_destinatario: false });
        const incoming = staffMsgs.filter((m) => String(m.destinatario_id) === String(authProfile.id));
        setStaffUnread(incoming.length);
      } catch {}
    };
    checkStaffUnread();
    const unsubscribe = conexionesService.subscribeMensajes((event) => {
      const payload = conexionesService.parseWsPayload(event);
      if (payload?.type === 'mensaje_staff' || event.type === 'poll') {
        checkStaffUnread();
      }
    });
    return () => unsubscribe();
  }, [authProfile?.id]);

  const handleLogout = () => {
    window.history.replaceState(null, '', '/');
    authService.logout('/');
  };

  const topbarNotifications = [];
  if (pendingCount > 0) {
    topbarNotifications.push({
      id: 'users-pending',
      title: `${pendingCount} usuario(s) pendiente(s) de validación`,
      description: 'Revisa y aprueba solicitudes en Gestión de Usuarios.',
      onSelect: () => handleSelectSection('usuarios'),
    });
  }

  if (staffUnread > 0) {
    topbarNotifications.push({
      id: 'chat-unread',
      title: staffUnread === 1 ? 'Mensaje de instructor sin leer' : `${staffUnread} mensajes de instructores sin leer`,
      description: 'Abre el chat para leer y responder.',
      onSelect: () => handleSelectSection('chat'),
    });
  }

  const navGroups = useMemo(
    () => NAV_GROUPS.map((g) => ({
      ...g,
      items: g.items.map((item) => {
        const badge =
          item.id === 'usuarios' ? pendingCount :
          item.id === 'chat' ? staffUnread : 0;
        return { ...item, badge };
      }),
    })),
    [pendingCount, staffUnread],
  );

  const SECTION_COMPONENTS = {
    dashboard: <AdminDashboard />,
    actividad: <AdminActividad />,
    estadisticas: <AdminEstadisticas />,
    'conexiones-rt': <AdminConexionesTiempoReal />,
    'registro-conexiones': <AdminConexiones />,
    seguridad: <AdminSeguridad />,
    auditoria: <AdminAuditoria />,
    usuarios: <AdminUsuarios />,
    instructores: <AdminInstructores />,
    blog: <AdminBlog />,
    cursos: <AdminCursos />,
    monitorizacion: <AdminMonitorizacion />,
    notificaciones: <AdminNotificaciones />,
    backups: <AdminBackups />,
    vpn: <AdminVpn />,
    configuracion: <AdminConfiguracion />,
    cuenta: <AdminCuenta profile={accountProfile ?? authProfile} onProfileUpdate={setAccountProfile} />,
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex">
      <AdminSidebar
        groups={navGroups}
        section={section}
        onSelect={handleSelectSection}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="flex-1 min-w-0 flex flex-col">
        <AdminTopbar
          title={TITLES[section] || 'Centro de Operaciones'}
          onMenu={() => setSidebarOpen(true)}
          user={user ? { ...user, full_name: `${authProfile?.nombre || ''} ${authProfile?.apellidos || ''}`.trim() || user.full_name } : null}
          onLogout={handleLogout}
          onAccount={() => handleSelectSection('cuenta')}
          pendingCount={pendingCount + staffUnread}
          notifications={topbarNotifications}
          onViewAllNotifications={() => handleSelectSection('notificaciones')}
        />
        <main className="flex-1 p-4 md:p-6 max-w-[1600px] w-full mx-auto">
          {Object.entries(SECTION_COMPONENTS).map(([id, node]) => (
            visitedTabs.has(id) ? (
              <div key={id} className={section === id ? '' : 'hidden'} aria-hidden={section !== id}>
                {node}
              </div>
            ) : null
          ))}
          {visitedTabs.has('chat') && (
            <div className={section === 'chat' ? '' : 'hidden'} aria-hidden={section !== 'chat'}>
              <AdminChat onUnreadChange={handleStaffUnreadChange} />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
