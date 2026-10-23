import { useSyncExternalStore } from 'react';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';

const subscribe = () => () => {};
const client = () => true;
const server = () => false;

/** Uses the application's single next-themes provider, including its storage policy. */
export default function ThemeControl({ className = '' }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(subscribe, client, server);
  const dark = !mounted || resolvedTheme !== 'light';
  const button = 'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border-0 bg-transparent text-foreground hover:bg-transparent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';
  return <div role="group" aria-label="Tema de la aplicación" className={`inline-flex shrink-0 items-center ${className}`}>
    <button type="button" className={button} onClick={() => setTheme(dark ? 'light' : 'dark')}
      aria-label={dark ? 'Activar tema claro' : 'Activar tema oscuro'} title={dark ? 'Tema claro' : 'Tema oscuro'}>
      <Sun aria-hidden="true" className="hidden h-4 w-4 dark:block" />
      <Moon aria-hidden="true" className="h-4 w-4 dark:hidden" />
    </button>
  </div>;
}
