import { useMemo } from 'react';
import { Loader2, XCircle } from 'lucide-react';
import usePanelAuth from '@/hooks/usePanelAuth';
import PanelAuthContext from '@/context/PanelAuthContext';
import authService from '@/services/authService';
import DataLoadNotice from '@/components/ui/DataLoadNotice';

const ROLE_MESSAGES = {
  admin: 'Solo los administradores pueden acceder a esta sección.',
  instructor: 'Solo el instructor puede acceder a esta sección.',
  alumno: 'Solo los alumnos pueden acceder a esta sección.',
};

/**
 * Guard de ruta: exige JWT válido y rol del panel.
 * @param {{ role: 'admin'|'instructor'|'alumno', children: import('react').ReactNode }} props
 */
export default function ProtectedRoute({ role, children }) {
  const auth = usePanelAuth(role);

  const contextValue = useMemo(
    () => auth,
    [auth.loading, auth.user?.id, auth.profile?.id, auth.unauthorized, auth.blockedMessage],
  );

  if (auth.loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary animate-spin" aria-label="Cargando" />
      </div>
    );
  }

  if (auth.loadError) {
    return <main className="min-h-screen bg-background text-foreground flex items-center justify-center p-6">
      <div className="w-full max-w-md"><h1 className="font-heading text-xl mb-4">Comprobando sesión</h1>
        <DataLoadNotice error={auth.loadError} retry={auth.retry} /></div>
    </main>;
  }

  if (auth.unauthorized) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-6">
        <div className="text-center glass-card p-12 max-w-md">
          <XCircle className="w-12 h-12 text-danger mx-auto mb-4" />
          <h2 className="font-heading text-xl font-bold text-foreground mb-2">Acceso denegado</h2>
          <p className="text-sm text-muted-foreground mb-6">
            {auth.blockedMessage || ROLE_MESSAGES[role]}
          </p>
          <button
            type="button"
            onClick={() => authService.logout('/')}
            className="text-xs font-mono uppercase tracking-widest text-primary hover:text-foreground transition-colors"
          >
            Cerrar sesión
          </button>
        </div>
      </div>
    );
  }

  return (
    <PanelAuthContext.Provider value={contextValue}>
      {children}
    </PanelAuthContext.Provider>
  );
}
