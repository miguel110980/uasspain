import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App'
import '@/index.css'
import AppErrorBoundary from '@/components/AppErrorBoundary'
import { installAssetRecovery, recoverAssetLoad } from '@/lib/assetRecovery'

installAssetRecovery();

// Keep the prerendered home visible while its code loads instead of replacing
// its heading with a fullscreen loader on the first paint.
async function mount() {
  if (window.location.pathname === '/') await import('@/pages/Home');
  ReactDOM.createRoot(document.getElementById('root')).render(<App />);
}
void mount().catch(async error => {
  if (await recoverAssetLoad(error)) return;
  console.error('[UASSPAIN] Error de arranque:', error);
  ReactDOM.createRoot(document.getElementById('root')).render(<AppErrorBoundary initialError={error} />);
});
