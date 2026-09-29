import { GoogleLogin } from '@react-oauth/google';

/**
 * Botón visual propio con capa transparente del widget oficial de Google (id_token).
 *
 * @param {{
 *   disabled?: boolean,
 *   onSuccess: (credentialResponse: import('@react-oauth/google').CredentialResponse) => void,
 *   onError?: () => void,
 *   children: import('react').ReactNode,
 * }} props
 */
export default function GoogleSignInButton({
  disabled,
  onSuccess,
  onError,
  children,
}) {
  return (
    <div className="relative w-full">
      <div
        className="w-full inline-flex items-center justify-center gap-3 border border-border-strong bg-surface-muted text-foreground px-8 py-3 font-bold uppercase tracking-tighter text-sm pointer-events-none select-none"
        aria-hidden
      >
        {children}
      </div>
      {!disabled && (
        <div
          className="absolute inset-0 z-10 cursor-pointer overflow-hidden opacity-[0.015] [&>div]:flex [&>div]:h-full [&>div]:w-full [&>div]:items-stretch [&>div]:justify-stretch [&_iframe]:!min-w-full [&_iframe]:!w-full [&_iframe]:!h-full"
          title="Continuar con Google"
        >
          <GoogleLogin
            onSuccess={onSuccess}
            onError={onError}
            useOneTap={false}
            width="400"
            text="continue_with"
            shape="rectangular"
            theme="outline"
          />
        </div>
      )}
    </div>
  );
}
