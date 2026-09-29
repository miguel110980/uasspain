import React, { useState, useEffect } from 'react';
import { X, Eye, EyeOff, Loader2 } from 'lucide-react';
import authService from '@/services/authService';
import { extractErrorMessage } from '@/lib/errors';
import { sanitizeInput } from '@/lib/sanitize';
import GoogleIcon from '@/components/GoogleIcon';
import AuthModalShell from '@/components/auth/AuthModalShell';
import RegisterModal from './RegisterModal';
import ForgotPasswordModal from './ForgotPasswordModal';
import { Checkbox } from '@/components/ui/checkbox';
import { loadRememberedLogin, saveRememberedLogin, clearRememberedLogin } from '@/lib/rememberLogin';
import { useGoogleClientId } from '@/lib/googleOAuth';
import GoogleAuthShell from '@/components/auth/GoogleAuthShell';
import GoogleSignInButton from '@/components/auth/GoogleSignInButton';

export default function AuthModal({ isOpen, onClose }) {
  const googleClientId = useGoogleClientId();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [requiresOtp, setRequiresOtp] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [view, setView] = useState('login'); // login | register | forgot
  const [availableRoles, setAvailableRoles] = useState([]);
  const [selectedRole, setSelectedRole] = useState('');

  const reset = () => {
    setEmail('');
    setPassword('');
    setError('');
    setLoading(false);
    setOtpCode('');
    setRequiresOtp(false);
    setShowPassword(false);
    setRemember(false);
    setView('login');
    setAvailableRoles([]);
    setSelectedRole('');
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') handleClose();
    };
    if (isOpen) document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const saved = loadRememberedLogin();
    if (saved) {
      setEmail(saved.email);
      setRemember(true);
    }
    const notice = authService.consumeAuthNotice();
    if (notice) {
      setError(notice);
      setRequiresOtp(false);
      setOtpCode('');
    }
  }, [isOpen]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    const cleanEmail = sanitizeInput(email, 'email');
    const cleanPassword = sanitizeInput(password, 'password');
    const cleanOtp = sanitizeInput(otpCode, 'otp');
    try {
      saveRememberedLogin({
        email: cleanEmail,
        remember,
      });
      const result = await authService.loginAndRedirect(
        cleanEmail,
        cleanPassword,
        requiresOtp ? cleanOtp : undefined,
        selectedRole || undefined,
      );
      if (result?.otpRequired) {
        setRequiresOtp(true);
        if (result.roles && result.roles.length > 1) {
          setAvailableRoles(result.roles);
          if (!selectedRole) setSelectedRole(result.roles[0]);
        }
        setError('');
        return;
      }
    } catch (err) {
      const code = err && typeof err === 'object' && 'code' in err ? String(err.code) : '';
      if (code && authService.getBlockedMessage(code)) {
        setError(err.message);
        authService.logout();
      } else {
        const msg = extractErrorMessage(err, 'Credenciales incorrectas. Compruebe su email y contraseña.');
        setError(msg);
        if (remember && /contraseña incorrecta/i.test(msg)) {
          clearRememberedLogin();
          setRemember(false);
        }
      }
    } finally {
      setLoading(false);
    }
  };

  const handleResendLoginOtp = async () => {
    setLoading(true);
    setError('');
    try {
      const cleanEmail = sanitizeInput(email, 'email');
      const cleanPassword = sanitizeInput(password, 'password');
      const result = await authService.login(cleanEmail, cleanPassword);
      if (result?.otpRequired) {
        setRequiresOtp(true);
      }
    } catch (err) {
      setError(extractErrorMessage(err, 'No se pudo reenviar el código 2FA.'));
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSuccess = async (credentialResponse) => {
    setError('');
    setLoading(true);
    try {
      const credential = credentialResponse?.credential;
      if (!credential) {
        throw new Error('Google no devolvió credenciales.');
      }
      await authService.loginWithGoogleCredential(credential);
      await authService.redirectAfterLogin();
    } catch (err) {
      const code = err?.response?.data?.code;
      let message = extractErrorMessage(err, 'No se pudo completar el acceso con Google.');
      if (code === 'not_configured') {
        message = 'Define GOOGLE_CLIENT_ID en el .env raíz (ver docs/DEPLOYMENT.md).';
      } else if (code === 'no_account') {
        message =
          'No hay cuenta UASSPAIN con ese email de Google. Regístrate primero o usa email y contraseña.';
      }
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleError = () => {
    setError('Acceso con Google cancelado o no disponible en este navegador.');
  };

  if (!isOpen) return null;

  if (view === 'register') {
    return <RegisterModal onClose={handleClose} onBack={() => setView('login')} />;
  }
  if (view === 'forgot') {
    return <ForgotPasswordModal onClose={handleClose} onBack={() => setView('login')} />;
  }

  const modalBody = (
    <AuthModalShell onClose={handleClose}>
      <button
        onClick={handleClose}
        type="button"
        className="absolute top-4 right-4 text-muted-foreground hover:text-primary transition-colors"
      >
        <X className="w-5 h-5" />
      </button>

      <div className="mb-8">
        <div className="inline-flex items-center gap-2 mb-4 px-3 py-1.5 border border-primary/20 bg-primary/5 text-primary text-xs font-mono uppercase tracking-widest">
          UASSPAIN
        </div>
        <h2 className="font-heading text-2xl font-bold text-foreground tracking-tight">
          Acceso de Usuarios
        </h2>
        <p className="text-sm text-muted-foreground mt-1">Inicia sesión en tu cuenta</p>
      </div>

      <form onSubmit={handleLogin} className="space-y-5">
        <div className="space-y-1.5">
          <label className="text-xs font-mono uppercase tracking-widest text-muted-foreground">
            Correo electrónico *
          </label>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(sanitizeInput(e.target.value, 'email'))}
            placeholder="tu@email.com"
            className="w-full bg-surface-muted border border-border-subtle focus:border-transparent text-foreground placeholder:text-muted-foreground/40 px-4 py-2.5 text-sm outline-none transition-colors rounded-sm"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-mono uppercase tracking-widest text-muted-foreground">
            Contraseña *
          </label>
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(sanitizeInput(e.target.value, 'password'))}
              placeholder="••••••••"
              className="w-full bg-surface-muted border border-border-subtle focus:border-transparent text-foreground placeholder:text-muted-foreground/40 px-4 py-2.5 pr-10 text-sm outline-none transition-colors rounded-sm"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-primary transition-colors"
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {requiresOtp && (
          <div className="space-y-1.5">
            <label className="text-xs font-mono uppercase tracking-widest text-muted-foreground">
              Código 2FA *
            </label>
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              required
              value={otpCode}
              onChange={(e) => setOtpCode(sanitizeInput(e.target.value, 'otp'))}
              placeholder="123456"
              className="w-full bg-surface-muted border border-border-subtle focus:border-transparent text-foreground placeholder:text-muted-foreground/40 px-4 py-2.5 text-sm outline-none transition-colors rounded-sm"
            />
            <div className="flex items-center justify-between gap-3">
              <p className="text-[11px] text-muted-foreground">Hemos enviado un código temporal a tu email.</p>
              <button
                type="button"
                onClick={handleResendLoginOtp}
                className="text-[11px] uppercase tracking-widest text-primary hover:text-foreground transition-colors"
              >
                Reenviar código
              </button>
            </div>
          </div>
        )}

        <div className="flex items-center gap-2">
          <Checkbox
            id="remember"
            checked={remember}
            onCheckedChange={(checked) => setRemember(checked === true)}
          />
          <label htmlFor="remember" className="text-xs text-muted-foreground cursor-pointer select-none">
            Recordar contraseña
          </label>
        </div>

        {error && (
          <p className="text-xs text-danger bg-danger-soft border border-danger-border px-3 py-2 rounded-sm">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground px-8 py-3 font-bold uppercase tracking-tighter text-sm hover:bg-primary/80 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          {loading ? 'Validando acceso...' : (requiresOtp ? 'Verificar y entrar' : 'Iniciar sesión')}
        </button>

        {availableRoles.length > 1 && !requiresOtp && (
          <div className="space-y-2">
            <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Entrar como</p>
            <div className="grid grid-cols-2 gap-2">
              {availableRoles.map((role) => (
                <button
                  key={role}
                  type="button"
                  onClick={() => setSelectedRole(role)}
                  className={`px-3 py-2 text-xs font-bold uppercase tracking-widest border rounded transition-all ${
                    selectedRole === role
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border-subtle text-muted-foreground hover:border-primary/40 hover:text-primary'
                  }`}
                >
                  {role === 'admin' ? 'Administrador' : role === 'instructor' ? 'Instructor' : role}
                </button>
              ))}
            </div>
          </div>
        )}

        {googleClientId && (
          <>
            <div className="relative pt-2">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-border-subtle" />
              </div>
              <div className="relative flex justify-center">
                <span className="bg-card px-3 text-xs text-muted-foreground uppercase tracking-widest">o</span>
              </div>
            </div>

            <GoogleSignInButton
              disabled={loading}
              onSuccess={handleGoogleSuccess}
              onError={handleGoogleError}
            >
              <GoogleIcon className="w-5 h-5" />
              Continuar con Google
            </GoogleSignInButton>
          </>
        )}

        <div className="flex flex-col items-center gap-2 pt-2">
          <button
            type="button"
            onClick={() => setView('register')}
            className="text-xs text-primary hover:text-foreground transition-colors font-mono uppercase tracking-widest"
          >
            Registrarse
          </button>
          <button
            type="button"
            onClick={() => setView('forgot')}
            className="text-xs text-muted-foreground hover:text-primary transition-colors"
          >
            ¿Ha olvidado su contraseña?
          </button>
        </div>
      </form>
    </AuthModalShell>
  );

  return <GoogleAuthShell clientId={googleClientId}>{modalBody}</GoogleAuthShell>;
}
