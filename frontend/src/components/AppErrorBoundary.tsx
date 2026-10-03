import React from 'react';
import { recoverAssetLoad } from '@/lib/assetRecovery';

type Props = React.PropsWithChildren<{ initialError?: Error }>;
type State = { error: Error | null };

export default class AppErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: props.initialError ?? null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[UASSPAIN] Error de renderizado:', error, info);
    void recoverAssetLoad(error);
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
              No hemos podido abrir esta página. Comprueba tu conexión y vuelve a intentarlo.
            </p>
            <button
              type="button"
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground"
              onClick={() => window.location.reload()}
            >
              Volver a intentar
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
