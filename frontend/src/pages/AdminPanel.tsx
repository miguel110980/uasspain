import React, { lazy, useEffect, useState, useCallback, useMemo } from 'react';
import {
  LayoutDashboard, Activity, BarChart2, Radio, Network, Shield, ScrollText,
  Users, UserCheck, Server, Bell, Settings, User, MessageCircle, DatabaseBackup, ShieldCheck,
  Newspaper, BookOpen, Video,
} from 'lucide-react';
import authService from '@/services/authService';
import conexionesService from '@/services/conexionesService';
import { usePanelAuthContext } from '@/context/PanelAuthContext';
import AdminSidebar from '@/components/admin/AdminSidebar';
import AdminTopbar from '@/components/admin/AdminTopbar';
import AdminDashboard from '@/pages/admin/AdminDashboard';
const AdminUsuarios = lazy(() => import('@/pages/admin/AdminUsuarios'));
const AdminStudents = lazy(() => import('@/pages/admin/AdminStudents'));
const AdminConexiones = lazy(() => import('@/pages/admin/AdminConexiones'));
const AdminActividad = lazy(() => import('@/pages/admin/AdminActividad'));
const AdminEstadisticas = lazy(() => import('@/pages/admin/AdminEstadisticas'));
const AdminConexionesTiempoReal = lazy(() => import('@/pages/admin/AdminConexionesTiempoReal'));
const AdminSeguridad = lazy(() => import('@/pages/admin/AdminSeguridad'));
const AdminAuditoria = lazy(() => import('@/pages/admin/AdminAuditoria'));
const AdminMonitorizacion = lazy(() => import('@/pages/admin/AdminMonitorizacion'));
const AdminNotificaciones = lazy(() => import('@/pages/admin/AdminNotificaciones'));
const AdminConfiguracion = lazy(() => import('@/pages/admin/AdminConfiguracion'));
const AdminBackups = lazy(() => import('@/pages/admin/AdminBackups'));
const AdminVpn = lazy(() => import('@/pages/admin/AdminVpn'));
const AdminInstructores = lazy(() => import('@/pages/admin/AdminInstructores'));
const AdminChat = lazy(() => import('@/pages/admin/AdminChat'));
const AdminCuenta = lazy(() => import('@/components/admin/AdminCuenta'));
const AdminBlog = lazy(() => import('@/pages/admin/AdminBlog'));
const AdminCursos = lazy(() => import('@/pages/admin/AdminCursos'));
const AdminServicios = lazy(() => import('@/pages/admin/AdminServicios'));
const StaffVideo = lazy(() => import('@/components/videollamada/StaffVideo'));

import PanelSection from '@/components/ui/PanelSection';

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
    items: [{ id: 'chat', label: 'Chat', icon: MessageCircle }, { id: 'video', label: 'Videollamada', icon: Video }],
  },
  {
    label: 'Gestión',
    items: [
      { id: 'usuarios', label: 'Gestión de Usuarios', icon: Users },
      { id: 'instructores', label: 'Instructores', icon: UserCheck },
      { id: 'blog', label: 'Blog / Publicaciones', icon: Newspaper },
      { id: 'cursos', label: 'Formación / Cursos', icon: BookOpen },
      { id: 'servicios', label: 'Servicios', icon: Shield },
    ],
  },
  {
    label: 'Sistema',
    items: [
      { id: 'monitorizacion', label: 'Monitorización', icon: Server },
      { id: 'notificaciones', label: 'Notificaciones', icon: Bell },
      { id: 'backups', label: 'Copias de seguridad', icon: DatabaseBackup },
      { id: 'vpn', label: 'Conexiones VPN', icon: ShieldCheck },
      { id: 'configuracion', label: 'Configuración', icon: Settings },
    ],
  },
  {
    label: 'Cuenta',
    items: [{ id: 'cuenta', label: 'Mi cuenta', icon: User }],
  },
];

const TITLES = Object.fromEntries(NAV_GROUPS.flatMap((g) => g.items.map((i) => [i.id, i.label])));

function AdminUserSections() {
  const [tab, setTab] = useState('users');
  return <div className="min-w-0 space-y-5"><nav aria-label="Secciones de usuarios" className="flex flex-wrap gap-3">{[['users', 'Usuarios'], ['students', 'Alumnos']].map(([id, label]) => <button type="button" key={id} aria-pressed={tab === id} onClick={() => setTab(id)} className={`px-4 py-2 border rounded-sm ${tab === id ? 'border-primary text-primary' : 'border-border-subtle text-muted-foreground'}`}>{label}</button>)}</nav>{tab === 'students' ? <AdminStudents /> : <AdminUsuarios />}</div>;
}

export default function AdminPanel() {
  const initialSection = () => {
    const selected = new URLSearchParams(window.location.search).get('section');
    return ['configuracion', 'vpn', 'backups'].includes(selected) ? selected : 'dashboard';
  };
  const [section, setSection] = useState(initialSection);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { user, profile: authProfile } = usePanelAuthContext();
  const [pendingCount, setPendingCount] = useState(0);
  const [staffUnread, setStaffUnread] = useState(0);
  const [videoIncoming, setVideoIncoming] = useState(0);
  const [accountProfile, setAccountProfile] = useState(null);
  const [visitedTabs, setVisitedTabs] = useState(() => new Set([initialSection()]));

  const handleStaffUnreadChange = useCallback((count) => {
    setStaffUnread(typeof count === 'number' ? count : 0);
  }, []);

  const handleSelectSection = (id) => {
    setSection(id);
    setVisitedTabs((prev) => new Set(prev).add(id));
    const url = new URL(window.location.href);
    if (['configuracion', 'vpn', 'backups'].includes(id)) url.searchParams.set('section', id);
    else url.searchParams.delete('section');
    url.hash = '';
    window.history.replaceState(window.history.state, '', url.pathname + url.search);
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
        setStaffUnread(await conexionesService.mensajesStaff.unreadCount());
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
    authService.logout('/');
  };

  useEffect(() => {
    if (!authProfile?.id) return undefined;
    const load = async () => {
      try {
        const calls = await conexionesService.videollamadas.filter({ canal: 'administracion', estado: 'activa' });
        setVideoIncoming(calls.filter(call => String(call.iniciador_id) !== String(authProfile.id)).length);
      } catch { /* The video section displays connection errors. */ }
    };
    void load();
    return conexionesService.subscribeVideollamadas(() => { void load(); });
  }, [authProfile?.id]);

  const topbarNotifications = [];
  if (videoIncoming > 0) topbarNotifications.push({
    id: 'video-incoming', title: 'Videollamada entrante', description: 'Un instructor está solicitando una videollamada.',
    onSelect: () => handleSelectSection('video'),
  });
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
          item.id === 'chat' ? staffUnread : item.id === 'video' ? videoIncoming : 0;
        return { ...item, badge };
      }),
    })),
    [pendingCount, staffUnread, videoIncoming],
  );

  const SECTION_COMPONENTS = {
    dashboard: <AdminDashboard />,
    actividad: <PanelSection><AdminActividad /></PanelSection>,
    estadisticas: <PanelSection><AdminEstadisticas /></PanelSection>,
    'conexiones-rt': <PanelSection><AdminConexionesTiempoReal /></PanelSection>,
    'registro-conexiones': <PanelSection><AdminConexiones /></PanelSection>,
    seguridad: <PanelSection><AdminSeguridad /></PanelSection>,
    auditoria: <PanelSection><AdminAuditoria /></PanelSection>,
    usuarios: <PanelSection><AdminUserSections /></PanelSection>,
    instructores: <PanelSection><AdminInstructores /></PanelSection>,
    blog: <PanelSection><AdminBlog /></PanelSection>,
    cursos: <PanelSection><AdminCursos active={section === 'cursos'} /></PanelSection>,
    servicios: <PanelSection><AdminServicios active={section === 'servicios'} /></PanelSection>,
    video: <PanelSection><StaffVideo role="admin" /></PanelSection>,
    monitorizacion: <PanelSection><AdminMonitorizacion /></PanelSection>,
    notificaciones: <PanelSection><AdminNotificaciones /></PanelSection>,
    backups: <PanelSection><AdminBackups /></PanelSection>,
    vpn: <PanelSection><AdminVpn active={section === 'vpn'} onNavigate={handleSelectSection} /></PanelSection>,
    configuracion: <PanelSection><AdminConfiguracion /></PanelSection>,
    cuenta: <PanelSection><AdminCuenta profile={accountProfile ?? authProfile} onProfileUpdate={setAccountProfile} /></PanelSection>,
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
          navigation={NAV_GROUPS.flatMap(group => group.items)}
          onNavigate={handleSelectSection}
          title={TITLES[section] || 'Centro de Operaciones'}
          onMenu={() => setSidebarOpen(true)}
          user={user ? { ...user, full_name: `${authProfile?.nombre || ''} ${authProfile?.apellidos || ''}`.trim() || user.full_name } : null}
          onLogout={handleLogout}
          onAccount={() => handleSelectSection('cuenta')}
          pendingCount={pendingCount + staffUnread + videoIncoming}
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
              <PanelSection><AdminChat onUnreadChange={handleStaffUnreadChange} /></PanelSection>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
