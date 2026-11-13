import FeedbackNavigation from '@/components/ui/FeedbackNavigation';
import React, { lazy, useState, useEffect } from 'react';
import {
  LayoutDashboard, ClipboardList, BarChart2, BookOpen, MessageCircle, Video, User, TrendingUp,
} from 'lucide-react';
import authService from '@/services/authService';
import { usePanelAuthContext } from '@/context/PanelAuthContext';
import conexionesService from '@/services/conexionesService';
import AdminSidebar from '@/components/admin/AdminSidebar';
import AdminTopbar from '@/components/admin/AdminTopbar';
const AlumnoCuenta = lazy(() => import('@/pages/alumno/AlumnoCuenta'));
const AlumnoExamenes = lazy(() => import('@/pages/alumno/AlumnoExamenes'));
const AlumnoResultados = lazy(() => import('@/pages/alumno/AlumnoResultados'));
const AlumnoMaterial = lazy(() => import('@/pages/alumno/AlumnoMaterial'));
const AlumnoEvolucion = lazy(() => import('@/pages/alumno/AlumnoEvolucion'));
import AlumnoDashboard from '@/pages/alumno/AlumnoDashboard';
const AlumnoChat = lazy(() => import('@/pages/alumno/AlumnoChat'));
const AlumnoVideo = lazy(() => import('@/components/videollamada/AlumnoVideo'));
const ExamenActivo = lazy(() => import('@/pages/alumno/ExamenActivo'));

import PanelSection from '@/components/ui/PanelSection';

const NAV_GROUPS = [
  {
    label: 'Principal',
    items: [{ id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard }],
  },
  {
    label: 'Académico',
    items: [
      { id: 'examenes', label: 'Exámenes', icon: ClipboardList },
      { id: 'resultados', label: 'Resultados', icon: BarChart2 },
      { id: 'material', label: 'Material', icon: BookOpen },
      { id: 'evolucion', label: 'Evolución', icon: TrendingUp },
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
    label: 'Cuenta',
    items: [{ id: 'cuenta', label: 'Mi cuenta', icon: User }],
  },
];

const TITLES = Object.fromEntries(NAV_GROUPS.flatMap((g) => g.items.map((i) => [i.id, i.label])));

// Nota: las pestañas del contenido principal permanecen montadas (toggle con 'hidden')
// para evitar recargas de datos al cambiar de pestaña y mejorar la fluidez en móvil.
export default function AlumnoPanel() {
  const [academicRevision, setAcademicRevision] = useState(0);
  const [section, setSection] = useState('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { user, profile: authProfile } = usePanelAuthContext();
  const [profile, setProfile] = useState(null);
  const [examenActivo, setExamenActivo] = useState(null);
  const [conexionId, setConexionId] = useState(null);
  const [chatSinLeer, setChatSinLeer] = useState(false);
  const [videoEntrante, setVideoEntrante] = useState(false);
  const [visitedTabs, setVisitedTabs] = useState(() => new Set(['dashboard']));
  const conexionIdRef = React.useRef(null);

  useEffect(() => {
    document.title = 'Panel Alumno | UASSPAIN';
  }, []);

  useEffect(() => {
    if (authProfile) setProfile(authProfile);
  }, [authProfile]);

  useEffect(() => {
    if (!profile?.id || !user) return;

    (async () => {
      try {
        const nombreAlumno = `${profile.nombre || ''} ${profile.apellidos || ''}`.trim() || user.email;
        const abiertas = await conexionesService.conexiones.filter({ alumno_id: profile.id });
        const existente = abiertas.find((c) => !c.fecha_desconexion);
        if (existente) {
          conexionIdRef.current = existente.id;
          setConexionId(existente.id);
        } else {
          const conexion = await conexionesService.conexiones.create({
            alumno_id: profile.id,
            alumno_nombre: nombreAlumno,
            fecha_conexion: new Date().toISOString(),
          });
          conexionIdRef.current = conexion.id;
          setConexionId(conexion.id);
        }
      } catch (err) {
        console.error('Error registrando conexión del alumno:', err);
      }
    })();
  }, [profile, user]);

  useEffect(() => {
    const idConexion = conexionIdRef;
    return () => {
      const id = idConexion.current;
      if (id) {
        conexionesService.conexiones
          .update(id, { fecha_desconexion: new Date().toISOString() })
          .catch(() => {});
      }
    };
  }, []);

  useEffect(() => {
    if (!profile?.id) return;
    const checkNoLeidos = async () => {
      try {
        const noLeidos = await conexionesService.mensajes.unreadCount(String(profile.id));
        setChatSinLeer(noLeidos > 0);
      } catch {}
    };
    checkNoLeidos();
    const unsubscribe = conexionesService.subscribeMensajes(() => checkNoLeidos());
    return () => unsubscribe();
  }, [profile?.id]);

  useEffect(() => {
    if (!profile?.id) return;
    const checkVideo = async () => {
      try {
        const activas = await conexionesService.videollamadas.filter({ alumno_id: profile.id, estado: 'activa', iniciada_por: 'instructor' });
        setVideoEntrante(activas.length > 0);
      } catch {}
    };
    checkVideo();
    const unsubscribe = conexionesService.subscribeVideollamadas(() => checkVideo());
    return () => unsubscribe();
  }, [profile?.id]);

  useEffect(() => {
    let active = true;
    const unsubscribe = conexionesService.subscribeConexiones(event => {
      const payload = conexionesService.parseWsPayload(event);
      if (payload?.type !== 'asignacion') return;
      setAcademicRevision(value => value + 1);
      setChatSinLeer(false); setVideoEntrante(false);
      authService.me().then(current => { if (active) setProfile(current.profile); }).catch(() => {});
    });
    return () => { active = false; unsubscribe(); };
  }, []);

  const handleLogout = async () => {
    try {
      if (conexionId) {
        await conexionesService.conexiones.update(conexionId, { fecha_desconexion: new Date().toISOString() });
      }
    } catch {}
    await authService.logout('/');
  };

  const handleIniciarExamen = (examen, modalidad) => {
    setExamenActivo({ examen, modalidad });
  };

  const handleFinalizarExamen = () => {
    setExamenActivo(null);
    setSection('resultados');
    setVisitedTabs((prev) => new Set(prev).add('resultados'));
  };

  const handleSelect = (id) => {
    if (examenActivo) return;
    setSection(id);
    setVisitedTabs((prev) => new Set(prev).add(id));
    setSidebarOpen(false);
    if (id === 'chat') setChatSinLeer(false);
    if (id === 'video') setVideoEntrante(false);
  };

  const topbarNotifications = [];
  if (chatSinLeer) {
    topbarNotifications.push({
      id: 'chat-unread',
      title: 'Mensajes de chat sin leer',
      description: 'Tienes mensajes nuevos del instructor.',
      onSelect: () => handleSelect('chat'),
    });
  }
  if (videoEntrante) {
    topbarNotifications.push({
      id: 'video-incoming',
      title: 'Videollamada del instructor',
      description: 'Hay una videollamada activa esperándote.',
      onSelect: () => handleSelect('video'),
    });
  }

  const navGroups = NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.map((item) => ({
      ...item,
      badge:
        item.id === 'chat' ? (chatSinLeer ? 1 : 0) :
        item.id === 'video' ? (videoEntrante ? 1 : 0) : 0,
    })),
  }));

  const topbarUser = user
    ? { ...user, full_name: `${profile?.nombre || ''} ${profile?.apellidos || ''}`.trim() || user.full_name }
    : null;

  return (
    <div className="min-h-screen bg-background text-foreground flex">
      <FeedbackNavigation value={section} />
      <AdminSidebar
        groups={navGroups}
        section={section}
        onSelect={handleSelect}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        roleLabel="Alumno"
      />

      <div className="flex-1 min-w-0 flex flex-col">
        <AdminTopbar
          title={examenActivo ? 'Examen en curso' : (TITLES[section] || 'Panel')}
          onMenu={() => setSidebarOpen(true)}
          user={topbarUser}
          onLogout={handleLogout}
          onAccount={() => handleSelect('cuenta')}
          pendingCount={topbarNotifications.length}
          notifications={topbarNotifications}
        />
        <main key={academicRevision} className="flex-1 p-4 md:p-6 max-w-[1400px] w-full mx-auto">
          {examenActivo ? (
            <PanelSection><ExamenActivo
              examen={examenActivo.examen}
              modalidad={examenActivo.modalidad}
              onFinalizar={handleFinalizarExamen}
            /></PanelSection>
          ) : (
            <>
              <div className={section === 'dashboard' ? '' : 'hidden'}>
                <AlumnoDashboard
                  alumnoId={profile?.id}
                  alumnoNombre={`${profile?.nombre || ''} ${profile?.apellidos || ''}`.trim()}
                  assignedInstructorName={profile?.assigned_instructor_name}
                />
              </div>
              {visitedTabs.has('examenes') && (
                <div className={section === 'examenes' ? '' : 'hidden'}>
                  <PanelSection><AlumnoExamenes
                    alumnoId={profile?.id}
                    onIniciarExamen={handleIniciarExamen}
                  /></PanelSection>
                </div>
              )}
              {visitedTabs.has('resultados') && (
                <div className={section === 'resultados' ? '' : 'hidden'}>
                  <PanelSection><AlumnoResultados alumnoId={profile?.id} /></PanelSection>
                </div>
              )}
              {visitedTabs.has('material') && (
                <div className={section === 'material' ? '' : 'hidden'}>
                  <PanelSection><AlumnoMaterial alumnoId={profile?.id} /></PanelSection>
                </div>
              )}
              {visitedTabs.has('evolucion') && (
                <div className={section === 'evolucion' ? '' : 'hidden'}>
                  <PanelSection><AlumnoEvolucion alumnoId={profile?.id} /></PanelSection>
                </div>
              )}
              {visitedTabs.has('chat') && (
                <div className={section === 'chat' ? '' : 'hidden'}>
                  <PanelSection><AlumnoChat alumnoId={profile?.id} alumnoNombre={`${profile?.nombre || ''} ${profile?.apellidos || ''}`.trim()} /></PanelSection>
                </div>
              )}
              {visitedTabs.has('video') && (
                <div className={section === 'video' ? '' : 'hidden'}>
                  <PanelSection><AlumnoVideo alumnoId={profile?.id} alumnoNombre={`${profile?.nombre || ''} ${profile?.apellidos || ''}`.trim()} /></PanelSection>
                </div>
              )}
              {visitedTabs.has('cuenta') && (
                <div className={section === 'cuenta' ? '' : 'hidden'}>
                  <PanelSection><AlumnoCuenta profile={profile} onProfileUpdate={setProfile} /></PanelSection>
                </div>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
