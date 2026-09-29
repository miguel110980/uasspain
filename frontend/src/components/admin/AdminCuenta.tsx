import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Save, Loader2, CheckCircle, AlertCircle, UserCog } from 'lucide-react';
import authService from '@/services/authService';
import { extractErrorMessage } from '@/lib/errors';
import { sanitizeInput } from '@/lib/sanitize';
import PasswordStrengthBar from '@/components/auth/PasswordStrengthBar';
import { validatePasswordPolicy } from '@/lib/passwordStrength';

export default function AdminCuenta({ profile: sessionProfile = null, onProfileUpdate }) {
  const [profile, setProfile] = useState(sessionProfile);
  const [loading, setLoading] = useState(!sessionProfile?.id);
  const [form, setForm] = useState({
    nombre: '', apellidos: '', fecha_nacimiento: '', dni_nie: '', username: '', email: '',
  });
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState(false);

  useEffect(() => {
    if (!sessionProfile?.id) return;
    setProfile(sessionProfile);
    setForm({
      nombre: sessionProfile.nombre || '',
      apellidos: sessionProfile.apellidos || '',
      fecha_nacimiento: sessionProfile.fecha_nacimiento || '',
      dni_nie: sessionProfile.dni_nie || '',
      username: sessionProfile.username || '',
      email: sessionProfile.email || '',
    });
    setLoading(false);
  }, [sessionProfile?.id]);

  useEffect(() => {
    if (sessionProfile?.id) return;
    loadProfile();
  }, [sessionProfile?.id]);

  const loadProfile = async () => {
    setLoading(true);
    try {
      const { profile: p } = await authService.getSessionProfile();
      setProfile(p);
      if (p) {
        setForm({
          nombre: p.nombre || '',
          apellidos: p.apellidos || '',
          fecha_nacimiento: p.fecha_nacimiento || '',
          dni_nie: p.dni_nie || '',
          username: p.username || '',
          email: p.email || '',
        });
      }
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: sanitizeInput(value, field === 'dni_nie' ? 'dni' : 'text') }));
    setSuccess(false);
    setError('');
  };

  const validate = () => {
    if (!form.username.trim()) return 'El usuario es obligatorio.';
    if (!form.email.trim()) return 'El correo es obligatorio.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) return 'Correo inválido.';
    return null;
  };

  const handleSave = async (e) => {
    e.preventDefault();
    const validationError = validate();
    if (validationError) { setError(validationError); return; }
    setSaving(true);
    setError('');
    try {
      const { nombre: _nombre, apellidos: _apellidos, dni_nie: _dni, ...editable } = form;
      await authService.updateProfile(profile.id, editable);
      const updated = { ...profile, ...editable };
      setProfile(updated);
      onProfileUpdate?.(updated);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch {
      setError('Error al guardar los cambios.');
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    setPasswordError('');
    setPasswordSuccess(false);
    if (!currentPassword) { setPasswordError('Introduce tu contraseña actual.'); return; }
    if (!newPassword) { setPasswordError('Introduce la nueva contraseña.'); return; }
    if (!confirmPassword) { setPasswordError('Confirma la nueva contraseña.'); return; }
    if (newPassword !== confirmPassword) { setPasswordError('Las contraseñas no coinciden.'); return; }
    const policyError = validatePasswordPolicy(newPassword, {
      username: form.username,
      email: form.email,
      dni: form.dni_nie,
    });
    if (policyError) { setPasswordError(policyError); return; }
    setSavingPassword(true);
    try {
      const me = await authService.me();
      await authService.changePassword({
        userId: me.user_id ?? me.id,
        currentPassword,
        newPassword,
      });
      setPasswordSuccess(true);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setTimeout(() => setPasswordSuccess(false), 3000);
    } catch (err) {
      setPasswordError(extractErrorMessage(err, 'No se pudo actualizar la contraseña. Inténtelo nuevamente.'));
    } finally {
      setSavingPassword(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="text-center py-20 glass-card">
        <p className="text-muted-foreground text-sm">No se ha encontrado tu perfil de administrador.</p>
      </div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="max-w-5xl">
      <div className="mb-8">
        <div className="inline-flex items-center gap-2 mb-3 px-3 py-1.5 border border-primary/20 bg-primary/5 text-primary text-xs font-mono uppercase tracking-widest">
          <UserCog className="w-3.5 h-3.5" /> Cuenta
        </div>
        <h2 className="font-heading text-2xl font-bold text-foreground tracking-tight">Mi Cuenta</h2>
        <p className="text-sm text-muted-foreground mt-1">Actualiza tu información personal y contraseña.</p>
      </div>

      <div className="glass-card p-8">
        <div className="grid lg:grid-cols-2 gap-8">
          <form onSubmit={handleSave} className="space-y-6">
            <div className="grid sm:grid-cols-2 gap-6">
              {[
                { label: 'Nombre', field: 'nombre', readOnly: true },
                { label: 'Apellidos', field: 'apellidos', readOnly: true },
                { label: 'DNI / NIE', field: 'dni_nie', readOnly: true },
                { label: 'Usuario', field: 'username', required: true },
                { label: 'Correo electrónico', field: 'email', type: 'email', required: true },
              ].map(({ label, field, type = 'text', required, readOnly }) => (
                <div key={field} className="space-y-1.5">
                  <label className="text-xs font-mono uppercase tracking-widest text-muted-foreground">
                    {label} {required && '*'}
                  </label>
                  <input
                    type={type}
                    value={form[field]}
                    onChange={(e) => !readOnly && handleChange(field, e.target.value)}
                    required={required}
                    readOnly={readOnly}
                    disabled={readOnly}
                    className={`w-full border px-4 py-2.5 text-sm outline-none transition-colors rounded-sm ${
                      readOnly
                        ? 'bg-surface-subtle border-border-subtle text-muted-foreground cursor-not-allowed'
                        : 'bg-surface-muted border-border-subtle focus:border-transparent text-foreground placeholder:text-muted-foreground/40'
                    }`}
                  />
                </div>
              ))}
              <div className="space-y-1.5">
                <label className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Fecha de Nacimiento</label>
                <input
                  type="date"
                  value={form.fecha_nacimiento}
                  max={new Date().toISOString().split('T')[0]}
                  onChange={(e) => handleChange('fecha_nacimiento', e.target.value)}
                  className="w-full bg-surface-muted border border-border-subtle focus:border-transparent text-foreground px-4 py-2.5 text-sm outline-none transition-colors rounded-sm"
                />
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-2 text-xs text-danger bg-danger-soft border border-danger-border px-3 py-2 rounded-sm">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" /> {error}
              </div>
            )}
            {success && (
              <div className="flex items-center gap-2 text-xs text-primary bg-primary/10 border border-primary/20 px-3 py-2 rounded-sm">
                <CheckCircle className="w-3.5 h-3.5 shrink-0" /> Cambios guardados correctamente.
              </div>
            )}

            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-8 py-3 font-bold uppercase tracking-tighter text-sm hover:bg-primary/80 transition-all duration-300 disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {saving ? 'Guardando...' : 'Guardar cambios'}
            </button>
          </form>

          <div className="lg:border-l lg:border-border-subtle lg:pl-8">
            <h3 className="font-heading text-lg font-bold text-foreground tracking-tight mb-1">Cambiar contraseña</h3>
            <p className="text-sm text-muted-foreground mb-4">Introduce tu nueva contraseña.</p>

            <form onSubmit={handleChangePassword} className="space-y-6">
              <div className="space-y-1.5">
                <label className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Contraseña actual</label>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => { setCurrentPassword(e.target.value); setPasswordError(''); setPasswordSuccess(false); }}
                  className="w-full bg-surface-muted border border-border-subtle focus:border-transparent text-foreground placeholder:text-muted-foreground/40 px-4 py-2.5 text-sm outline-none transition-colors rounded-sm"
                />
              </div>
              <div className="grid sm:grid-cols-2 gap-6">
                <div className="space-y-1.5">
                  <label className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Nueva contraseña</label>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => { setNewPassword(e.target.value); setPasswordError(''); setPasswordSuccess(false); }}
                    className="w-full bg-surface-muted border border-border-subtle focus:border-transparent text-foreground placeholder:text-muted-foreground/40 px-4 py-2.5 text-sm outline-none transition-colors rounded-sm"
                  />
                  <PasswordStrengthBar
                    password={newPassword}
                    username={form.username}
                    email={form.email}
                    dni={form.dni_nie}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Repetir nueva contraseña</label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => { setConfirmPassword(e.target.value); setPasswordError(''); setPasswordSuccess(false); }}
                    className="w-full bg-surface-muted border border-border-subtle focus:border-transparent text-foreground placeholder:text-muted-foreground/40 px-4 py-2.5 text-sm outline-none transition-colors rounded-sm"
                  />
                </div>
              </div>

              {passwordError && (
                <div className="flex items-center gap-2 text-xs text-danger bg-danger-soft border border-danger-border px-3 py-2 rounded-sm">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" /> {passwordError}
                </div>
              )}
              {passwordSuccess && (
                <div className="flex items-center gap-2 text-xs text-primary bg-primary/10 border border-primary/20 px-3 py-2 rounded-sm">
                  <CheckCircle className="w-3.5 h-3.5 shrink-0" /> Contraseña actualizada correctamente.
                </div>
              )}

              <button
                type="submit"
                disabled={savingPassword}
                className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-8 py-3 font-bold uppercase tracking-tighter text-sm hover:bg-primary/80 transition-all duration-300 disabled:opacity-50"
              >
                {savingPassword ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                {savingPassword ? 'Guardando...' : 'Cambiar contraseña'}
              </button>
            </form>
          </div>
        </div>
      </div>
    </motion.div>
  );
}