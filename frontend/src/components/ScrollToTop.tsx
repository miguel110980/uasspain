import { useEffect, useRef } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

const getHashId = (hash) => {
  const rawId = hash.slice(1);

  try {
    return decodeURIComponent(rawId);
  } catch {
    return rawId;
  }
};

export default function ScrollToTop() {
  const { pathname, hash } = useLocation();
  const navigationType = useNavigationType();
  const initialNavigation = useRef(true);

  useEffect(() => {
    const isInitialNavigation = initialNavigation.current;
    initialNavigation.current = false;
    // Preserve browser history restoration, but handle a fragment on initial load:
    // replacing prerendered markup can otherwise undo the browser's native scroll.
    if (navigationType === "POP" && (!isInitialNavigation || !hash)) return;

    if (hash) {
      const id = getHashId(hash);
      let observer: MutationObserver | undefined;
      const scrollToAnchor = () => {
        const target = document.getElementById(id);
        if (!target) return false;
        target.scrollIntoView({ behavior: isInitialNavigation ? "instant" : "smooth" });
        observer?.disconnect();
        return true;
      };
      const frame = window.requestAnimationFrame(() => {
        if (scrollToAnchor()) return;
        // A lazy route can render the anchor after its code finishes loading.
        observer = new MutationObserver(scrollToAnchor);
        observer.observe(document.body, { childList: true, subtree: true });
      });
      return () => {
        window.cancelAnimationFrame(frame);
        observer?.disconnect();
      };
    }

    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [pathname, hash, navigationType]);

  return null;
}
