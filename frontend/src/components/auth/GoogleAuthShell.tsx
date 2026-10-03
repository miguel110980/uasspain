import { GoogleOAuthProvider } from '@react-oauth/google';

export default function GoogleAuthShell({ clientId, onScriptLoadError, children }) {
  if (!clientId) {
    return children;
  }
  return <GoogleOAuthProvider clientId={clientId} locale="es" onScriptLoadError={onScriptLoadError}>{children}</GoogleOAuthProvider>;
}
