import { motion } from 'framer-motion';
import ModalPortal from '@/components/ui/ModalPortal';

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
  return (
    <ModalPortal>
      <div className="fixed inset-0 z-[100] flex items-center justify-center px-4 py-6">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="fixed inset-0 bg-black/70 backdrop-blur-sm"
          onClick={closeOnBackdrop ? onClose : undefined}
        />
        <motion.div
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
