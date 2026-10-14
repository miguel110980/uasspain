import { useState } from 'react';
import GoogleIcon from '@/components/GoogleIcon';
import { startGoogleAuthorization } from '@/lib/googleAuthorization';

export default function GoogleSignInButton({ disabled, onError }: { disabled?: boolean; onError: (message: string) => void }) {
  const [busy, setBusy] = useState(false);
  const start = async () => {
    setBusy(true);
    try { await startGoogleAuthorization('login'); }
    catch (error) { onError(error?.response?.data?.detail || error?.message || 'No se pudo iniciar Google. Puede acceder con correo y contraseña.'); setBusy(false); }
  };
  return <button type="button" disabled={disabled || busy} onClick={() => void start()} className="w-full inline-flex items-center justify-center gap-3 border border-border-strong px-4 py-3 text-sm text-foreground disabled:opacity-50">
    <GoogleIcon className="w-5 h-5" /> {busy ? 'Abriendo Google…' : 'Continuar con Google'}
  </button>;
}
