import React, { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import ThemeControl from '@/components/ui/ThemeControl';
import { useQuery } from '@tanstack/react-query';
import {
  Menu, X, ChevronDown, Shield, Siren, GraduationCap, Plane,
  RadioTower, LogOut, UserRound,
} from 'lucide-react';
const AuthModal = lazy(() => import('@/components/auth/AuthModal'));
import Logo from '@/components/layout/Logo';
import styles from './Navbar.module.css';
import contentService from '@/services/contentService';
import { SERVICE_ICONS } from '@/lib/serviceIcons';
import { COURSE_CATEGORIES, coursePath } from '@/lib/courseCategories';
import authService from '@/services/authService';
import useSession from '@/hooks/useSession';
import { panelRouteForUser } from '@/lib/roles';

const navLinks = [
  { label: 'Inicio', href: '/' },
  {
    label: 'Servicios',
    href: '/servicios',
    children: [],
  },
  { label: 'Formación', groups: [] },
  { label: 'Tecnología', href: '/tecnologia' },
  { label: 'Quiénes Somos', href: '/nosotros' },
  { label: 'Blog', href: '/blog' },
  { label: 'Contacto', href: '/contacto' },
];

const COURSE_ICONS = { GraduationCap, Plane, RadioTower, Shield, Siren };
const MenuIcon = ({ icon: Icon }) => <span className={styles.menuIcon} aria-hidden="true"><Icon /></span>;
const UpcomingCourseItem = ({ item, className }) => (
  <div data-course-status="upcoming" aria-disabled="true" className={`${className} cursor-default`}>
    <MenuIcon icon={item.icon} />
    <span className="min-w-0"><span className="block">{item.label}</span><span className="block text-[10px] text-warning">Próximamente</span></span>
  </div>
);
const SCROLL_MAX = 160;

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

export default function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(null);
  const [mobileDropdownOpen, setMobileDropdownOpen] = useState(null);
  const [authOpen, setAuthOpen] = useState(false);
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
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: 30_000,
  });
  const { data: managedServices = [] } = useQuery({ queryKey: ['public', 'services'], queryFn: contentService.publicServices, staleTime: 0 });
  const effectiveNavLinks = navLinks.map((link) => link.label === 'Servicios' ? { ...link, children: managedServices.map(service => ({ label: service.title, href: '/servicios/' + service.slug, icon: SERVICE_ICONS[service.icon] || Shield })) } : link.label !== 'Formación' ? link : {
    ...link,
    groups: [
      { label: 'Catálogo', children: [{ label: 'Todos los cursos', href: '/formacion', icon: GraduationCap }] },
      ...COURSE_CATEGORIES.map(category => ({
        label: category.menuLabel,
        children: managedCourses
          .filter(course => course.category === category.value)
          .map(course => ({
            label: course.name, href: coursePath(course),
            icon: COURSE_ICONS[course.menu_icon] || GraduationCap,
            upcoming: course.status !== 'published',
          })),
      })),
    ],
  });

  useEffect(() => {
    const onScroll = () => {
      if (rafRef.current) return;
      rafRef.current = requestAnimationFrame(() => {
        const y = window.scrollY;
        const raw = Math.max(0, Math.min(y / SCROLL_MAX, 1));
        const p = easeOutCubic(raw);
        const nav = navRef.current;
        if (!nav) { rafRef.current = null; return; }

        const alpha = p * 0.96;
        const blur = p * 16;

        // Theme tokens change the colors immediately; scroll controls the same
        // opacity, blur and shadow in both themes without restarting this effect.
        nav.style.backgroundColor = `hsl(var(--background) / ${alpha})`;
        nav.style.backdropFilter = p > 0 ? `blur(${blur}px)` : 'none';
        nav.style.webkitBackdropFilter = nav.style.backdropFilter;

        rafRef.current = null;
      });
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, []);

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
    // Initialize route state before replaying a click captured during hydration.
    // Otherwise the route effect immediately closes the menu just opened.
    window.dispatchEvent(new Event('uasspain:ready'));
  }, []);

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

  const panelRoute = session ? panelRouteForUser(session) : '/';

  const handleLogout = useCallback(async () => {
    closeMobileMenu(false);
    await authService.logout('/');
  }, [closeMobileMenu]);

  const linkClass = (active) =>
    `${styles.navLink} text-[15px] font-semibold uppercase transition-colors duration-300 ${
      active ? 'text-primary' : 'text-muted-foreground hover:text-brand-cyan-text'
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
            isChildActive(link.children, link.groups) ? 'text-primary' : 'text-muted-foreground hover:text-brand-cyan-text'
          }`}
          aria-expanded={dropdownOpen === link.label}
          aria-controls={`desktop-menu-${link.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
        >
          {link.label}
          <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${dropdownOpen === link.label ? 'rotate-180' : ''}`} />
        </button>
        <>
          {dropdownOpen === link.label && (
            <div
              id={`desktop-menu-${link.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
              className={`${styles.desktopMenu} absolute top-full left-1/2 -translate-x-1/2 mt-3 ${link.label === 'Formación' ? 'w-64 max-w-[calc(100vw-2rem)]' : 'w-56'} rounded-lg shadow-2xl border border-border bg-popover z-50`}
            >
              <div className="p-2">
                {groups
                  ? groups.map((group, gi) => (
                      <React.Fragment key={group.label}>
                        {gi > 0 && <div className="my-1 border-t border-border" />}
                        <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50 cursor-default">
                          {group.label}
                        </div>
                        {group.children.map((item) => item.upcoming ? (
                          <UpcomingCourseItem key={item.href} item={item} className="flex items-center gap-3 px-3 py-2.5 text-sm text-muted-foreground rounded-md" />
                        ) : (
                          <Link
                            key={item.href}
                            to={item.href}
                            onClick={() => setDropdownOpen(null)}
                            className="flex items-center gap-3 px-3 py-2.5 text-sm text-muted-foreground hover:text-brand-cyan-text hover:bg-primary/5 rounded-md transition-all duration-200"
                          >
                            <MenuIcon icon={item.icon} />
                            {item.label}
                          </Link>
                        ))}
                      </React.Fragment>
                    ))
                  : items.map((item) => (
                      <Link
                        key={item.href}
                        to={item.href}
                        onClick={() => setDropdownOpen(null)}
                        className="flex items-center gap-3 px-3 py-2.5 text-sm text-muted-foreground hover:text-brand-cyan-text hover:bg-primary/5 rounded-md transition-all duration-200"
                      >
                        <MenuIcon icon={item.icon} />
                        {item.label}
                      </Link>
                    ))}
              </div>
            </div>
          )}
        </>
      </div>
    );
  };

  return (
    <nav
      ref={navRef}
      aria-label="Navegación principal"
      className="fixed top-0 left-0 w-full z-50 transition-[background-color,backdrop-filter] duration-300"
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
          <ThemeControl />
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
      <>
        {mobileOpen && (
          <div
            ref={mobileMenuRef}
            id="main-mobile-menu"
            role="dialog"
            aria-label="Menú de navegación"
            className={styles.mobileMenu}
            style={{
              backgroundColor: 'hsl(var(--background))',
            }}
          >
            <div className="px-6 py-5 space-y-1">
              {effectiveNavLinks.map((link) => (
                <React.Fragment key={link.label}>
                  {link.children || link.groups ? (
                    <button
                      onClick={() => setMobileDropdownOpen(mobileDropdownOpen === link.label ? null : link.label)}
                      className={`w-full flex items-center justify-between py-3 text-sm font-medium uppercase tracking-widest transition-colors ${
                        isChildActive(link.children, link.groups) ? 'text-primary' : 'text-muted-foreground hover:text-brand-cyan-text'
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
                        location.pathname === link.href ? 'text-primary' : 'text-muted-foreground hover:text-brand-cyan-text'
                      }`}
                    >
                      {link.label}
                    </Link>
                  )}
                  {(link.children || link.groups) && (
                    <>
                      {mobileDropdownOpen === link.label && (
                        <div
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
                                  {group.children.map((child) => child.upcoming ? (
                                    <UpcomingCourseItem key={child.href} item={child} className="flex items-center gap-2 py-2 text-xs uppercase tracking-widest text-muted-foreground/70" />
                                  ) : (
                                    <Link
                                      key={child.href}
                                      to={child.href}
                                      onClick={() => { setMobileOpen(false); setMobileDropdownOpen(null); }}
                                      className={`flex items-center gap-2 py-2 text-xs uppercase tracking-widest transition-colors ${
                                        location.pathname === child.href ? 'text-primary' : 'text-muted-foreground/70 hover:text-brand-cyan-text'
                                      }`}
                                    >
                                      <MenuIcon icon={child.icon} />
                                      {child.label}
                                    </Link>
                                  ))}
                                </React.Fragment>
                              ))
                            : link.children.map((child) => (
                                <Link
                                  key={child.href}
                                  to={child.href}
                                  onClick={() => { setMobileOpen(false); setMobileDropdownOpen(null); }}
                                  className={`flex items-center gap-2 py-2 text-xs uppercase tracking-widest transition-colors ${
                                    location.pathname === child.href ? 'text-primary' : 'text-muted-foreground/70 hover:text-brand-cyan-text'
                                  }`}
                                >
                                  <MenuIcon icon={child.icon} />
                                  {child.label}
                                </Link>
                              ))}
                        </div>
                      )}
                    </>
                  )}
                </React.Fragment>
              ))}
            </div>
          </div>
        )}
      </>

      {authOpen && <Suspense fallback={null}><AuthModal isOpen={authOpen} onClose={handleAuthClose} /></Suspense>}
    </nav>
  );
}
