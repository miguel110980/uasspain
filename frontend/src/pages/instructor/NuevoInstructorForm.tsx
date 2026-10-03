import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Loader2, UserPlus, CheckCircle, X } from 'lucide-react';
import authService from '@/services/authService';
import { extractErrorMessage } from '@/lib/errors';
import { validateDniNie } from '@/lib/dni';
import { validatePasswordPolicy } from '@/lib/passwordStrength';
import PasswordStrengthBar from '@/components/auth/PasswordStrengthBar';
import { sanitizeInput } from '@/lib/sanitize';

const emptyForm = () => ({
  nombre: '',
  apellidos: '',
  fecha_nacimiento: '',
  dni_nie: '',
  username: '',
  email: '',
  password: '',
});

const validateEmail = (val) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val);

/** @param {{ onCreated?: () => void }} props */
export default function NuevoInstructorForm({ onCreated }: { onCreated?: () => void } = {}) {
  const [form, setForm] = useState(emptyForm);
  const [esAdmin, setEsAdmin] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [createdEmail, setCreatedEmail] = useState('');

  const validate = (name, value, allForm = form) => {
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
          username: allForm.username,
          email: allForm.email,
          dni: allForm.dni_nie,
        });
      }
    }
    return err;
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    const kind = name === 'email' ? 'email' : name === 'dni_nie' ? 'dni' : name === 'username' ? 'username' : name === 'password' ? 'password' : 'text';
    const sanitized = sanitizeInput(value, kind);
    const newForm = { ...form, [name]: sanitized };
    setForm(newForm);
    setErrors((prev) => ({ ...prev, [name]: validate(name, sanitized, newForm) }));
    setSuccess(false);
  };

  const resetForm = () => {
    setForm(emptyForm());
    setErrors({});
    setSuccess(false);
    setCreatedEmail('');
    setEsAdmin(false);
  };

  const handleClear = () => resetForm();

  const handleSubmit = async (e) => {
    e.preventDefault();
    const newErrors = /** @type {Record<string, string>} */ ({});
    Object.keys(emptyForm()).forEach((f) => {
      const err = validate(f, form[f], form);
      if (err) newErrors[f] = err;
    });
    if (Object.keys(newErrors).length > 0) { setErrors(newErrors); return; }

    setLoading(true);
    const email = form.email.trim().toLowerCase();
    try {
      await authService.crearInstructor({
        nombre: form.nombre.trim(),
        apellidos: form.apellidos.trim(),
        fecha_nacimiento: form.fecha_nacimiento,
        dni_nie: form.dni_nie.trim().toUpperCase(),
        username: form.username.trim(),
        email,
        password: form.password,
        es_admin: esAdmin,
      });

      setCreatedEmail(email);
      setSuccess(true);
      resetForm();
      onCreated?.();
    } catch (err) {
      setErrors((prev) => ({
        ...prev,
        general: extractErrorMessage(err, 'Error al crear el instructor.'),
      }));
    } finally {
      setLoading(false);
    }
  };

  const field = (name, label, type = 'text', extra = {}) => (
    <div className="space-y-1">
      <label htmlFor={`new-instructor-${name}`} className="text-xs font-mono uppercase tracking-widest text-muted-foreground">{label} *</label>
      <input
        type={type}
        id={`new-instructor-${name}`}
        name={name}
        value={form[name] ?? ''}
        onChange={handleChange}
        required
        autoComplete="off"
        className={`w-full bg-surface-muted border ${errors[name] ? 'border-danger/60' : 'border-border-subtle'} focus:border-transparent text-foreground placeholder:text-muted-foreground/40 px-4 py-2.5 text-sm outline-none transition-colors rounded-sm`}
        {...extra}
      />
      {errors[name] && <p className="text-xs text-danger">{errors[name]}</p>}
    </div>
  );

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass-card p-8 max-w-2xl">
      <h3 className="font-heading text-lg font-bold text-foreground mb-1 flex items-center gap-2">
        <UserPlus className="w-5 h-5 text-primary" />
        Añadir nuevo instructor
      </h3>
      <p className="text-xs text-muted-foreground mb-6">
        Crea la cuenta del instructor. Podrá iniciar sesión con su <strong>email y contraseña</strong>.
        Si también es administrador, podrá elegir entre <strong>/admin</strong> e <strong>/instructor</strong> al iniciar sesión.
      </p>

      {success && (
        <div className="flex items-start gap-2 text-xs text-primary bg-primary/10 border border-primary/20 px-3 py-3 rounded-sm mb-4">
          <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span className="flex-1">
            Instructor creado correctamente. Puede entrar con el email <strong>{createdEmail}</strong> y la contraseña indicada.
          </span>
          <button
            type="button"
            onClick={() => setSuccess(false)}
            className="shrink-0 text-primary/70 hover:text-primary transition-colors"
            aria-label="Cerrar mensaje"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4" autoComplete="off">
        <div className="grid sm:grid-cols-2 gap-4">
          {field('nombre', 'Nombre')}
          {field('apellidos', 'Apellidos')}
          {field('fecha_nacimiento', 'Fecha de nacimiento', 'date', { max: new Date().toISOString().split('T')[0] })}
          {field('dni_nie', 'DNI / NIE', 'text', { maxLength: 9 })}
          {field('username', 'Usuario')}
          {field('email', 'Correo electrónico', 'email')}
          <div className="space-y-1 sm:col-span-2">
            {field('password', 'Contraseña', 'password', { autoComplete: 'new-password' })}
            <PasswordStrengthBar
              password={form.password}
              username={form.username}
              email={form.email}
              dni={form.dni_nie}
            />
          </div>
        </div>

        <label className="flex items-start gap-3 p-3 border border-border-subtle rounded-sm bg-surface-subtle cursor-pointer hover:border-primary/30 transition-colors">
          <input
            type="checkbox"
            checked={esAdmin}
            onChange={(e) => { setEsAdmin(e.target.checked); setSuccess(false); }}
            className="mt-0.5 accent-primary"
          />
          <span className="text-sm text-foreground">
            <span className="font-medium">También es administrador</span>
            <span className="block text-xs text-muted-foreground mt-0.5">
              Asigna los roles instructor y admin. Tras el login podrá elegir el panel de administración o el de instructor.
            </span>
          </span>
        </label>

        {errors.general && (
          <p className="text-xs text-danger bg-danger-soft border border-danger-border px-3 py-2 rounded-sm">{errors.general}</p>
        )}

        <div className="grid sm:grid-cols-2 gap-4 pt-2">
          <button
            type="button"
            onClick={handleClear}
            className="w-full px-8 py-3 border border-border-subtle text-muted-foreground text-sm font-bold uppercase tracking-tighter hover:border-primary/30 hover:text-primary transition-all duration-300"
          >
            Limpiar
          </button>
          <button
            type="submit"
            disabled={loading}
            className="w-full inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground px-8 py-3 font-bold uppercase tracking-tighter text-sm hover:bg-primary/80 transition-all duration-300 disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
            {loading ? 'Creando...' : 'Crear instructor'}
          </button>
        </div>
      </form>
    </motion.div>
  );
}
