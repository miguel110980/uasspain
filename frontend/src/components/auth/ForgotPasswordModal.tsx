import React, { useState } from 'react';
import { X, Loader2, ChevronLeft } from 'lucide-react';
import authService from '@/services/authService';
import { extractErrorMessage } from '@/lib/errors';
import { sanitizeInput } from '@/lib/sanitize';
import AuthModalShell from '@/components/auth/AuthModalShell';

export default function ForgotPasswordModal({ onClose, onBack }) {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [isError, setIsError] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage('');
    setIsError(false);
    const cleanEmail = sanitizeInput(email, 'email');
    if (!cleanEmail) {
      setMessage('Introduce un correo electrónico válido.');
      setIsError(true);
      setLoading(false);
      return;
    }
    try {
      const data = await authService.resetPasswordRequest(cleanEmail);
      setMessage(
        data?.detail || 'Hemos enviado un enlace para restablecer su contraseña. Revise su correo electrónico.',
      );
      setIsError(false);
    } catch (err) {
      setMessage(extractErrorMessage(
        err,
        'No se pudo procesar la solicitud. Compruebe el email e inténtelo de nuevo.',
      ));
      setIsError(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthModalShell onClose={onClose}>
        <button type="button" onClick={onClose} className="absolute top-4 right-4 text-muted-foreground hover:text-primary transition-colors">
          <X className="w-5 h-5" />
        </button>

        <div className="mb-7">
          <button type="button" onClick={onBack} className="flex items-center gap-1 text-xs font-mono uppercase tracking-widest text-muted-foreground hover:text-primary transition-colors mb-4">
            <ChevronLeft className="w-3.5 h-3.5" /> Volver al acceso
          </button>
          <div className="inline-flex items-center gap-2 mb-3 px-3 py-1.5 border border-primary/20 bg-primary/5 text-primary text-xs font-mono uppercase tracking-widest">
            UASSPAIN
          </div>
          <h2 className="font-heading text-2xl font-bold text-foreground tracking-tight">Recuperar contraseña</h2>
          <p className="text-sm text-muted-foreground mt-1">Introduce tu correo para obtener un enlace de recuperación.</p>
        </div>

        {message ? (
          <div className={`px-4 py-4 border text-sm rounded-sm mb-6 ${isError ? 'border-danger-border bg-danger-soft text-danger' : 'border-primary/30 bg-primary/5 text-primary'}`}>
            <p>{message}</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-1.5">
              <label className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Correo electrónico *</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(sanitizeInput(e.target.value, 'email'))}
                placeholder="tu@email.com"
                className="w-full bg-surface-muted border border-border-subtle focus:border-transparent text-foreground placeholder:text-muted-foreground/40 px-4 py-2.5 text-sm outline-none transition-colors rounded-sm"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <button
                type="button"
                onClick={onBack}
                className="w-full px-4 py-3 border border-border-subtle text-muted-foreground text-sm font-bold uppercase tracking-tighter hover:border-primary/30 hover:text-primary transition-all duration-300"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={loading}
                className="w-full inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground px-4 py-3 font-bold uppercase tracking-tighter text-sm hover:bg-primary/80 transition-all duration-300 disabled:opacity-50"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {loading ? 'Enviando...' : 'Obtener enlace'}
              </button>
            </div>
          </form>
        )}

        {message && (
          <button
            type="button"
            onClick={onClose}
            className="w-full bg-primary text-primary-foreground px-8 py-3 font-bold uppercase tracking-tighter text-sm hover:bg-primary/80 transition-all duration-300"
          >
            Cerrar
          </button>
        )}
    </AuthModalShell>
  );
}
