import { Suspense, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';

/** Keep navigation and previously visited sections mounted while loading a section. */
export default function PanelSection({ children }: { children: ReactNode }) {
  return <Suspense fallback={<div role="status" className="flex items-center justify-center gap-2 p-8 text-muted-foreground"><Loader2 aria-hidden="true" className="h-5 w-5 animate-spin" />Cargando sección…</div>}>{children}</Suspense>;
}
