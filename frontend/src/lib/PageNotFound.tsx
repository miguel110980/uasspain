import { Link, useLocation } from 'react-router-dom';
import { Home, AlertTriangle } from 'lucide-react';

export default function PageNotFound() {
  const location = useLocation();
  const pageName = location.pathname;

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-background">
      <div className="max-w-md w-full glass-card p-8 text-center">
        <p className="font-heading text-6xl font-bold text-primary/30 mb-2">404</p>
        <div className="h-px w-16 bg-primary/20 mx-auto mb-6" />
        <h1 className="font-heading text-xl font-bold text-foreground mb-3">
          Página no encontrada
        </h1>
        <p className="text-sm text-muted-foreground leading-relaxed mb-2">
          La ruta <span className="font-mono text-foreground/80">{pageName}</span> no existe en esta aplicación.
        </p>
        <div className="flex items-start gap-2 justify-center text-xs text-muted-foreground mt-4 mb-6">
          <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
          <span>Comprueba la URL o vuelve al inicio para continuar navegando.</span>
        </div>
        <Link
          to="/"
          className="inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground px-6 py-3 font-bold uppercase tracking-tighter text-sm hover:bg-primary/80 transition-all"
        >
          <Home className="w-4 h-4" />
          Ir al inicio
        </Link>
      </div>
    </div>
  );
}
