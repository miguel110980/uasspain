import { useEffect, useRef, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import ModalPortal from '@/components/ui/ModalPortal';

const openPanels: HTMLDivElement[] = [];
const focusable = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex="0"]';

type Props = {
  children: ReactNode;
  label: string;
  onClose: () => void;
  className?: string;
};

/** Keep panel forms inside the real viewport, including short screens and nested dialogs. */
export default function PanelModal({ children, label, onClose, className = 'max-w-lg glass-card p-6' }: Props) {
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const element = panel.current;
    if (!element) return undefined;
    const previous = document.activeElement;
    openPanels.push(element);
    const items = () => Array.from(element.querySelectorAll<HTMLElement>(focusable))
      .filter(item => item.getClientRects().length > 0);
    (items()[0] || element).focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (openPanels.at(-1) !== element) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close.current();
      } else if (event.key === 'Tab') {
        const controls = items();
        const first = controls[0] || element;
        const last = controls.at(-1) || element;
        if (event.shiftKey && (document.activeElement === first || !element.contains(document.activeElement))) {
          event.preventDefault(); last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !element.contains(document.activeElement))) {
          event.preventDefault(); first.focus();
        }
      }
    };
    const onFocus = (event: FocusEvent) => {
      if (openPanels.at(-1) === element && !element.contains(event.target as Node)) {
        (items()[0] || element).focus({ preventScroll: true });
      }
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('focusin', onFocus);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('focusin', onFocus);
      openPanels.splice(openPanels.indexOf(element), 1);
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);

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
          style={{ maxHeight: 'calc(100dvh - max(1rem, env(safe-area-inset-top)) - max(1rem, env(safe-area-inset-bottom)))' }}
          onClick={event => event.stopPropagation()}
        >
          {children}
        </motion.div>
      </motion.div>
    </ModalPortal>
  );
}
