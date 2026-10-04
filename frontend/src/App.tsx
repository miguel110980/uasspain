import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import { Suspense, lazy, useEffect } from 'react';
import { refreshCourseQueries } from '@/services/contentService';
import { ThemeProvider } from 'next-themes';
import PageNotFound from './lib/PageNotFound';
import ScrollToTop from './components/ScrollToTop';
import SeoHead from './components/seo/SeoHead';
import ProtectedRoute from './components/ProtectedRoute';
import AppErrorBoundary from './components/AppErrorBoundary';
import { MotionConfig } from 'framer-motion';

const Home = lazy(() => import('./pages/Home'));
const Nosotros = lazy(() => import('./pages/Nosotros'));
const Tecnologia = lazy(() => import('./pages/Tecnologia'));
const Blog = lazy(() => import('./pages/Blog'));
const Contacto = lazy(() => import('./pages/Contacto'));
const Seguridad = lazy(() => import('./pages/servicios/Seguridad'));
const Emergencias = lazy(() => import('./pages/servicios/Emergencias'));
const Audiovisuales = lazy(() => import('./pages/servicios/Audiovisuales'));
const Radiofonista = lazy(() => import('./pages/servicios/Radiofonista'));
const Fumigacion = lazy(() => import('./pages/servicios/Fumigacion'));
const Inspeccion = lazy(() => import('./pages/servicios/Inspeccion'));
const Termografia = lazy(() => import('./pages/servicios/Termografia'));
const Formacion = lazy(() => import('./pages/Formacion'));
const CursoDinamico = lazy(() => import('./pages/CursoDinamico'));
const AdminPanel = lazy(() => import('./pages/AdminPanel'));
const AlumnoPanel = lazy(() => import('./pages/AlumnoPanel'));
const InstructorPanel = lazy(() => import('./pages/InstructorPanel'));
const PanelChoice = lazy(() => import('./pages/PanelChoice'));
const RestablecerContrasena = lazy(() => import('./pages/RestablecerContrasena'));
const PoliticaPrivacidad = lazy(() => import('./pages/PoliticaPrivacidad'));
const AvisoLegal = lazy(() => import('./pages/AvisoLegal'));
const PoliticaCookies = lazy(() => import('./pages/PoliticaCookies'));

const PageLoader = () => (
  <div className="fixed inset-0 flex items-center justify-center bg-background">
    <div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin"></div>
  </div>
);

function App() {
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return undefined;
    const channel = new BroadcastChannel('uasspain-courses');
    channel.onmessage = event => { if (event.data === 'changed') refreshCourseQueries(); };
    return () => channel.close();
  }, []);
  return (
    <AppErrorBoundary>
    <MotionConfig reducedMotion="user">
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
    <QueryClientProvider client={queryClientInstance}>
      <Router>
        <SeoHead />
        <ScrollToTop />
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/nosotros" element={<Nosotros />} />
            <Route path="/tecnologia" element={<Tecnologia />} />
            <Route path="/tecnología" element={<Navigate to="/tecnologia" replace />} />
            <Route path="/blog" element={<Blog />} />
            <Route path="/contacto" element={<Contacto />} />
            <Route path="/servicios" element={<Navigate to={{ pathname: '/', hash: '#servicios' }} replace />} />
            <Route path="/politica-privacidad" element={<PoliticaPrivacidad />} />
            <Route path="/aviso-legal" element={<AvisoLegal />} />
            <Route path="/politica-cookies" element={<PoliticaCookies />} />
            <Route path="/servicios/seguridad" element={<Seguridad />} />
            <Route path="/servicios/emergencias" element={<Emergencias />} />
            <Route path="/servicios/audiovisuales" element={<Audiovisuales />} />
            <Route path="/servicios/radiofonista" element={<Radiofonista />} />
            <Route path="/servicios/fumigacion" element={<Fumigacion />} />
            <Route path="/servicios/inspeccion" element={<Inspeccion />} />
            <Route path="/servicios/termografia" element={<Termografia />} />
            <Route path="/formacion" element={<Formacion />} />
            <Route path="/formacion/*" element={<CursoDinamico />} />
            <Route path="/elegir-panel" element={<PanelChoice />} />
            <Route path="/restablecer-contrasena" element={<RestablecerContrasena />} />
            <Route path="/admin" element={<ProtectedRoute role="admin"><AdminPanel /></ProtectedRoute>} />
            <Route path="/instructor" element={<ProtectedRoute role="instructor"><InstructorPanel /></ProtectedRoute>} />
            <Route path="/alumno" element={<ProtectedRoute role="alumno"><AlumnoPanel /></ProtectedRoute>} />
            <Route path="*" element={<PageNotFound />} />
          </Routes>
        </Suspense>
      </Router>
      <Toaster />
    </QueryClientProvider>
    </ThemeProvider>
    </MotionConfig>
    </AppErrorBoundary>
  );
}

export default App;
