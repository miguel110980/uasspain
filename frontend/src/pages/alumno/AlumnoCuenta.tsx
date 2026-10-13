import { resolveMediaUrl } from '@/lib/mediaUrl';
import React, { useState, useEffect } from 'react';
import AccountDeactivation from '@/components/account/AccountDeactivation';
import { motion } from 'framer-motion';
import { Save, Loader2, CheckCircle, AlertCircle, Upload, UserCheck } from 'lucide-react';
import authService from '@/services/authService';
import examenesService from '@/services/examenesService';
import { extractErrorMessage } from '@/lib/errors';

import { sanitizeInput } from '@/lib/sanitize';
import PasswordStrengthBar from '@/components/auth/PasswordStrengthBar';
import { validatePasswordPolicy } from '@/lib/passwordStrength';

export default function AlumnoCuenta({ profile, onProfileUpdate }) {
  const [form, setForm] = useState({
    nombre: profile?.nombre || '',
    apellidos: profile?.apellidos || '',
    fecha_nacimiento: profile?.fecha_nacimiento || '',
    dni_nie: profile?.dni_nie || '',
    username: profile?.username || '',
    email: profile?.email || '',
    foto_perfil: profile?.foto_perfil || '',
  });
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState(false);

  useEffect(() => {
    if (!profile?.id) return;
    setForm({
      nombre: profile.nombre || '',
      apellidos: profile.apellidos || '',
      fecha_nacimiento: profile.fecha_nacimiento || '',
      dni_nie: profile.dni_nie || '',
      username: profile.username || '',
      email: profile.email || '',
      foto_perfil: profile.foto_perfil || '',
    });
  }, [profile?.id, profile?.nombre, profile?.apellidos, profile?.email, profile?.username, profile?.foto_perfil]);

  const handleChange = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: sanitizeInput(value, field === 'dni_nie' ? 'dni' : 'text') }));
    setSuccess(false);
    setError('');
  };

  const handlePhotoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const { display_url, file_url } = await examenesService.uploadAvatar(file);
      setForm((prev) => ({ ...prev, foto_perfil: file_url || display_url }));
    } catch {
      setError('Error al subir la foto. Inténtalo de nuevo.');
    } finally {
      setUploading(false);
    }
  };

  const validate = () => {
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
      onProfileUpdate({ ...profile, ...editable });
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

  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
      <div className="mb-8">
        <div className="inline-flex items-center gap-2 mb-3 px-3 py-1.5 border border-primary/20 bg-primary/5 text-primary text-xs font-mono uppercase tracking-widest">
          Cuenta
        </div>
        <h2 className="font-heading text-2xl font-bold text-foreground tracking-tight">Datos de la Cuenta</h2>
        <p className="text-sm text-muted-foreground mt-1">Actualiza tu información personal.</p>
      </div>

      <div className="glass-card p-8 space-y-6">
        {/* Foto */}
        <div className="flex items-center gap-6">
          <div className="relative shrink-0">
            {form.foto_perfil ? (
              <img src={resolveMediaUrl(form.foto_perfil)} alt="Foto perfil" className="w-20 h-20 rounded-full object-cover border-2 border-primary/30" />
            ) : (
              <div className="w-20 h-20 rounded-full bg-surface-muted border-2 border-border-subtle flex items-center justify-center text-2xl font-bold text-primary">
                {form.nombre?.[0]?.toUpperCase() || '?'}
              </div>
            )}
            {uploading && (
              <div className="absolute inset-0 rounded-full bg-black/60 flex items-center justify-center">
                <Loader2 className="w-5 h-5 text-primary animate-spin" />
              </div>
            )}
          </div>
          <div>
            <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-2">Fotografía de Perfil</p>
            <label className="cursor-pointer inline-flex items-center gap-2 px-4 py-2 border border-border-subtle text-muted-foreground hover:border-primary/30 hover:text-primary text-xs font-mono uppercase tracking-widest transition-all duration-200">
              <Upload className="w-3.5 h-3.5" />
              {uploading ? 'Subiendo...' : 'Cambiar foto'}
              <input type="file" accept="image/*" className="hidden" onChange={handlePhotoUpload} disabled={uploading} />
            </label>
          </div>
        </div>

        {/* Instructor asignado */}
        <div className="flex items-center gap-3 p-4 rounded-lg bg-surface-subtle border border-border-subtle">
          <UserCheck className="w-5 h-5 text-primary shrink-0" />
          <div>
            <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-0.5">Instructor asignado</p>
            <p className="text-sm text-foreground">
              {profile?.assigned_instructor_name || <span className="text-warning italic">Sin instructor asignado</span>}
            </p>
          </div>
        </div>

        {/* Datos personales */}
        <form onSubmit={handleSave} className="space-y-6">
          <div className="grid sm:grid-cols-2 gap-6">
            {[
              { label: 'Nombre', field: 'nombre', readOnly: true },
              { label: 'Apellidos', field: 'apellidos', readOnly: true },
              { label: 'DNI / NIE', field: 'dni_nie', readOnly: true },
              { label: 'Usuario', field: 'username' },
              { label: 'Correo electrónico', field: 'email', type: 'email', required: true },
            ].map(({ label, field, type = 'text', required, readOnly }) => (
              <div key={field} className="space-y-1.5">
                <label htmlFor={`alumnocuenta-${field}`} className="text-xs font-mono uppercase tracking-widest text-muted-foreground">
                  {label} {required && '*'}
                </label>
                <input id={`alumnocuenta-${field}`}
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
              <label htmlFor="alumnocuenta-field-2" className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Fecha de Nacimiento</label>
              <input id="alumnocuenta-field-2"
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

        {/* Cambiar contraseña */}
        <div className="pt-6 border-t border-border-subtle">
          <h3 className="font-heading text-lg font-bold text-foreground tracking-tight mb-1">Cambiar contraseña</h3>
          <p className="text-sm text-muted-foreground mb-4">Introduce tu nueva contraseña.</p>

          <form onSubmit={handleChangePassword} className="space-y-6">
            <div className="space-y-1.5">
              <label htmlFor="alumnocuenta-field-3" className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Contraseña actual</label>
              <input id="alumnocuenta-field-3"
                type="password"
                value={currentPassword}
                onChange={(e) => { setCurrentPassword(e.target.value); setPasswordError(''); setPasswordSuccess(false); }}
                className="w-full bg-surface-muted border border-border-subtle focus:border-transparent text-foreground placeholder:text-muted-foreground/40 px-4 py-2.5 text-sm outline-none transition-colors rounded-sm"
              />
            </div>
            <div className="grid sm:grid-cols-2 gap-6">
              <div className="space-y-1.5">
                <label htmlFor="alumnocuenta-field-4" className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Nueva contraseña</label>
                <input id="alumnocuenta-field-4"
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
                <label htmlFor="alumnocuenta-field-5" className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Repetir nueva contraseña</label>
                <input id="alumnocuenta-field-5"
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
      <AccountDeactivation />
    </motion.div>
  );
}
