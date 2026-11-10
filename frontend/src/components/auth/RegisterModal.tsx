import React, { useState, useRef } from 'react';
import { X, Eye, EyeOff, Upload, Loader2, ChevronLeft, Mail } from 'lucide-react';
import authService from '@/services/authService';
import { extractErrorMessage } from '@/lib/errors';
import OtpInput from '@/components/auth/OtpInput';
import AuthModalShell from '@/components/auth/AuthModalShell';
import PasswordStrengthBar from '@/components/auth/PasswordStrengthBar';
import { validateDniNie } from '@/lib/dni';
import { validatePasswordPolicy } from '@/lib/passwordStrength';
import { sanitizeInput, validateUploadFile, UPLOAD_IMAGE_EXT } from '@/lib/sanitize';
import { normalizeUploadResponse } from '@/lib/mediaUrl';
import apiClient from '@/api/apiClient';
import endpoints from '@/api/endpoints';

const EMPTY = {
  nombre: '', apellidos: '', fecha_nacimiento: '', dni_nie: '',
  username: '', email: '', password: '', confirm_password: '',
};

const validateEmail = (val) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val);

type RegisterModalProps = { onClose: () => void; onBack: () => void };
type FieldExtra = React.InputHTMLAttributes<HTMLInputElement> & {
  pr?: boolean;
  toggle?: () => void;
  shown?: boolean;
};

export default function RegisterModal({ onClose, onBack }: RegisterModalProps) {
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [showPass, setShowPass] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [showOtp, setShowOtp] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [otpError, setOtpError] = useState('');
  const fileRef = useRef<HTMLInputElement | null>(null);

  const validate = (name, value, allForm) => {
    const f = { ...allForm, [name]: value };
    let err = '';
    if (name === 'nombre' && !value.trim()) err = 'El nombre es obligatorio.';
    if (name === 'apellidos' && !value.trim()) err = 'Los apellidos son obligatorios.';
    if (name === 'fecha_nacimiento') {
      if (!value) err = 'La fecha de nacimiento es obligatoria.';
      else if (new Date(value) >= new Date(new Date().toISOString().split('T')[0])) err = 'La fecha debe ser anterior a hoy.';
    }
    if (name === 'dni_nie') {
      if (!value.trim()) err = 'El DNI/NIE es obligatorio.';
      else {
        const check = validateDniNie(value);
        if (!check.ok) err = check.error || 'DNI/NIE no válido.';
      }
    }
    if (name === 'username' && !value.trim()) err = 'El usuario es obligatorio.';
    if (name === 'email') {
      if (!value.trim()) err = 'El correo electrónico es obligatorio.';
      else if (!validateEmail(value)) err = 'Correo electrónico no válido.';
    }
    if (name === 'password') {
      if (!value) err = 'La contraseña es obligatoria.';
      else {
        err = validatePasswordPolicy(value, {
          username: f.username,
          email: f.email,
          dni: f.dni_nie,
        });
      }
    }
    if (name === 'confirm_password') {
      if (!value) err = 'Confirma la contraseña.';
      else if (value !== f.password) err = 'Las contraseñas no coinciden.';
    }
    return err;
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    const kind = name === 'email' ? 'email' : name === 'dni_nie' ? 'dni' : name === 'username' ? 'username' : name === 'password' || name === 'confirm_password' ? 'password' : 'text';
    const sanitized = sanitizeInput(value, kind);
    setForm((prev) => ({ ...prev, [name]: sanitized }));
    setErrors((prev) => ({ ...prev, [name]: validate(name, sanitized, form) }));
  };

  const handlePhoto = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const check = validateUploadFile(file, UPLOAD_IMAGE_EXT);
    if (!check.ok) {
      setErrors((prev) => ({ ...prev, photo: check.error }));
      return;
    }
    setPhoto(file);
    setErrors((prev) => ({ ...prev, photo: '' }));
    const reader = new FileReader();
    reader.onload = (ev) => {
      if (typeof ev.target?.result === 'string') setPhotoPreview(ev.target.result);
    };
    reader.readAsDataURL(file);
  };

  const handleClear = () => {
    setForm(EMPTY); setErrors({}); setPhoto(null); setPhotoPreview(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    // Re-validate all
    const newErrors: Record<string, string> = {};
    Object.keys(EMPTY).forEach((f) => {
      const err = validate(f, form[f], form);
      if (err) newErrors[f] = err;
    });

    if (Object.keys(newErrors).length > 0) { setErrors(newErrors); return; }

    setLoading(true);
    try {
      let foto_perfil = '';
      let avatar_upload_token = '';

      if (photo) {
        const fd = new FormData();
        fd.append('file', photo);
        const res = await apiClient.post(endpoints.uploadsRegisterAvatar, fd);
        const { absolute_url } = normalizeUploadResponse(res.data);
        if (!absolute_url || !res.data?.avatar_upload_token) throw new Error('No se pudo confirmar la fotografía. Reinténtelo o continúe sin foto.');
        foto_perfil = absolute_url;
        avatar_upload_token = res.data.avatar_upload_token;
      }

      await authService.register({
        email: form.email.trim().toLowerCase(),
        password: form.password,
        nombre: form.nombre.trim(),
        apellidos: form.apellidos.trim(),
        fecha_nacimiento: form.fecha_nacimiento,
        dni_nie: form.dni_nie.trim().toUpperCase(),
        username: form.username.trim(),
        foto_perfil,
        avatar_upload_token,
      });
      setShowOtp(true);
    } catch (err) {
      setErrors((prev) => ({
        ...prev,
        general: extractErrorMessage(err, 'Error al enviar el registro. Inténtelo de nuevo.'),
      }));
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    setOtpError('');
    setLoading(true);
    try {
      await authService.verifyOtp({ email: form.email.trim().toLowerCase(), code: otpCode });
      await authService.logout();
      setSuccess(true);
    } catch (err) {
      setOtpError(extractErrorMessage(err, 'Código de verificación incorrecto.'));
    } finally {
      setLoading(false);
    }
  };

  const handleResendOtp = async () => {
    setOtpError('');
    try {
      await authService.resendOtp({ email: form.email.trim().toLowerCase() });
    } catch (err) {
      setOtpError(extractErrorMessage(err, 'No se pudo reenviar el código.'));
    }
  };

  if (showOtp && !success) {
    return (
      <AuthModalShell closeOnBackdrop={false} panelClassName="text-center">
          <div className="w-14 h-14 border border-primary/30 bg-primary/10 flex items-center justify-center mx-auto mb-6">
            <Mail className="w-6 h-6 text-primary" />
          </div>
          <h2 className="font-heading text-xl font-bold text-foreground mb-2">Verifica tu correo</h2>
          <p className="text-sm text-muted-foreground leading-relaxed mb-6">
            Hemos enviado un código de verificación a <span className="text-foreground">{form.email}</span>.
            Tras verificarlo, un instructor revisará tu solicitud antes de activar el acceso.
          </p>

          <div className="flex justify-center mb-6">
            <OtpInput
              value={otpCode}
              onChange={(value) => setOtpCode(sanitizeInput(value, 'otp'))}
              length={6}
              autoFocus
            />
          </div>

          {otpError && (
            <p className="text-xs text-danger bg-danger-soft border border-danger-border px-3 py-2 rounded-sm mb-4">{otpError}</p>
          )}

          <button
            onClick={handleVerifyOtp}
            disabled={loading || otpCode.length < 6}
            className="w-full inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground px-8 py-3 font-bold uppercase tracking-tighter text-sm hover:bg-primary/80 transition-all duration-300 disabled:opacity-50 mb-4"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {loading ? 'Verificando...' : 'Verificar'}
          </button>

          <p className="text-xs text-muted-foreground">
            ¿No recibiste el código?{' '}
            <button onClick={handleResendOtp} className="text-primary hover:text-foreground transition-colors">
              Reenviar
            </button>
          </p>
      </AuthModalShell>
    );
  }

  if (success) {
    return (
      <AuthModalShell onClose={onClose} panelClassName="text-center">
          <div className="w-14 h-14 border border-primary/30 bg-primary/10 flex items-center justify-center mx-auto mb-6">
            <span className="text-2xl">✓</span>
          </div>
          <h2 className="font-heading text-xl font-bold text-foreground mb-4">Solicitud enviada correctamente</h2>
          <p className="text-sm text-muted-foreground leading-relaxed mb-2">
            Su solicitud de registro ha sido enviada correctamente.
          </p>
          <p className="text-sm text-muted-foreground leading-relaxed mb-6">
            Su cuenta permanecerá en estado{' '}
            <span className="text-primary font-semibold">Pendiente de validación</span> hasta que sea revisada y aprobada por el <span className="text-foreground font-semibold">Profesor</span>.
            Una vez aprobada, podrá iniciar sesión con su usuario y contraseña.
          </p>
          <button
            onClick={onClose}
            className="w-full bg-primary text-primary-foreground px-8 py-3 font-bold uppercase tracking-tighter text-sm hover:bg-primary/80 transition-all duration-300"
          >
            Aceptar
          </button>
      </AuthModalShell>
    );
  }

  const field = (name: keyof typeof EMPTY, label: string, type = 'text', extra: FieldExtra = {}) => {
    const { pr, toggle, shown, ...inputProps } = extra;
    return (
    <div className="space-y-1">
      <label htmlFor={`registermodal-${String(label).replace(/\s+/g, '-')}`} className="text-xs font-mono uppercase tracking-widest text-muted-foreground">{label} *</label>
      <div className="relative">
        <input id={`registermodal-${String(label).replace(/\s+/g, '-')}`}
          type={type}
          name={name}
          value={form[name]}
          onChange={handleChange}
          required
          aria-invalid={Boolean(errors[name])}
          aria-describedby={errors[name] ? `register-error-${name}` : undefined}
          className={`w-full bg-surface-muted border ${errors[name] ? 'border-danger/60' : 'border-border-subtle'} focus:border-transparent text-foreground placeholder:text-muted-foreground/40 px-4 py-2.5 text-sm outline-hidden transition-colors rounded-sm ${pr ? 'pr-10' : ''}`}
          {...inputProps}
        />
        {toggle && (
          <button type="button" aria-label={`${shown ? 'Ocultar' : 'Mostrar'} ${label.toLowerCase()}`} onClick={toggle} className="icon-control absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-brand-cyan-text transition-colors">
            {shown ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        )}
      </div>
      {errors[name] && <p id={`register-error-${name}`} className="text-xs text-danger">{errors[name]}</p>}
    </div>
    );
  };

  return (
    <AuthModalShell onClose={onClose} maxWidth="max-w-2xl">
        <button type="button" aria-label="Cerrar registro" onClick={onClose} className="absolute top-4 right-4 text-muted-foreground hover:text-brand-cyan-text transition-colors">
          <X className="w-5 h-5" />
        </button>

        <div className="mb-6">
          <button onClick={onBack} className="flex items-center gap-1 text-xs font-mono uppercase tracking-widest text-muted-foreground hover:text-brand-cyan-text transition-colors mb-4">
            <ChevronLeft className="w-3.5 h-3.5" /> Volver al acceso
          </button>
          <div className="inline-flex items-center gap-2 mb-3 px-3 py-1.5 border border-primary/20 bg-primary/5 text-primary text-xs font-mono uppercase tracking-widest">
            UASSPAIN
          </div>
          <h2 className="font-heading text-2xl font-bold text-foreground tracking-tight">Registro de nuevo usuario</h2>
          <p className="text-xs text-muted-foreground mt-1">Todos los campos son obligatorios</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            {field('nombre', 'Nombre', 'text', { placeholder: 'Tu nombre' })}
            {field('apellidos', 'Apellidos', 'text', { placeholder: 'Tus apellidos' })}
            {field('fecha_nacimiento', 'Fecha de nacimiento', 'date', { max: new Date().toISOString().split('T')[0] })}
            {field('dni_nie', 'DNI / NIE', 'text', { placeholder: '12345678A', maxLength: 9 })}
            {field('username', 'Usuario', 'text', { placeholder: 'nombre_usuario' })}
            {field('email', 'Correo electrónico', 'email', { placeholder: 'tu@email.com' })}
            <div className="space-y-1">
              {field('password', 'Contraseña', showPass ? 'text' : 'password', {
                placeholder: '••••••••', pr: true,
                toggle: () => setShowPass(!showPass), shown: showPass,
              })}
              <PasswordStrengthBar
                password={form.password}
                username={form.username}
                email={form.email}
                dni={form.dni_nie}
              />
            </div>
            {field('confirm_password', 'Confirmar contraseña', showConfirm ? 'text' : 'password', {
              placeholder: '••••••••', pr: true,
              toggle: () => setShowConfirm(!showConfirm), shown: showConfirm,
            })}
          </div>

          {/* Photo */}
          <div className="space-y-2">
            <label htmlFor="registermodal-field-2" className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Fotografía de perfil <span className="text-muted-foreground/50 normal-case">(opcional)</span></label>
            <div
              className={`border ${errors.photo ? 'border-danger/60' : 'border-border-subtle'} bg-surface-muted p-4 flex flex-col items-center gap-3 cursor-pointer hover:border-primary/40 transition-colors rounded-sm`}
              onClick={() => fileRef.current?.click()}
              role="button"
              tabIndex={0}
              aria-label="Subir fotografía de perfil"
              onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); fileRef.current?.click(); } }}
            >
              {photoPreview ? (
                <img src={photoPreview} alt="Preview" className="w-20 h-20 rounded-full object-cover border-2 border-primary/30" />
              ) : (
                <div className="w-20 h-20 rounded-full bg-surface-muted flex items-center justify-center border border-border-subtle">
                  <Upload className="w-6 h-6 text-muted-foreground" />
                </div>
              )}
              <span className="text-xs text-muted-foreground">
                {photo ? photo.name : 'Haz clic para subir JPG, JPEG o PNG · Si no se sube, se usará un avatar por defecto'}
              </span>
              <input id="registermodal-field-2"
                ref={fileRef}
                type="file"
                accept=".jpg,.jpeg,.png"
                className="hidden"
                onChange={handlePhoto}
              />
            </div>
            {photo && <button type="button" disabled={loading} onClick={() => { setPhoto(null); setPhotoPreview(null); if (fileRef.current) fileRef.current.value=''; }} className="text-xs text-primary underline">Continuar sin foto</button>}
            {errors.photo && <p className="text-xs text-danger">{errors.photo}</p>}
          </div>

          {errors.general && (
            <p className="text-xs text-danger bg-danger-soft border border-danger-border px-3 py-2 rounded-sm">{errors.general}</p>
          )}

          <div className="grid sm:grid-cols-2 gap-4 pt-2">
            <button
              type="button"
              onClick={handleClear}
              className="w-full px-8 py-3 border border-border-subtle text-muted-foreground text-sm font-bold uppercase tracking-tighter hover:border-primary/30 hover:text-brand-cyan-text transition-all duration-300"
            >
              Limpiar
            </button>
            <button
              type="submit"
              disabled={loading}
              className="w-full inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground px-8 py-3 font-bold uppercase tracking-tighter text-sm hover:bg-primary/80 transition-all duration-300 disabled:opacity-50"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {loading ? 'Enviando...' : 'Registrar'}
            </button>
          </div>
        </form>
    </AuthModalShell>
  );
}
