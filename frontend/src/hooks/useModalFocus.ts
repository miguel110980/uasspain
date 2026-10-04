import { useEffect, useRef, type RefObject } from 'react';

const panels: HTMLElement[] = [];
const selector = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex="0"]';

/** Only the top dialog owns focus; restore the trigger when it closes. */
export default function useModalFocus(panel: RefObject<HTMLElement | null>, onClose: () => void) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const element = panel.current;
    if (!element) return;
    const previous = document.activeElement;
    panels.push(element);
    const items = () => Array.from(element.querySelectorAll<HTMLElement>(selector))
      .filter(item => item.tabIndex >= 0 && item.getClientRects().length > 0 && !item.closest('[inert]'));
    (items()[0] || element).focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (panels.at(-1) !== element || !element.getClientRects().length) return;
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation(); close.current();
      } else if (event.key === 'Tab') {
        const controls = items(); const first = controls[0] || element; const last = controls.at(-1) || element;
        if (event.shiftKey && (document.activeElement === first || !element.contains(document.activeElement))) {
          event.preventDefault(); last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !element.contains(document.activeElement))) {
          event.preventDefault(); first.focus();
        }
      }
    };
    const onFocus = (event: FocusEvent) => {
      if (panels.at(-1) === element && element.getClientRects().length && !element.contains(event.target as Node)) (items()[0] || element).focus({ preventScroll: true });
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('focusin', onFocus);
    return () => {
      const ownedFocus = element.contains(document.activeElement) || document.activeElement === document.body;
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('focusin', onFocus);
      const index = panels.indexOf(element);
      if (index >= 0) panels.splice(index, 1);
      if (ownedFocus && previous instanceof HTMLElement && previous.isConnected && previous.getClientRects().length) previous.focus({ preventScroll: true });
    };
  }, [panel]);
}
