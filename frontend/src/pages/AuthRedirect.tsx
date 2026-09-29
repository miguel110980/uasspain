import React, { useEffect, useState } from 'react';
import { Loader2, AlertCircle } from 'lucide-react';
import authService from '@/services/authService';
import { decodeTokenFromTransport } from '@/lib/urls';

/** Redirección post-login OAuth (cookies HttpOnly ya establecidas por el backend). */
export default function AuthRedirect() {
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const params = new URLSearchParams(window.location.search);
        const queryError = params.get('error');
        if (queryError) {
          throw new Error(decodeTokenFromTransport(queryError));
        }

        window.history.replaceState(null, '', window.location.pathname);

        const route = await authService.resolvePostLoginRoute();
        window.location.href = route;
      } catch (err) {
        setError(err.message || 'No se pudo completar el acceso.');
        setTimeout(() => authService.logout('/'), 3000);
      }
    })();
  }, []);

  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <div className="glass-card p-8 max-w-md text-center">
          <AlertCircle className="w-10 h-10 text-warning mx-auto mb-4" />
          <p className="text-sm text-muted-foreground">{error}</p>
          <p className="text-xs text-muted-foreground/60 mt-2">Será redirigido en unos segundos...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <Loader2 className="w-8 h-8 text-primary animate-spin" />
    </div>
  );
}
