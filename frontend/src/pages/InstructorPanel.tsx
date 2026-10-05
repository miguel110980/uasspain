import React, { lazy, useState, useEffect, useMemo, useRef } from 'react';
import {
  LayoutDashboard, Users, ClipboardList, BookOpen, BarChart2, Wifi,
  MessageCircle, Video, UserCog, TrendingUp,
} from 'lucide-react';
import authService from '@/services/authService';
import { usePanelAuthContext } from '@/context/PanelAuthContext';
import examenesService from '@/services/examenesService';
import conexionesService from '@/services/conexionesService';
import { loadResources } from '@/lib/loadResources';
import AdminSidebar from '@/components/admin/AdminSidebar';
import AdminTopbar from '@/components/admin/AdminTopbar';
import InstructorDashboard from '@/pages/instructor/InstructorDashboard';
const InstructorMaterial = lazy(() => import('@/pages/instructor/InstructorMaterial'));
const InstructorExamenes = lazy(() => import('@/pages/instructor/InstructorExamenes'));
const InstructorConexiones = lazy(() => import('@/pages/instructor/InstructorConexiones'));
const InstructorResultados = lazy(() => import('@/pages/instructor/InstructorResultados'));
const InstructorEstadisticas = lazy(() => import('@/pages/instructor/InstructorEstadisticas'));
const InstructorChat = lazy(() => import('@/pages/instructor/InstructorChat'));
const BloqueoExamenesModal = lazy(() => import('@/pages/instructor/BloqueoExamenesModal'));
const ResultadosAlumnoModal = lazy(() => import('@/pages/instructor/ResultadosAlumnoModal'));
const InstructorAccesos = lazy(() => import('@/pages/instructor/InstructorAccesos'));
const AdminUsuarios = lazy(() => import('@/pages/admin/AdminUsuarios'));
const InstructorCuenta = lazy(() => import('@/pages/instructor/InstructorCuenta'));
const InstructorVideo = lazy(() => import('@/components/videollamada/InstructorVideo'));

const CURSOS = ['A1/A3', 'A2', 'STS'];

import PanelSection from '@/components/ui/PanelSection';

const NAV_GROUPS = [
  {
    label: 'Principal',
    items: [{ id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard }],
  },
  {
    label: 'Gestión',
    items: [
      { id: 'usuarios', label: 'Alumnos', icon: Users },
      { id: 'examenes', label: 'Exámenes', icon: ClipboardList },
      { id: 'material', label: 'Material', icon: BookOpen },
      { id: 'resultados', label: 'Resultados', icon: BarChart2 },
      { id: 'estadisticas', label: 'Estadísticas', icon: TrendingUp },
    ],
  },
  {
    label: 'Comunicación',
    items: [
      { id: 'chat', label: 'Chat', icon: MessageCircle },
      { id: 'video', label: 'Videollamada', icon: Video },
    ],
  },
  {
    label: 'Sistema',
    items: [
      { id: 'conexiones', label: 'Conexiones activas', icon: Wifi },
      { id: 'cuenta', label: 'Cuenta', icon: UserCog },
    ],
  },
];

const TITLES = Object.fromEntries(NAV_GROUPS.flatMap((g) => g.items.map((i) => [i.id, i.label])));

export default function InstructorPanel() {
  const [section, setSection] = useState('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [profiles, setProfiles] = useState([]);
  const [examenes, setExamenes] = useState([]);
  const [bloqueos, setBloqueos] = useState([]);
  const [resultados, setResultados] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dataError, setDataError] = useState('');
  const [counts, setCounts] = useState(null);
  const [actionLoading, setActionLoading] = useState({});
  const { user, profile: authProfile } = usePanelAuthContext();
  const [accountProfile, setAccountProfile] = useState(null);
  const [chatSinLeerAlumno, setChatSinLeerAlumno] = useState(0);
  const [chatSinLeerStaff, setChatSinLeerStaff] = useState(0);
  const [chatInitialTab, setChatInitialTab] = useState(/** @type {'alumnos' | 'admin' | undefined} */ (undefined));
  const [videoEntrante, setVideoEntrante] = useState(false);
  const [modalBloqueo, setModalBloqueo] = useState(null);
  const [modalResultados, setModalResultados] = useState(null);
  const [modalAccesos, setModalAccesos] = useState(null);
  const [visitedTabs, setVisitedTabs] = useState(() => new Set(['dashboard']));
  const refreshTimerRef = useRef(/** @type {ReturnType<typeof setTimeout> | undefined} */ (undefined));

  useEffect(() => {
    document.title = 'Panel Instructor | UASSPAIN';
    loadAll().catch((err) => console.error('Error cargando datos del panel:', err));
    const unsubscribe = conexionesService.subscribeConexiones((event) => {
      const payload = conexionesService.parseWsPayload(event);
      if (payload?.type === 'conexion' || payload?.type === 'asignacion' || event.type === 'poll') {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = setTimeout(() => {
          if (payload?.type === 'conexion') {
            authService.dashboardCounts().then(setCounts).catch(() => {
              setDataError('No se pudieron actualizar las conexiones. Vuelve a intentarlo.');
            });
          } else loadAll(true).catch(() => {});
        }, 1000);
      }
    });
    return () => {
      unsubscribe();
      clearTimeout(refreshTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (authProfile) setAccountProfile(authProfile);
  }, [authProfile]);

  useEffect(() => {
    const checkNoLeidos = async () => {
      try {
        const [alumnoUnread, staffUnread] = await Promise.all([
          conexionesService.mensajes.unreadCount(),
          conexionesService.mensajesStaff.unreadCount(),
        ]);
        setChatSinLeerAlumno(alumnoUnread);
        setChatSinLeerStaff(staffUnread);
      } catch {}
    };
    checkNoLeidos();
    const unsubscribe = conexionesService.subscribeMensajes(() => checkNoLeidos());
    return () => unsubscribe();
  }, [authProfile?.id]);

  useEffect(() => {
    const checkVideo = async () => {
      try {
        const entrantes = await conexionesService.videollamadas.filter({ estado: 'activa' });
        setVideoEntrante(entrantes.some(call => String(call.iniciador_id) !== String(authProfile?.id)));
      } catch {}
    };
    checkVideo();
    const unsubscribe = conexionesService.subscribeVideollamadas(() => checkVideo());
    return () => unsubscribe();
  }, [authProfile?.id]);

  const loadAll = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const { values, failed } = await loadResources({
        Alumnos: () => authService.listProfiles('-created_date', 200),
        Exámenes: () => examenesService.examenes.list(),
        Bloqueos: () => examenesService.bloqueos.list(),
        Resultados: () => examenesService.resultados.list('-created_date', 500),
        Totales: () => authService.dashboardCounts(),
      });
      if (values.Alumnos) setProfiles(values.Alumnos);
      if (values.Exámenes) setExamenes([...values.Exámenes].sort((a, b) => CURSOS.indexOf(a.categoria) - CURSOS.indexOf(b.categoria)));
      if (values.Bloqueos) setBloqueos(values.Bloqueos);
      if (values.Resultados) setResultados(values.Resultados);
      if (values.Totales) setCounts(values.Totales);
      setDataError(failed.length ? `No se pudieron actualizar: ${failed.join(', ')}. Se conservan los últimos datos disponibles.` : '');
    } catch {
      setDataError('No se pudieron actualizar los datos del panel. Vuelve a intentarlo.');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const toggleBloqueoAlumno = async (alumnoId, examenId) => {
    const key = `${alumnoId}-${examenId}`;
    setActionLoading((prev) => ({ ...prev, [key]: true }));
    try {
      const existente = bloqueos.find((b) => b.alumno_id === alumnoId && b.examen_id === examenId);
      if (existente) {
        await examenesService.bloqueos.update(existente.id, { bloqueado: !existente.bloqueado });
        setBloqueos((prev) => prev.map((b) => (b.id === existente.id ? { ...b, bloqueado: !existente.bloqueado } : b)));
      } else {
        const nuevo = await examenesService.bloqueos.create({ alumno_id: alumnoId, examen_id: examenId, bloqueado: true });
        setBloqueos((prev) => [...prev, nuevo]);
      }
    } finally {
      setActionLoading((prev) => ({ ...prev, [key]: false }));
    }
  };

  const estaBloqueado = (alumnoId, examenId) =>
    bloqueos.some((b) => b.alumno_id === alumnoId && b.examen_id === examenId && b.bloqueado);

  const handleLogout = async () => {
    await authService.logout('/');
  };

  const handleSelect = (id) => {
    setSection(id);
    setVisitedTabs((prev) => new Set(prev).add(id));
    if (id === 'chat') {
      setChatSinLeerAlumno(0);
      setChatSinLeerStaff(0);
    }
    if (id === 'video') setVideoEntrante(false);
  };

  const openChat = (tab = /** @type {'alumnos' | 'admin'} */ ('alumnos')) => {
    setChatInitialTab(tab);
    handleSelect('chat');
  };

  const chatSinLeer = chatSinLeerAlumno + chatSinLeerStaff;

  const pendientesCount = counts?.pending_students ?? 0;

  const topbarNotifications = [];
  if (pendientesCount > 0) {
    topbarNotifications.push({
      id: 'alumnos-pending',
      title: `${pendientesCount} alumno(s) pendiente(s)`,
      description: 'Valida nuevas solicitudes de acceso.',
      onSelect: () => handleSelect('usuarios'),
    });
  }
  if (chatSinLeerAlumno > 0) {
    topbarNotifications.push({
      id: 'chat-unread-alumno',
      title: chatSinLeerAlumno === 1
        ? 'Mensaje de alumno sin leer'
        : `${chatSinLeerAlumno} mensajes de alumnos sin leer`,
      description: 'Tienes mensajes nuevos de alumnos.',
      onSelect: () => openChat('alumnos'),
    });
  }
  if (chatSinLeerStaff > 0) {
    topbarNotifications.push({
      id: 'chat-unread-staff',
      title: chatSinLeerStaff === 1
        ? 'Mensaje de administración sin leer'
        : `${chatSinLeerStaff} mensajes de administración sin leer`,
      description: 'Tienes mensajes nuevos de un administrador.',
      onSelect: () => openChat('admin'),
    });
  }
  if (videoEntrante) {
    topbarNotifications.push({
      id: 'video-incoming',
      title: 'Videollamada entrante',
      description: 'Tienes una videollamada entrante de un alumno o administrador.',
      onSelect: () => handleSelect('video'),
    });
  }

  const navGroups = useMemo(
    () => NAV_GROUPS.map((g) => ({
      ...g,
      items: g.items.map((item) => {
        const badge =
          item.id === 'usuarios' ? pendientesCount :
          item.id === 'chat' ? chatSinLeer :
          item.id === 'video' ? (videoEntrante ? 1 : 0) : 0;
        return { ...item, badge };
      }),
    })),
    [pendientesCount, chatSinLeer, videoEntrante],
  );

  const usuariosView = (
    <PanelSection><AdminUsuarios
      scopeRole="alumno"
      allowEdit={false}
      allowInstructorAssignment
      assignmentOwnerId={authProfile?.id}
      onAssignmentChanged={() => { void loadAll(true); }}
      onExamenes={setModalBloqueo}
      onResultados={setModalResultados}
      onAccesos={setModalAccesos}
    /></PanelSection>
  );

  const renderSection = () => (
    <>
      <div className={section === 'dashboard' ? '' : 'hidden'}>
        <InstructorDashboard
          profiles={profiles}
          resultados={resultados}
          loading={loading}
          counts={counts}
        />
      </div>
      {visitedTabs.has('usuarios') && <div className={section === 'usuarios' ? '' : 'hidden'}>{usuariosView}</div>}
      {visitedTabs.has('examenes') && (
        <div className={section === 'examenes' ? '' : 'hidden'}><PanelSection><InstructorExamenes /></PanelSection></div>
      )}
      {visitedTabs.has('material') && (
        <div className={section === 'material' ? '' : 'hidden'}><PanelSection><InstructorMaterial /></PanelSection></div>
      )}
      {visitedTabs.has('resultados') && (
        <div className={section === 'resultados' ? '' : 'hidden'}><PanelSection><InstructorResultados /></PanelSection></div>
      )}
      {visitedTabs.has('estadisticas') && (
        <div className={section === 'estadisticas' ? '' : 'hidden'}><PanelSection><InstructorEstadisticas /></PanelSection></div>
      )}
      {visitedTabs.has('conexiones') && (
        <div className={section === 'conexiones' ? '' : 'hidden'}><PanelSection><InstructorConexiones /></PanelSection></div>
      )}
      {visitedTabs.has('chat') && (
        <div className={section === 'chat' ? '' : 'hidden'}>
          <PanelSection><InstructorChat
            profiles={profiles}
            initialTab={chatInitialTab}
            alumnoUnread={chatSinLeerAlumno}
            staffUnread={chatSinLeerStaff}
          /></PanelSection>
        </div>
      )}
      {visitedTabs.has('video') && (
        <div className={section === 'video' ? '' : 'hidden'}><PanelSection><InstructorVideo profiles={profiles} /></PanelSection></div>
      )}
      {visitedTabs.has('cuenta') && (
        <div className={section === 'cuenta' ? '' : 'hidden'}>
          <PanelSection><InstructorCuenta profile={accountProfile ?? authProfile} onProfileUpdate={setAccountProfile} /></PanelSection>
        </div>
      )}
    </>
  );

  return (
    <div className="min-h-screen bg-background text-foreground flex">
      <AdminSidebar
        groups={navGroups}
        section={section}
        onSelect={handleSelect}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        roleLabel="Instructor"
      />

      <div className="flex-1 min-w-0 flex flex-col">
        {dataError && <div role="alert" className="p-3 border border-danger-border bg-danger-soft text-danger text-sm">{dataError} <button onClick={() => loadAll()} className="underline">Reintentar</button></div>}
        <AdminTopbar
          navigation={NAV_GROUPS.flatMap(group => group.items)}
          onNavigate={handleSelect}
          title={TITLES[section] || 'Panel'}
          onMenu={() => setSidebarOpen(true)}
          user={user ? { ...user, full_name: `${authProfile?.nombre || ''} ${authProfile?.apellidos || ''}`.trim() || user.full_name } : null}
          onLogout={handleLogout}
          onAccount={() => handleSelect('cuenta')}
          pendingCount={pendientesCount + chatSinLeer + (videoEntrante ? 1 : 0)}
          notifications={topbarNotifications}
        />
        <main className="flex-1 p-4 md:p-6 max-w-[1400px] w-full mx-auto">
          {renderSection()}
        </main>
      </div>

      {modalBloqueo && (<PanelSection><BloqueoExamenesModal
        profile={modalBloqueo}
        examenes={examenes}
        estaBloqueado={estaBloqueado}
        onToggle={toggleBloqueoAlumno}
        actionLoading={actionLoading}
        onClose={() => setModalBloqueo(null)}
      /></PanelSection>)}
      {modalResultados && (<PanelSection><ResultadosAlumnoModal
        profile={modalResultados}
        onClose={() => setModalResultados(null)}
      /></PanelSection>)}
      {modalAccesos && (<PanelSection><InstructorAccesos
        profile={modalAccesos}
        onClose={() => setModalAccesos(null)}
      /></PanelSection>)}
    </div>
  );
}
