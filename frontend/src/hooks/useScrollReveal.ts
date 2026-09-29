import { useEffect, useRef, useState } from 'react';

export default function useScrollReveal(threshold = 0.15) {
  const ref = useRef(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;

    const reveal = () => setIsVisible(true);

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          reveal();
          observer.unobserve(entry.target);
        }
      },
      { threshold },
    );

    observer.observe(node);

    // Si ya está en pantalla al cargar (p. ej. /contacto), mostrar sin esperar scroll
    requestAnimationFrame(() => {
      const rect = node.getBoundingClientRect();
      if (rect.top < window.innerHeight && rect.bottom > 0) {
        reveal();
        observer.unobserve(node);
      }
    });

    return () => observer.disconnect();
  }, [threshold]);

  return { ref, isVisible };
}
