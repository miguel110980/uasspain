import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  LayoutDashboard, Users, ClipboardList, BookOpen, BarChart2, Wifi,
  MessageCircle, Video, UserCog, TrendingUp,
} from 'lucide-react';
import authService from '@/services/authService';
import { usePanelAuthContext } from '@/context/PanelAuthContext';
import examenesService from '@/services/examenesService';
import materialesService from '@/services/materialesService';
import conexionesService from '@/services/conexionesService';
import AdminSidebar from '@/components/admin/AdminSidebar';
import AdminTopbar from '@/components/admin/AdminTopbar';
import InstructorDashboard from '@/pages/instructor/InstructorDashboard';
import InstructorMaterial from '@/pages/instructor/InstructorMaterial';
import InstructorExamenes from '@/pages/instructor/InstructorExamenes';
import InstructorConexiones from '@/pages/instructor/InstructorConexiones';
import InstructorResultados from '@/pages/instructor/InstructorResultados';
import InstructorEstadisticas from '@/pages/instructor/InstructorEstadisticas';
import InstructorChat from '@/pages/instructor/InstructorChat';
import BloqueoExamenesModal from '@/pages/instructor/BloqueoExamenesModal';
import ResultadosAlumnoModal from '@/pages/instructor/ResultadosAlumnoModal';
import InstructorAccesos from '@/pages/instructor/InstructorAccesos';
import AdminUsuarios from '@/pages/admin/AdminUsuarios';
import InstructorCuenta from '@/pages/instructor/InstructorCuenta';
import InstructorVideo from '@/components/videollamada/InstructorVideo';

const CURSOS = ['A1/A3', 'A2', 'STS'];

const NAV_GROUPS = [
  {
    label: 'Principal',
    items: [{ id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard }],
  },
  {
    label: 'Gestión',
    items: [
      { id: 'usuarios', label: 'Usuarios', icon: Users },
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
  const [material, setMaterial] = useState([]);
  const [mensajes, setMensajes] = useState([]);
  const [conexiones, setConexiones] = useState([]);
  const [loading, setLoading] = useState(true);
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
      if (payload?.type === 'conexion' || event.type === 'poll') {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = setTimeout(() => {
          loadAll(true).catch(() => {});
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
        const [alumnoMsgs, staffMsgs] = await Promise.all([
          conexionesService.mensajes.filter({ remitente: 'alumno', leido_instructor: false }),
          conexionesService.mensajesStaff.filter({ leido_destinatario: false }),
        ]);
        const staffIncoming = staffMsgs.filter(
          (m) => authProfile?.id && String(m.destinatario_id) === String(authProfile.id),
        );
        setChatSinLeerAlumno(alumnoMsgs.length);
        setChatSinLeerStaff(staffIncoming.length);
      } catch {}
    };
    checkNoLeidos();
    const unsubscribe = conexionesService.subscribeMensajes(() => checkNoLeidos());
    return () => unsubscribe();
  }, [authProfile?.id]);

  useEffect(() => {
    const checkVideo = async () => {
      try {
        const entrantes = await conexionesService.videollamadas.filter({ estado: 'activa', iniciada_por: 'alumno' });
        setVideoEntrante(entrantes.length > 0);
      } catch {}
    };
    checkVideo();
    const unsubscribe = conexionesService.subscribeVideollamadas(() => checkVideo());
    return () => unsubscribe();
  }, []);

  const loadAll = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [profilesData, examenesData, bloqueosData, resultadosData, materialData, mensajesData, registrosData] = await Promise.all([
        authService.listProfiles('-created_date', 200),
        examenesService.examenes.list(),
        examenesService.bloqueos.list(),
        examenesService.resultados.list('-created_date', 500),
        materialesService.materiales.list(),
        conexionesService.mensajes.list('-created_date', 100),
        conexionesService.registros.list('-fecha_hora', 500),
      ]);
      setProfiles(profilesData);
      setExamenes(examenesData.sort((a, b) => CURSOS.indexOf(a.categoria) - CURSOS.indexOf(b.categoria)));
      setBloqueos(bloqueosData);
      setResultados(resultadosData);
      setMaterial(materialData);
      setMensajes(mensajesData);
      setConexiones(registrosData);
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
    window.history.replaceState(null, '', '/');
    authService.logout('/');
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

  const pendientesCount = profiles.filter((p) => (p.role || 'alumno') === 'alumno' && p.status === 'pendiente').length;

  const topbarNotifications = [];
  if (pendientesCount > 0) {
    topbarNotifications.push({
      id: 'alumnos-pending',
      title: `${pendientesCount} usuario(s) pendiente(s)`,
      description: 'Valida nuevas solicitudes de acceso.',
      onSelect: () => handleSelect('usuarios'),
    });
  }
  if (chatSinLeerAlumno > 0) {
    topbarNotifications.push({
      id: 'chat-unread-alumno',
      title: chatSinLeerAlumno === 1
        ? 'Mensaje de usuario sin leer'
        : `${chatSinLeerAlumno} mensajes de usuarios sin leer`,
      description: 'Tienes mensajes nuevos de usuarios.',
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
      description: 'Un alumno está solicitando videollamada.',
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
    <AdminUsuarios
      scopeRole="alumno"
      allowEdit={false}
      onExamenes={setModalBloqueo}
      onResultados={setModalResultados}
      onAccesos={setModalAccesos}
    />
  );

  const renderSection = () => (
    <>
      <div className={section === 'dashboard' ? '' : 'hidden'}>
        <InstructorDashboard
          profiles={profiles}
          resultados={resultados}
          examenes={examenes}
          material={material}
          mensajes={mensajes}
          conexiones={conexiones}
          loading={loading}
        />
      </div>
      <div className={section === 'usuarios' ? '' : 'hidden'}>{usuariosView}</div>
      {visitedTabs.has('examenes') && (
        <div className={section === 'examenes' ? '' : 'hidden'}><InstructorExamenes /></div>
      )}
      {visitedTabs.has('material') && (
        <div className={section === 'material' ? '' : 'hidden'}><InstructorMaterial /></div>
      )}
      {visitedTabs.has('resultados') && (
        <div className={section === 'resultados' ? '' : 'hidden'}><InstructorResultados /></div>
      )}
      {visitedTabs.has('estadisticas') && (
        <div className={section === 'estadisticas' ? '' : 'hidden'}><InstructorEstadisticas /></div>
      )}
      {visitedTabs.has('conexiones') && (
        <div className={section === 'conexiones' ? '' : 'hidden'}><InstructorConexiones /></div>
      )}
      {visitedTabs.has('chat') && (
        <div className={section === 'chat' ? '' : 'hidden'}>
          <InstructorChat
            profiles={profiles}
            initialTab={chatInitialTab}
            alumnoUnread={chatSinLeerAlumno}
            staffUnread={chatSinLeerStaff}
          />
        </div>
      )}
      {visitedTabs.has('video') && (
        <div className={section === 'video' ? '' : 'hidden'}><InstructorVideo profiles={profiles} /></div>
      )}
      {visitedTabs.has('cuenta') && (
        <div className={section === 'cuenta' ? '' : 'hidden'}>
          <InstructorCuenta profile={accountProfile ?? authProfile} onProfileUpdate={setAccountProfile} />
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
        <AdminTopbar
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

      <BloqueoExamenesModal
        profile={modalBloqueo}
        examenes={examenes}
        estaBloqueado={estaBloqueado}
        onToggle={toggleBloqueoAlumno}
        actionLoading={actionLoading}
        onClose={() => setModalBloqueo(null)}
      />
      <ResultadosAlumnoModal
        profile={modalResultados}
        onClose={() => setModalResultados(null)}
      />
      <InstructorAccesos
        profile={modalAccesos}
        onClose={() => setModalAccesos(null)}
      />
    </div>
  );
}