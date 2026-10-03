import { useEffect } from 'react';
import { createPortal } from 'react-dom';

let scrollLocks = 0;
let previousOverflow = '';

/**
 * Renderiza modales en document.body para que position:fixed
 * sea relativo al viewport (no a ancestros con transform/filter).
 */
export default function ModalPortal({ children, lockScroll = true }) {
  useEffect(() => {
    if (!lockScroll) return undefined;
    if (scrollLocks === 0) previousOverflow = document.body.style.overflow;
    scrollLocks += 1;
    document.body.style.overflow = 'hidden';
    return () => {
      scrollLocks -= 1;
      if (scrollLocks === 0) document.body.style.overflow = previousOverflow;
    };
  }, [lockScroll]);

  return createPortal(children, document.body);
}
