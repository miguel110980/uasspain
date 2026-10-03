import React, { useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Loader2, Lock, AlertCircle, CheckCircle2 } from 'lucide-react';
import authService from '@/services/authService';
import { decodeTokenFromTransport } from '@/lib/urls';
import { sanitizeInput } from '@/lib/sanitize';
import { validatePasswordPolicy } from '@/lib/passwordStrength';
import PasswordStrengthBar from '@/components/auth/PasswordStrengthBar';

export default function RestablecerContrasena() {
  const [params] = useSearchParams();
  const uid = decodeTokenFromTransport(params.get('uid') || '');
  const token = decodeTokenFromTransport(params.get('token') || '');

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const submission = useRef(false);

  const invalidLink = !uid || !token;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submission.current) return;
    setError('');
    const cleanPassword = sanitizeInput(password, 'password');
    const cleanConfirm = sanitizeInput(confirm, 'password');

    const policyError = validatePasswordPolicy(cleanPassword);
    if (policyError) {
      setError(policyError);
      return;
    }
    if (cleanPassword !== cleanConfirm) {
      setError('Las contraseñas no coinciden.');
      return;
    }
    setLoading(true);
    submission.current = true;
    try {
      await authService.resetPassword({ uid, token, password: cleanPassword });
      setDone(true);
    } catch (err) {
      setError(err.response?.data?.detail || err.message || 'No se pudo restablecer la contraseña.');
    } finally {
      setLoading(false);
      submission.current = false;
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 py-12">
      <div className="glass-card w-full max-w-md p-8">
        <div className="inline-flex items-center gap-2 mb-4 px-3 py-1.5 border border-primary/20 bg-primary/5 text-primary text-xs font-mono uppercase tracking-widest">
          UASSPAIN
        </div>
        <h1 className="font-heading text-2xl font-bold text-foreground tracking-tight flex items-center gap-2">
          <Lock className="w-5 h-5 text-primary" />
          Nueva contraseña
        </h1>
        <p className="text-sm text-muted-foreground mt-2 mb-6">
          Elige una contraseña segura para tu cuenta.
        </p>

        {invalidLink ? (
          <div className="p-4 border border-danger-border bg-danger-soft text-danger text-sm flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            Enlace inválido o incompleto. Solicita uno nuevo desde la pantalla de acceso.
          </div>
        ) : done ? (
          <div className="space-y-4">
            <div className="p-4 border border-primary/30 bg-primary/5 text-primary text-sm flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              Contraseña actualizada. Ya puedes iniciar sesión.
            </div>
            <Link
              to="/"
              className="block w-full text-center bg-primary text-primary-foreground px-6 py-3 font-bold uppercase tracking-tighter text-sm hover:bg-primary/80 transition-all"
            >
              Ir al inicio
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div id="reset-error" role="alert" className="p-3 border border-danger-border bg-danger-soft text-danger text-sm">
                {error}
              </div>
            )}
            <div className="space-y-1.5">
              <label htmlFor="reset-password" className="text-xs font-mono uppercase tracking-widest text-muted-foreground">
                Nueva contraseña
              </label>
              <input
                id="reset-password"
                autoComplete="new-password"
                aria-invalid={Boolean(error)}
                aria-describedby={error ? 'reset-error' : undefined}
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(sanitizeInput(e.target.value, 'password'))}
                className="w-full bg-surface-muted border border-border-subtle focus:border-transparent text-foreground px-4 py-2.5 text-sm outline-none rounded-sm"
              />
              <PasswordStrengthBar password={password} />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="reset-confirm" className="text-xs font-mono uppercase tracking-widest text-muted-foreground">
                Confirmar contraseña
              </label>
              <input
                id="reset-confirm"
                autoComplete="new-password"
                aria-invalid={Boolean(error)}
                aria-describedby={error ? 'reset-error' : undefined}
                type="password"
                required
                minLength={8}
                value={confirm}
                onChange={(e) => setConfirm(sanitizeInput(e.target.value, 'password'))}
                className="w-full bg-surface-muted border border-border-subtle focus:border-transparent text-foreground px-4 py-2.5 text-sm outline-none rounded-sm"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground px-6 py-3 font-bold uppercase tracking-tighter text-sm hover:bg-primary/80 transition-all disabled:opacity-50"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {loading ? 'Guardando...' : 'Guardar contraseña'}
            </button>
          </form>
        )}

        {!done && (
          <p className="text-xs text-muted-foreground text-center mt-6">
            <Link to="/" className="text-primary hover:underline">
              Volver al inicio
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}
