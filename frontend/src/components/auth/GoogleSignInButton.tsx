import { GoogleLogin, useGoogleOAuth, type CredentialResponse } from '@react-oauth/google';
import { useEffect, useRef, useState } from 'react';
import apiClient from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';

type Props = {
  disabled?: boolean;
  onSuccess: (response: CredentialResponse) => void;
  onError: () => void;
};

export default function GoogleSignInButton({ disabled, onSuccess, onError }: Props) {
  const { scriptLoadedSuccessfully } = useGoogleOAuth();
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(280);
  const [nonce, setNonce] = useState('');
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(([entry]) => {
      setWidth(Math.max(200, Math.min(400, Math.floor(entry.contentRect.width))));
    });
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (disabled) return;
    let active = true;
    setNonce('');
    setFailed(false);
    apiClient.post(endpoints.auth.googleChallenge, {}).then(({ data }) => {
      if (typeof data?.nonce !== 'string' || !data.nonce) throw new Error('Missing nonce');
      if (active) setNonce(data.nonce);
    }).catch(() => { if (active) setFailed(true); });
    // Renovar antes de que caduque la cookie de cinco minutos.
    const timer = window.setTimeout(() => { if (active) setAttempt(value => value + 1); }, 240_000);
    return () => { active = false; window.clearTimeout(timer); };
  }, [disabled, attempt]);

  return (
    <div ref={container} className="w-full min-h-11 flex flex-col items-center gap-2" aria-busy={disabled || (!nonce && !failed)}>
      {failed ? (
        <>
          <p role="status" className="text-xs text-muted-foreground">No se pudo preparar el acceso con Google.</p>
          <button type="button" disabled={disabled} onClick={() => setAttempt(value => value + 1)} className="text-sm text-primary underline">Reintentar Google</button>
        </>
      ) : disabled || !nonce || !scriptLoadedSuccessfully ? (
        <p role="status" className="text-sm text-muted-foreground">{disabled ? 'Validando acceso...' : 'Preparando Google...'}</p>
      ) : (
        <GoogleLogin key={nonce} nonce={nonce} onSuccess={onSuccess} onError={() => { onError(); setAttempt(value => value + 1); }}
          useOneTap={false} width={width} text="continue_with" shape="rectangular" theme="outline" size="large" />
      )}
    </div>
  );
}
