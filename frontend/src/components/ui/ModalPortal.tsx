import { useEffect } from 'react';
import { createPortal } from 'react-dom';

/**
 * Renderiza modales en document.body para que position:fixed
 * sea relativo al viewport (no a ancestros con transform/filter).
 */
export default function ModalPortal({ children, lockScroll = true }) {
  useEffect(() => {
    if (!lockScroll) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [lockScroll]);

  return createPortal(children, document.body);
}
