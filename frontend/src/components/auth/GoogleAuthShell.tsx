import { GoogleOAuthProvider } from '@react-oauth/google';

export default function GoogleAuthShell({ clientId, children }) {
  if (!clientId) {
    return children;
  }
  return <GoogleOAuthProvider clientId={clientId}>{children}</GoogleOAuthProvider>;
}
