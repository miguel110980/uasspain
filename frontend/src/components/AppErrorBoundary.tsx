import React from 'react';

type Props = React.PropsWithChildren;
type State = { error: Error | null };

export default class AppErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[UASSPAIN] Error de renderizado:', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div
          className="min-h-screen flex items-center justify-center p-8 bg-background text-foreground"
          style={{ fontFamily: 'system-ui, sans-serif' }}
        >
          <div className="max-w-md text-center">
            <h1 className="text-xl mb-3 font-semibold">
              No se pudo cargar la aplicación
            </h1>
            <p className="text-muted-foreground mb-4 leading-relaxed">
              Recarga forzada: Ctrl+Shift+R (o Cmd+Shift+R en Mac). Tras un despliegue, el
              navegador puede tener JavaScript antiguo en caché que pide ficheros
              {' '}
              <code className="text-xs bg-muted px-1.5 py-0.5 rounded">/assets/*.js</code>
              {' '}
              ya eliminados.
            </p>
            <pre
              className="text-left overflow-auto p-3 rounded-lg bg-card border border-border text-sm text-destructive"
            >
              {String(this.state.error?.message || this.state.error)}
            </pre>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
