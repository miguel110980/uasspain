import { motion } from 'framer-motion';
import ModalPortal from '@/components/ui/ModalPortal';
import { useEffect, useRef } from 'react';

/**
 * Overlay de modal de auth: portal a body + centrado fijo en viewport.
 */
export default function AuthModalShell({
  onClose = () => {},
  children,
  maxWidth = 'max-w-md',
  panelClassName = '',
  closeOnBackdrop = true,
}) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    panel.current?.querySelector<HTMLElement>('input, button, a[href]')?.focus();
    const onKey = (event) => {
      if (event.key !== 'Tab') return;
      const items = Array.from(panel.current?.querySelectorAll<HTMLElement>('input:not([disabled]), button:not([disabled]), a[href], select, textarea, [tabindex="0"]') || [])
        .filter((item) => item.getClientRects().length);
      if (!items.length) return;
      if (event.shiftKey && (document.activeElement === items[0] || !panel.current?.contains(document.activeElement))) {
        event.preventDefault(); items[items.length - 1].focus();
      } else if (!event.shiftKey && (document.activeElement === items[items.length - 1] || !panel.current?.contains(document.activeElement))) {
        event.preventDefault(); items[0].focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  return (
    <ModalPortal>
      <div className="fixed inset-0 z-[100] flex items-center justify-center px-4 py-6">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="fixed inset-0 bg-black/50 dark:bg-black/70"
          onClick={closeOnBackdrop ? onClose : undefined}
        />
        <motion.div
          ref={panel}
          role="dialog"
          aria-modal="true"
          aria-label="Cuenta UASSPAIN"
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
          className={`relative w-full ${maxWidth} max-h-[min(90vh,calc(100dvh-3rem))] overflow-y-auto glass-card p-8 z-10 ${panelClassName}`}
          onClick={(e) => e.stopPropagation()}
        >
          {children}
        </motion.div>
      </div>
    </ModalPortal>
  );
}
