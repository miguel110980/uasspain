import { useRef, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import ModalPortal from '@/components/ui/ModalPortal';
import useModalFocus from '@/hooks/useModalFocus';

type Props = {
  children: ReactNode;
  label: string;
  onClose: () => void;
  className?: string;
};

/** Keep panel forms inside the real viewport, including short screens and nested dialogs. */
export default function PanelModal({ children, label, onClose, className = 'max-w-lg glass-card p-6' }: Props) {
  const panel = useRef<HTMLDivElement>(null);
  useModalFocus(panel, onClose);

  return (
    <ModalPortal>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 dark:bg-black/70"
        style={{ padding: 'max(1rem, env(safe-area-inset-top)) max(1rem, env(safe-area-inset-right)) max(1rem, env(safe-area-inset-bottom)) max(1rem, env(safe-area-inset-left))' }}
        onClick={onClose}
      >
        <motion.div
          ref={panel} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }}
          className={`relative w-full min-w-0 min-h-0 overflow-y-auto overscroll-contain break-words ${className}`}
          style={{ backgroundColor: 'hsl(var(--surface))', maxHeight: 'calc(100dvh - max(1rem, env(safe-area-inset-top)) - max(1rem, env(safe-area-inset-bottom)))' }}
          onClick={event => event.stopPropagation()}
        >
          {children}
        </motion.div>
      </motion.div>
    </ModalPortal>
  );
}
