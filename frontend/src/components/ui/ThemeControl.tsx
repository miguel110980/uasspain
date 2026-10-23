import { useSyncExternalStore } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';

const subscribe = () => () => {};
const client = () => true;
const server = () => false;

/** Uses the application's single next-themes provider, including its storage policy. */
export default function ThemeControl({ className = '' }: { className?: string }) {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(subscribe, client, server);
  const dark = !mounted || resolvedTheme !== 'light';
  const button = 'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-input bg-surface text-foreground hover:bg-surface-hover aria-pressed:bg-surface-active aria-pressed:text-brand-cyan-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';
  return <div role="group" aria-label="Tema de la aplicación" className={`inline-flex shrink-0 items-center gap-1 ${className}`}>
    <button type="button" className={button} onClick={() => setTheme(dark ? 'light' : 'dark')}
      aria-label={dark ? 'Activar tema claro' : 'Activar tema oscuro'} title={dark ? 'Tema claro' : 'Tema oscuro'}>
      <Sun aria-hidden="true" className="hidden h-4 w-4 dark:block" />
      <Moon aria-hidden="true" className="h-4 w-4 dark:hidden" />
    </button>
    <button type="button" className={button} onClick={() => setTheme('system')}
      aria-label="Usar tema del sistema" aria-pressed={mounted && theme === 'system'} title="Seguir el tema del sistema">
      <Monitor aria-hidden="true" className="h-4 w-4" />
    </button>
  </div>;
}
