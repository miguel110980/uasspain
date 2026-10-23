import React, { useState, useEffect, useRef, type RefObject } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Menu, Search, Bell, ChevronDown, LogOut, User } from 'lucide-react';
import ThemeControl from '@/components/ui/ThemeControl';

function usePopoverFocus(ref: RefObject<HTMLDivElement | null>, open: boolean, close: () => void) {
  const onClose = useRef(close);
  onClose.current = close;
  useEffect(() => {
    if (!open) return;
    const panel = ref.current?.querySelector<HTMLElement>('[role="dialog"]');
    if (!panel) return;
    const trigger = ref.current?.querySelector<HTMLButtonElement>('button[aria-haspopup]');
    const items = () => Array.from(panel.querySelectorAll<HTMLButtonElement>('button:not([disabled])'));
    (items()[0] || panel).focus();
    const onKey = (event: KeyboardEvent) => {
      const controls = items();
      const index = controls.indexOf(document.activeElement as HTMLButtonElement);
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation(); onClose.current(); trigger?.focus();
      } else if (event.key === 'Tab') onClose.current();
      else if (controls.length && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? controls.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + controls.length) % controls.length;
        controls[next].focus();
      }
    };
    panel.addEventListener('keydown', onKey);
    return () => panel.removeEventListener('keydown', onKey);
  }, [ref, open]);
}

/**
 * @param {{
 *   title: string,
 *   onMenu: () => void,
 *   user?: { full_name?: string, email?: string },
 *   onLogout: () => void,
 *   onAccount?: () => void,
 *   pendingCount?: number,
 *   notifications?: Array<{ id: string, title: string, description?: string, onSelect?: () => void }>,
 *   onViewAllNotifications?: () => void,
 *   viewAllLabel?: string,
 * }} props
 */
type AdminTopbarProps = {
  title: string;
  onMenu: () => void;
  user?: { full_name?: string; email?: string };
  onLogout: () => void;
  onAccount?: () => void;
  pendingCount?: number;
  notifications?: Array<{ id: string; title: string; description?: string; onSelect?: () => void }>;
  onViewAllNotifications?: () => void;
  viewAllLabel?: string;
  navigation?: Array<{ id: string; label: string }>;
  onNavigate?: (id: string) => void;
};

export default function AdminTopbar({
  title,
  onMenu,
  user,
  onLogout,
  onAccount,
  pendingCount = 0,
  notifications = [],
  onViewAllNotifications,
  viewAllLabel = 'Ver todas las notificaciones',
  navigation = [],
  onNavigate,
}: AdminTopbarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const notifRef = useRef<HTMLDivElement | null>(null);
  usePopoverFocus(menuRef, menuOpen, () => setMenuOpen(false));
  usePopoverFocus(notifRef, notifOpen, () => setNotifOpen(false));
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [search, setSearch] = useState('');
  const matches = search.trim() ? navigation.filter(item => item.label.toLocaleLowerCase('es').includes(search.trim().toLocaleLowerCase('es'))) : [];
  const navigate = (id: string) => { setSearch(''); onNavigate?.(id); };

  const badgeCount = pendingCount > 0 ? pendingCount : notifications.length;

  useEffect(() => {
    const onClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
      if (notifRef.current && !notifRef.current.contains(e.target)) setNotifOpen(false);
    };
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === 'Escape') {
        setSearch('');
        setMenuOpen(false);
        setNotifOpen(false);
      }
    };
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  const handleNotifSelect = (item) => {
    setNotifOpen(false);
    item.onSelect?.();
  };

  return (
    <header className="sticky top-0 z-30 h-16 flex items-center gap-4 px-4 md:px-6 border-b border-border-subtle bg-background/80 backdrop-blur-xl">
      <button type="button" aria-label="Abrir menú" onClick={onMenu} className="lg:hidden text-muted-foreground hover:text-foreground">
        <Menu className="w-5 h-5" />
      </button>

      <h1 className={`font-heading text-base md:text-lg font-semibold text-foreground ${['Conexiones VPN', 'Copias de seguridad'].includes(title) ? 'min-w-0 whitespace-normal break-words leading-tight' : 'truncate'}`}>{title}</h1>

      <div className="relative ml-auto hidden md:flex items-center gap-2 px-3 h-9 w-64 border border-border-subtle rounded-md bg-surface-subtle focus-within:border-primary/30 transition-colors">
        <Search className="w-4 h-4 text-muted-foreground/60" />
        <input
          ref={searchRef}
          aria-label="Buscar sección"
          placeholder="Buscar sección…"
          value={search}
          disabled={navigation.length === 0}
          onChange={event => setSearch(event.target.value)}
          onKeyDown={event => { if (event.key === 'Enter' && matches[0]) navigate(matches[0].id); }}
          className="bg-transparent text-sm text-foreground placeholder:text-muted-foreground/40 outline-none w-full"
        />
        <kbd className="text-[10px] font-mono text-muted-foreground/40 border border-border-subtle px-1 rounded">⌘K</kbd>
        {search.trim() && (
          <div className="absolute left-0 right-0 top-full mt-2 bg-popover border border-border-subtle rounded-md shadow-xl">
            {matches.length ? matches.map(item => (
              <button key={item.id} onClick={() => navigate(item.id)} className="block w-full text-left px-3 py-2 text-sm text-foreground hover:bg-primary/10">{item.label}</button>
            )) : <p className="px-3 py-2 text-xs text-muted-foreground">Sin resultados</p>}
          </div>
        )}
      </div>

      <ThemeControl className="ml-auto md:ml-0" />
      <div className="relative" ref={notifRef}>
        <button
          type="button"
          onClick={() => { setMenuOpen(false); setNotifOpen((open) => !open); }}
          aria-label="Notificaciones"
          aria-expanded={notifOpen}
          aria-haspopup="dialog"
          className="relative w-9 h-9 flex items-center justify-center border border-border-subtle rounded-md text-muted-foreground hover:text-brand-cyan-text hover:border-primary/30 transition-colors"
        >
          <Bell className="w-4 h-4" />
          {badgeCount > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 flex items-center justify-center rounded-full bg-primary text-primary-foreground text-[10px] font-bold">
              {badgeCount > 9 ? '9+' : badgeCount}
            </span>
          )}
        </button>

        <AnimatePresence>
          {notifOpen && (
            <motion.div
              role="dialog" aria-label="Notificaciones" tabIndex={-1}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
              className="fixed left-4 right-4 top-16 mt-2 sm:absolute sm:left-auto sm:right-0 sm:top-full sm:w-80 max-w-[calc(100vw-2rem)] rounded-md overflow-hidden border border-border-subtle bg-popover backdrop-blur-xl shadow-2xl"
            >
              <div className="px-3 py-2 border-b border-border-subtle">
                <p className="text-xs font-semibold text-foreground">Notificaciones</p>
                <p className="text-[10px] text-muted-foreground">
                  {notifications.length > 0
                    ? `${notifications.length} aviso(s) pendiente(s)`
                    : 'No hay avisos nuevos'}
                </p>
              </div>

              {notifications.length === 0 ? (
                <p className="px-3 py-4 text-xs text-muted-foreground text-center">
                  Todo al día. No tienes alertas pendientes.
                </p>
              ) : (
                <div className="max-h-72 overflow-y-auto">
                  {notifications.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => handleNotifSelect(item)}
                      className="w-full text-left px-3 py-2.5 border-b border-border-subtle last:border-0 hover:bg-primary/5 transition-colors"
                    >
                      <p className="text-xs text-foreground font-medium">{item.title}</p>
                      {item.description && (
                        <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">{item.description}</p>
                      )}
                    </button>
                  ))}
                </div>
              )}

              {onViewAllNotifications && (
                <button
                  type="button"
                  onClick={() => {
                    setNotifOpen(false);
                    onViewAllNotifications();
                  }}
                  className="w-full px-3 py-2 text-xs text-primary hover:bg-primary/5 border-t border-border-subtle transition-colors"
                >
                  {viewAllLabel}
                </button>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="relative" ref={menuRef}>
        <button
          type="button"
          onClick={() => { setNotifOpen(false); setMenuOpen(!menuOpen); }}
          aria-label="Menú de cuenta"
          aria-haspopup="dialog"
          aria-expanded={menuOpen}
          className="flex items-center gap-2 pl-1 pr-2 h-9 border border-border-subtle rounded-md hover:border-primary/30 transition-colors"
        >
          <div className="w-7 h-7 rounded-full bg-primary/15 text-primary flex items-center justify-center text-xs font-bold">
            {(user?.full_name || 'A').charAt(0).toUpperCase()}
          </div>
          <span className="hidden sm:block text-xs text-foreground max-w-[120px] truncate">{user?.full_name || 'Admin'}</span>
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
        </button>
        <AnimatePresence>
          {menuOpen && (
            <motion.div
              role="dialog" aria-label="Menú de cuenta" tabIndex={-1}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
              className="absolute right-0 top-full mt-2 w-48 rounded-md overflow-hidden border border-border-subtle bg-popover backdrop-blur-xl shadow-2xl"
            >
              <div className="px-3 py-2 border-b border-border-subtle">
                <p className="text-xs text-foreground truncate">{user?.full_name || 'Administrador'}</p>
                <p className="text-[10px] text-muted-foreground truncate">{user?.email}</p>
              </div>
              <button
                type="button"
                onClick={() => { setMenuOpen(false); onAccount?.(); }}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground hover:text-brand-cyan-text hover:bg-primary/5 transition-colors"
              >
                <User className="w-3.5 h-3.5" /> Mi cuenta
              </button>
              <button
                type="button"
                onClick={onLogout}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground hover:text-danger hover:bg-danger-soft/60 transition-colors"
              >
                <LogOut className="w-3.5 h-3.5" /> Cerrar sesión
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </header>
  );
}
