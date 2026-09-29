import React, { useEffect } from 'react';
import { Loader2, Shield, GraduationCap, LogOut } from 'lucide-react';
import authService from '@/services/authService';
import { useSession } from '@/hooks/useSession';
import { isBlockedStatus, needsPanelChoice, panelRouteForUser } from '@/lib/roles';

/** Pantalla para usuarios con rol admin e instructor: eligen panel tras login. */
export default function PanelChoice() {
  const { data: me, isLoading, isError } = useSession();

  useEffect(() => {
    if (isError) authService.redirectToLogin('/elegir-panel');
  }, [isError]);

  useEffect(() => {
    if (!me) return;

    const profile = me.profile;
    const status = profile?.status ?? me.status;

    if (isBlockedStatus(status)) {
      authService.logout('/');
      return;
    }

    const source = { ...me, profile };
    if (!needsPanelChoice(source)) {
      window.location.href = panelRouteForUser(source);
    }
  }, [me]);

  const goTo = async (path, role) => {
    try {
      await authService.setSessionRole(role);
    } catch {
      // continuar aunque falle
    }
    window.location.href = path;
  };

  if (isLoading || !me || !needsPanelChoice({ ...me, profile: me.profile })) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary animate-spin" aria-label="Cargando" />
      </div>
    );
  }

  const userName = me.full_name || me.email || '';

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 py-12">
      <div className="glass-card p-8 sm:p-10 max-w-lg w-full text-center">
        <p className="text-xs font-mono uppercase tracking-widest text-primary mb-2">Acceso staff</p>
        <h1 className="font-heading text-2xl font-bold text-foreground mb-2">¿Cómo desea entrar?</h1>
        {userName ? (
          <p className="text-sm text-muted-foreground mb-8">
            Sesión de <span className="text-foreground">{userName}</span>
          </p>
        ) : (
          <p className="text-sm text-muted-foreground mb-8">
            Tiene acceso como administrador e instructor. Elija el panel que desea usar.
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => goTo('/admin', 'admin')}
            className="group flex flex-col items-center gap-3 rounded-xl border border-border-strong bg-card/40 p-6 text-left transition-colors hover:border-primary/50 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <Shield className="w-10 h-10 text-primary transition-transform group-hover:scale-105" />
            <span className="font-heading text-lg font-semibold text-foreground">Administrador</span>
            <span className="text-xs text-muted-foreground text-center">
              Gestión global, usuarios, monitorización y configuración.
            </span>
          </button>

          <button
            type="button"
            onClick={() => goTo('/instructor', 'instructor')}
            className="group flex flex-col items-center gap-3 rounded-xl border border-border-strong bg-card/40 p-6 text-left transition-colors hover:border-primary/50 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <GraduationCap className="w-10 h-10 text-primary transition-transform group-hover:scale-105" />
            <span className="font-heading text-lg font-semibold text-foreground">Instructor</span>
            <span className="text-xs text-muted-foreground text-center">
              Alumnos, conexiones, chat y actividad del curso.
            </span>
          </button>
        </div>

        <button
          type="button"
          onClick={() => authService.logout('/')}
          className="mt-8 inline-flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors"
        >
          <LogOut className="w-4 h-4" />
          Cerrar sesión
        </button>
      </div>
    </div>
  );
}
