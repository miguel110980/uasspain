import { createContext, useContext } from 'react';
import usePanelAuth from '@/hooks/usePanelAuth';

/** @type {import('react').Context<ReturnType<typeof usePanelAuth> | null>} */
const PanelAuthContext = createContext(null);

export function usePanelAuthContext() {
  const ctx = useContext(PanelAuthContext);
  if (!ctx) {
    throw new Error('usePanelAuthContext debe usarse dentro de ProtectedRoute');
  }
  return ctx;
}

export default PanelAuthContext;
