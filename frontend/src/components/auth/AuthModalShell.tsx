import { motion } from 'framer-motion';
import ModalPortal from '@/components/ui/ModalPortal';
import { useRef } from 'react';
import useModalFocus from '@/hooks/useModalFocus';
import ThemeControl from '@/components/ui/ThemeControl';

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
  useModalFocus(panel, onClose);

  return (
    <ModalPortal>
      <div className="fixed inset-0 w-screen z-[100] flex items-center justify-center px-4 py-6">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="fixed inset-0 bg-black/50 dark:bg-black/70"
          onClick={closeOnBackdrop ? onClose : undefined}
        />
        <motion.div
          ref={panel}
          role="dialog"
          tabIndex={-1}
          aria-modal="true"
          aria-label="Cuenta UASSPAIN"
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
          style={{ backgroundColor: 'hsl(var(--surface))' }}
          className={`relative w-full min-w-0 ${maxWidth} max-h-[min(90vh,calc(100dvh-3rem))] overflow-y-auto glass-card p-5 sm:p-8 z-10 ${panelClassName}`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-4 flex justify-start pr-10"><ThemeControl /></div>
          {children}
        </motion.div>
      </div>
    </ModalPortal>
  );
}
