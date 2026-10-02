import React, { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useTheme } from 'next-themes';
import { useQuery } from '@tanstack/react-query';
import {
  Menu, X, ChevronDown, Shield, Siren, Camera, Radio,
  SprayCan, ScanLine, Thermometer, GraduationCap, Plane,
  RadioTower, Sun, Moon, LogOut, UserRound,
} from 'lucide-react';
const AuthModal = lazy(() => import('@/components/auth/AuthModal'));
import Logo from '@/components/layout/Logo';
import styles from './Navbar.module.css';
import contentService from '@/services/contentService';
import authService from '@/services/authService';
import useSession from '@/hooks/useSession';
import { panelRouteForUser } from '@/lib/roles';

const navLinks = [
  { label: 'Inicio', href: '/' },
  {
    label: 'Servicios',
    href: '/servicios',
    children: [
      { label: 'Emergencias', href: '/servicios/emergencias', icon: Siren },
      { label: 'Seguridad', href: '/servicios/seguridad', icon: Shield },
      { label: 'Radiofonista', href: '/servicios/radiofonista', icon: Radio },
      { label: 'Audiovisuales', href: '/servicios/audiovisuales', icon: Camera },
      { label: 'Fumigación', href: '/servicios/fumigacion', icon: SprayCan },
      { label: 'Inspección', href: '/servicios/inspeccion', icon: ScanLine },
      { label: 'Termografía', href: '/servicios/termografia', icon: Thermometer },
    ],
  },
  {
    label: 'Formación',
    groups: [
      {
        label: 'Cursos EASA',
        children: [
          { label: 'A1/A3', href: '/formacion/easa/a1-a3', icon: GraduationCap },
          { label: 'A2', href: '/formacion/easa/a2', icon: GraduationCap },
          { label: 'STS — General', href: '/formacion/easa/sts', icon: Plane },
          { label: 'STS-01 — VLOS Poblado', href: '/formacion/easa/sts-01', icon: Plane },
          { label: 'STS-02 — BVLOS', href: '/formacion/easa/sts-02', icon: Plane },
        ],
      },
      {
        label: 'Cursos no EASA',
        children: [
          { label: 'Radiofonista UAS', href: '/formacion/no-easa/radiofonista', icon: RadioTower },
          { label: 'Seguridad', href: '/formacion/no-easa/seguridad', icon: Shield },
          { label: 'Emergencias / APO', href: '/formacion/no-easa/emergencias-apo', icon: Siren },
          { label: 'EN01', href: '/formacion/no-easa/en01', icon: RadioTower },
          { label: 'EN02', href: '/formacion/no-easa/en02', icon: RadioTower },
          { label: 'Operadores SOC', href: '/formacion/no-easa/operadores-soc', icon: Shield },
        ],
      },
      {
        label: 'Instructor UAS',
        children: [
          { label: 'Certificación de Instructor', href: '/formacion/instructor/certificacion', icon: GraduationCap },
          { label: 'Revalidación de Instructor', href: '/formacion/instructor/revalidacion', icon: GraduationCap },
          { label: 'Formación Continua', href: '/formacion/instructor/continua', icon: GraduationCap },
        ],
      },
    ],
  },
  { label: 'Tecnología', href: '/tecnologia' },
  { label: 'Quiénes Somos', href: '/nosotros' },
  { label: 'Blog', href: '/blog' },
  { label: 'Contacto', href: '/contacto' },
];

const SCROLL_MAX = 160;

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

export default function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(null);
  const [mobileDropdownOpen, setMobileDropdownOpen] = useState(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [resolvedTheme, setResolvedTheme] = useState('dark');
  const { setTheme } = useTheme();
  const navigate = useNavigate();
  const navRef = useRef(null);
  const mobileMenuRef = useRef(null);
  const mobileTriggerRef = useRef(null);
  const rafRef = useRef(null);
  const location = useLocation();
  const { data: session } = useSession();
  const { data: managedCourses = [] } = useQuery({
    queryKey: ['public', 'courses'],
    queryFn: contentService.publicCourses,
    staleTime: 5 * 60 * 1000,
  });
  const effectiveNavLinks = navLinks.map((link) => link.label !== 'Formación' ? link : {
    ...link,
    groups: [
      { label: 'Catálogo', children: [
        { label: 'Todos los cursos', href: '/formacion', icon: GraduationCap },
        ...managedCourses.map((course) => ({
          label: course.status === 'upcoming' ? `${course.name} · Próximamente` : course.name,
          href: course.status === 'published' ? `/formacion/${course.slug}` : '/formacion',
          icon: GraduationCap,
        })),
      ] },
      ...(link.groups || []),
    ],
  });

  useEffect(() => {
    const sync = () => {
      setResolvedTheme(document.documentElement.classList.contains('light') ? 'light' : 'dark');
    };
    sync();
    const obs = new MutationObserver(sync);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    const onScroll = () => {
      if (rafRef.current) return;
      rafRef.current = requestAnimationFrame(() => {
        const y = window.scrollY;
        const raw = Math.min(y / SCROLL_MAX, 1);
        const p = easeOutCubic(raw);
        const nav = navRef.current;
        if (!nav) { rafRef.current = null; return; }

        const isDark = !document.documentElement.classList.contains('light');
        const alpha = p * 0.82;
        const blur = p * 16;
        const borderAlpha = 0.08 * Math.min(p * 2, 1);

        if (isDark) {
          nav.style.backgroundColor = `rgba(0,0,0,${alpha})`;
          nav.style.borderColor = `rgba(255,255,255,${borderAlpha})`;
          nav.style.boxShadow = p > 0 ? '0 1px 3px rgba(0,0,0,0.15)' : 'none';
        } else {
          nav.style.backgroundColor = 'rgb(245,247,250)';
          nav.style.borderColor = `rgba(0,0,0,${borderAlpha})`;
          nav.style.boxShadow = p > 0 ? '0 1px 3px rgba(0,0,0,0.06)' : 'none';
        }
        nav.style.backdropFilter = isDark && p > 0 ? `blur(${blur}px)` : 'none';
        nav.style.webkitBackdropFilter = nav.style.backdropFilter;

        rafRef.current = null;
      });
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [resolvedTheme]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('auth') === 'login') setAuthOpen(true);
  }, [location.search]);

  const closeMobileMenu = useCallback((restoreFocus = false) => {
    setMobileOpen(false);
    setMobileDropdownOpen(null);
    if (restoreFocus) {
      requestAnimationFrame(() => mobileTriggerRef.current?.focus());
    }
  }, []);

  useEffect(() => {
    closeMobileMenu(false);
    setDropdownOpen(null);
  }, [location.pathname, closeMobileMenu]);

  useEffect(() => {
    if (!mobileOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => {
      mobileMenuRef.current
        ?.querySelector('a[href], button:not([disabled])')
        ?.focus();
    });
    const onKeyDown = (event) => {
      if (event.key === 'Escape') closeMobileMenu(true);
      if (event.key === 'Tab') {
        const items = [mobileTriggerRef.current, ...Array.from(mobileMenuRef.current?.querySelectorAll('a[href], button:not([disabled])') || [])]
          .filter((item) => item && item.getClientRects().length);
        const first = items[0];
        const last = items[items.length - 1];
        if (event.shiftKey && (document.activeElement === first || !items.includes(document.activeElement))) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !items.includes(document.activeElement))) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    const onPointerDown = (event) => {
      if (navRef.current && !navRef.current.contains(event.target)) {
        closeMobileMenu(false);
      }
    };
    const onResize = () => {
      if (window.innerWidth >= 1440) closeMobileMenu(false);
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('resize', onResize);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('resize', onResize);
    };
  }, [mobileOpen, closeMobileMenu]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setDropdownOpen(null);
    };
    const onPointerDown = (event) => {
      if (navRef.current && !navRef.current.contains(event.target)) {
        setDropdownOpen(null);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, []);

  const handleAuthClose = useCallback(() => {
    setAuthOpen(false);
    const params = new URLSearchParams(location.search);
    if (params.get('auth') === 'login') {
      params.delete('auth');
      const qs = params.toString();
      navigate(`${location.pathname}${qs ? `?${qs}` : ''}`, { replace: true });
    }
  }, [location.search, location.pathname, navigate]);

  const handleNavClick = useCallback(() => closeMobileMenu(false), [closeMobileMenu]);

  const isChildActive = useCallback((children, groups) => {
    if (children?.some((c) => c.href === location.pathname)) return true;
    if (groups) return groups.some((g) => g.children.some((c) => c.href === location.pathname));
    return false;
  }, [location.pathname]);

  const isDark = resolvedTheme === 'dark';
  const panelRoute = session ? panelRouteForUser(session) : '/';

  const handleLogout = useCallback(async () => {
    closeMobileMenu(false);
    await authService.logout('/');
  }, [closeMobileMenu]);

  const linkClass = (active) =>
    `${styles.navLink} text-[15px] font-semibold uppercase transition-colors duration-300 ${
      active ? 'text-primary' : 'text-muted-foreground hover:text-primary'
    }`;

  const renderDropdown = (link) => {
    const items = link.groups
      ? link.groups.flatMap((g) => g.children)
      : link.children;
    const groups = link.groups;

    return (
      <div key={link.label} className="relative">
        <button
          onClick={() => setDropdownOpen(dropdownOpen === link.label ? null : link.label)}
          className={`${styles.navLink} flex items-center gap-1.5 text-[15px] font-semibold uppercase transition-colors duration-300 ${
            isChildActive(link.children, link.groups) ? 'text-primary' : 'text-muted-foreground hover:text-primary'
          }`}
          aria-expanded={dropdownOpen === link.label}
          aria-controls={`desktop-menu-${link.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
        >
          {link.label}
          <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${dropdownOpen === link.label ? 'rotate-180' : ''}`} />
        </button>
        <AnimatePresence>
          {dropdownOpen === link.label && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.2 }}
              id={`desktop-menu-${link.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
              className={`${styles.desktopMenu} absolute top-full left-1/2 -translate-x-1/2 mt-3 w-56 rounded-lg shadow-2xl border border-border bg-popover z-50`}
            >
              <div className="p-2">
                {groups
                  ? groups.map((group, gi) => (
                      <React.Fragment key={group.label}>
                        {gi > 0 && <div className="my-1 border-t border-border" />}
                        <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50 cursor-default">
                          {group.label}
                        </div>
                        {group.children.map((item) => (
                          <Link
                            key={item.label}
                            to={item.href}
                            onClick={() => setDropdownOpen(null)}
                            className="flex items-center gap-3 px-3 py-2.5 text-sm text-muted-foreground hover:text-primary hover:bg-primary/5 rounded-md transition-all duration-200"
                          >
                            <item.icon className="w-4 h-4" />
                            {item.label}
                          </Link>
                        ))}
                      </React.Fragment>
                    ))
                  : items.map((item) => (
                      <Link
                        key={item.label}
                        to={item.href}
                        onClick={() => setDropdownOpen(null)}
                        className="flex items-center gap-3 px-3 py-2.5 text-sm text-muted-foreground hover:text-primary hover:bg-primary/5 rounded-md transition-all duration-200"
                      >
                        <item.icon className="w-4 h-4" />
                        {item.label}
                      </Link>
                    ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  };

  return (
    <nav
      ref={navRef}
      aria-label="Navegación principal"
      className="fixed top-0 left-0 w-full z-50 border-b border-transparent transition-[background-color,border-color,box-shadow,backdrop-filter] duration-300"
    >
      <div className={styles.header} data-header-blocks="3">
        <div className={styles.identity} data-header-block="identity">
          <Logo size="header" withTagline={false} className={styles.brand} />
        </div>

        {/* ── CENTER: Nav links (desktop ≥1440px only) ── */}
        <div className={styles.nav} data-header-block="navigation">
          {effectiveNavLinks.map((link) =>
            link.children || link.groups ? renderDropdown(link) : (
              <Link
                key={link.label}
                to={link.href}
                onClick={handleNavClick}
                className={linkClass(location.pathname === link.href)}
              >
                {link.label}
              </Link>
            )
          )}
        </div>

        {/* ── RIGHT: Desktop actions (≥1440px) ── */}
        {/* ── RIGHT: Mobile/Tablet actions (<1440px) ── */}
        <div className={styles.actions} data-header-block="controls">
          <button
            onClick={() => setTheme(isDark ? 'light' : 'dark')}
            className={`${styles.iconButton} rounded-full text-muted-foreground hover:text-primary hover:bg-surface-muted transition-colors duration-300`}
            aria-label={isDark ? 'Activar tema claro' : 'Activar tema oscuro'}
            title={isDark ? 'Tema claro' : 'Tema oscuro'}
          >
            {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
          {session ? (
            <>
              <Link
                to={panelRoute}
                className={styles.sessionButton}
                title={session.full_name || 'Abrir panel'}
                aria-label={`Abrir panel de ${session.full_name || 'usuario'}`}
              >
                <UserRound className="w-4 h-4 shrink-0" />
                <span className={styles.sessionName}>{session.full_name || 'Panel'}</span>
              </Link>
              <button
                onClick={() => void handleLogout()}
                className={`${styles.iconButton} rounded-full text-muted-foreground hover:text-danger hover:bg-danger-soft transition-colors duration-300`}
                aria-label="Cerrar sesión"
                title="Cerrar sesión"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </>
          ) : (
            <button onClick={() => setAuthOpen(true)} className={styles.accessButton}>
              Acceso
            </button>
          )}
          <button
            ref={mobileTriggerRef}
            onClick={() => setMobileOpen((open) => !open)}
            className={`${styles.menuButton} text-foreground`}
            aria-label={mobileOpen ? 'Cerrar menú' : 'Abrir menú'}
            aria-expanded={mobileOpen}
            aria-controls="main-mobile-menu"
          >
            {mobileOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
      </div>

      {/* ── Mobile menu ── */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            ref={mobileMenuRef}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            id="main-mobile-menu"
            role="dialog"
            aria-label="Menú de navegación"
            className={`${styles.mobileMenu} border-t`}
            style={{
              backgroundColor: isDark ? '#02070a' : '#F5F7FA',
              borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
            }}
          >
            <div className="px-6 py-5 space-y-1">
              {effectiveNavLinks.map((link) => (
                <React.Fragment key={link.label}>
                  {link.children || link.groups ? (
                    <button
                      onClick={() => setMobileDropdownOpen(mobileDropdownOpen === link.label ? null : link.label)}
                      className={`w-full flex items-center justify-between py-3 text-sm font-medium uppercase tracking-widest transition-colors ${
                        isChildActive(link.children, link.groups) ? 'text-primary' : 'text-muted-foreground hover:text-primary'
                      }`}
                      aria-expanded={mobileDropdownOpen === link.label}
                    >
                      {link.label}
                      <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${mobileDropdownOpen === link.label ? 'rotate-180' : ''}`} />
                    </button>
                  ) : (
                    <Link
                      to={link.href}
                      onClick={handleNavClick}
                      className={`block py-3 text-sm font-medium uppercase tracking-widest transition-colors ${
                        location.pathname === link.href ? 'text-primary' : 'text-muted-foreground hover:text-primary'
                      }`}
                    >
                      {link.label}
                    </Link>
                  )}
                  {(link.children || link.groups) && (
                    <AnimatePresence>
                      {mobileDropdownOpen === link.label && (
                        <motion.div
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.2 }}
                          className="pl-4 space-y-1 overflow-hidden"
                        >
                          {link.groups
                            ? link.groups.map((group, gi) => (
                                <React.Fragment key={group.label}>
                                  {gi > 0 && <div className="my-1 h-px bg-border" />}
                                  <div className="py-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50">
                                    {group.label}
                                  </div>
                                  <div className="h-px bg-border mb-1" />
                                  {group.children.map((child) => (
                                    <Link
                                      key={child.label}
                                      to={child.href}
                                      onClick={() => { setMobileOpen(false); setMobileDropdownOpen(null); }}
                                      className={`flex items-center gap-2 py-2 text-xs uppercase tracking-widest transition-colors ${
                                        location.pathname === child.href ? 'text-primary' : 'text-muted-foreground/70 hover:text-primary'
                                      }`}
                                    >
                                      <child.icon className="w-3.5 h-3.5" />
                                      {child.label}
                                    </Link>
                                  ))}
                                </React.Fragment>
                              ))
                            : link.children.map((child) => (
                                <Link
                                  key={child.label}
                                  to={child.href}
                                  onClick={() => { setMobileOpen(false); setMobileDropdownOpen(null); }}
                                  className={`flex items-center gap-2 py-2 text-xs uppercase tracking-widest transition-colors ${
                                    location.pathname === child.href ? 'text-primary' : 'text-muted-foreground/70 hover:text-primary'
                                  }`}
                                >
                                  <child.icon className="w-3.5 h-3.5" />
                                  {child.label}
                                </Link>
                              ))}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  )}
                </React.Fragment>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {authOpen && <Suspense fallback={null}><AuthModal isOpen={authOpen} onClose={handleAuthClose} /></Suspense>}
    </nav>
  );
}
