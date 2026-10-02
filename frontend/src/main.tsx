import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App'
import '@/index.css'

// Keep the prerendered home visible while its code loads instead of replacing
// its heading with a fullscreen loader on the first paint.
async function mount() {
  if (window.location.pathname === '/') await import('@/pages/Home');
  ReactDOM.createRoot(document.getElementById('root')).render(<App />);
}
void mount();
