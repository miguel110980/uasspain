import { useEffect, useId, useRef, useState } from 'react';
import authService from '@/services/authService';
import { extractErrorMessage } from '@/lib/errors';
import SuccessNotice from '@/components/ui/SuccessNotice';

type AuthPolicy = { enabled: boolean; required_roles: string[] };

export default function AuthPolicyForm({ onChange, refresh }: { onChange?: (policy: AuthPolicy) => void; refresh?: number }) {
  const id = useId();
  const [policy, setPolicy] = useState<AuthPolicy | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [retry, setRetry] = useState(0);
  const saving = useRef(false), mounted = useRef(false), callback = useRef(onChange), revision = useRef(0);
  callback.current = onChange;
  useEffect(() => {
    let active = true;
    const request = ++revision.current;
    mounted.current = true; setLoading(true); setError('');
    authService.getSystemAuthPolicy().then(data => {
      if (!active || request !== revision.current) return;
      setPolicy(data); callback.current?.(data);
    }).catch(err => { if (active) { setPolicy(null); setError(extractErrorMessage(err, 'No se pudo cargar la política 2FA/OTP.')); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; mounted.current = false; };
  }, [retry, refresh]);

  const update = async (patch: Partial<AuthPolicy>) => {
    if (!policy || loading || saving.current) return;
    saving.current = true; revision.current++; setBusy(true); setError(''); setSuccess(false);
    try {
      const saved = await authService.updateSystemAuthPolicy({ ...policy, ...patch });
      if (mounted.current) { setPolicy(saved); callback.current?.(saved); setSuccess(true); }
    } catch (err) {
      if (mounted.current) setError(extractErrorMessage(err, 'No se pudo guardar la política 2FA/OTP.'));
    } finally { saving.current = false; if (mounted.current) setBusy(false); }
  };

  return <section aria-label="Administración 2FA/OTP" className="mt-4 min-w-0 space-y-3" aria-busy={loading || busy}>
    <h3 className="text-sm font-semibold text-foreground">Autenticación de doble factor (2FA/OTP)</h3>
    {loading && <p role="status" className="text-sm text-muted-foreground">Cargando política 2FA/OTP…</p>}
    {error && <p role="alert" className="text-sm text-danger break-words">{error}</p>}
    {!loading && !policy && <button type="button" className="text-sm text-primary underline" onClick={() => setRetry(n => n + 1)}>Reintentar carga de 2FA/OTP</button>}
    {success && <SuccessNotice message="Política 2FA/OTP guardada correctamente." onDismiss={() => setSuccess(false)} />}
    <fieldset disabled={loading || busy || !policy} className="grid min-w-0 gap-4 md:grid-cols-2 disabled:opacity-60">
      <legend className="sr-only">Política 2FA por roles</legend>
      <label htmlFor={`${id}-enabled`} className="flex items-center justify-between gap-3 rounded border border-border-subtle bg-surface-subtle px-4 py-3">
        <span><span className="block text-sm text-foreground">Activar 2FA</span><span className="block text-xs text-muted-foreground">Habilita el segundo factor en login por contraseña.</span></span>
        <input id={`${id}-enabled`} type="checkbox" checked={policy?.enabled ?? false} onChange={event => void update({ enabled: event.target.checked })} />
      </label>
      <div className="space-y-2 rounded border border-border-subtle bg-surface-subtle px-4 py-3">
        <p className="text-sm text-foreground">Obligatorio por rol</p>
        {['admin', 'instructor', 'alumno'].map(role => <label key={role} htmlFor={`${id}-${role}`} className="flex items-center gap-2 text-xs text-muted-foreground">
          <input id={`${id}-${role}`} type="checkbox" checked={policy?.required_roles.includes(role) ?? false}
            onChange={event => void update({ required_roles: event.target.checked ? [...policy!.required_roles, role] : policy!.required_roles.filter(item => item !== role) })} />
          <span>{role}</span>
        </label>)}
      </div>
    </fieldset>
    {busy && <p role="status" className="text-sm text-muted-foreground">Guardando política 2FA/OTP…</p>}
  </section>;
}
