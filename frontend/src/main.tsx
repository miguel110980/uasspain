import '@/index.css'
import { installAssetRecovery, recoverAssetLoad } from '@/lib/assetRecovery'

installAssetRecovery();
let cancelEarlyClicks = () => {};

// Keep the prerendered home visible while its code loads instead of replacing
// its heading with a fullscreen loader on the first paint.
async function mount() {
  if (window.location.pathname === '/auth/google/callback') {
    (await import('@/lib/googleCallbackHandoff')).prepareGoogleCallback();
  }
  const root = document.getElementById('root');
  // Record styles already delivered inline so Vite's lazy loader does not
  // append and apply a second copy. Set disabled before href/append to avoid
  // speculative parser downloads of these duplicate stylesheets.
  for (const style of document.querySelectorAll<HTMLStyleElement>('style[data-stylesheet]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.disabled = true;
    link.href = style.dataset.stylesheet;
    document.head.appendChild(link);
  }
  // Progressive hydration: the complete public HTML paints before React occupies
  // the main thread. A bounded fallback also starts hidden tabs and browsers that
  // do not expose paint entries. This is applied to every prerendered Home visit.
  if (root.dataset.prerendered === 'home') {
    // Preserve a fast first click while the interactive code is loading.
    // Links already work natively; buttons replay once React has committed.
    let queuedButton: HTMLButtonElement;
    let wakeHydration = () => {};
    const captureClick = (event: MouseEvent) => {
      const button = (event.target as Element)?.closest('button');
      if (!button || !root.contains(button)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      queuedButton = button;
      wakeHydration();
    };
    const ready = () => {
      cancelEarlyClicks();
      if (queuedButton?.isConnected) queuedButton.click();
    };
    cancelEarlyClicks = () => {
      root.removeEventListener('click', captureClick, true);
      window.removeEventListener('uasspain:ready', ready);
    };
    root.addEventListener('click', captureClick, true);
    window.addEventListener('uasspain:ready', ready, { once: true });
    await new Promise<void>(resolve => {
      if (performance.getEntriesByType('paint').some(entry => entry.name === 'first-contentful-paint')) return resolve();
      let observer: PerformanceObserver;
      const done = () => { clearTimeout(timeout); observer?.disconnect(); resolve(); };
      wakeHydration = done;
      const timeout = setTimeout(done, 1000);
      try {
        observer = new PerformanceObserver(list => {
          if (list.getEntries().some(entry => entry.name === 'first-contentful-paint')) done();
        });
        observer.observe({ type: 'paint', buffered: true });
      } catch { done(); }
    });
  }
  const [{ default: React }, ReactDOM, { default: App }] = await Promise.all([
    import('react'), import('react-dom/client'), import('@/App'),
  ]);
  const initialHome = window.location.pathname === '/' ? (await import('@/pages/Home')).default : undefined;
  if (root.dataset.prerendered === 'home') ReactDOM.hydrateRoot(root, <App initialHome={initialHome} />, {
    onRecoverableError(error, info) { console.error('[UASSPAIN] Hydration:', error, info.componentStack); },
  });
  else ReactDOM.createRoot(root).render(<App initialHome={initialHome} />);
}
void mount().catch(async error => {
  cancelEarlyClicks();
  if (await recoverAssetLoad(error)) return;
  console.error('[UASSPAIN] Error de arranque:', error);
  const [{ default: React }, ReactDOM, { default: AppErrorBoundary }] = await Promise.all([
    import('react'), import('react-dom/client'), import('@/components/AppErrorBoundary'),
  ]);
  ReactDOM.createRoot(document.getElementById('root')).render(<AppErrorBoundary initialError={error} />);
});
