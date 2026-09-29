import React, { useEffect, useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  UserCheck, UserPlus, Search, Filter, Loader2, CheckCircle, Ban, Trash2, Edit, X, Eye, KeyRound, ShieldCheck,
} from 'lucide-react';
import authService from '@/services/authService';
import conexionesService from '@/services/conexionesService';
import { profileHasInstructor, getRoles } from '@/lib/roles';
import NuevoInstructorForm from '@/pages/instructor/NuevoInstructorForm';

const STATUSES = ['pendiente', 'activo', 'bloqueado', 'rechazado'];

const STATUS_STYLE = {
  pendiente: 'text-info bg-info-soft border-info-border',
  activo: 'text-success bg-success-soft border-success-border',
  bloqueado: 'text-warning bg-warning-soft border-warning-border',
  rechazado: 'text-danger bg-danger-soft border-danger-border',
};

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—');

export default function AdminInstructores() {
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [fStatus, setFStatus] = useState('todos');
  const [actionLoading, setActionLoading] = useState({});
  const [editUser, setEditUser] = useState(null);
  const [detailUser, setDetailUser] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const data = await authService.listProfiles('-created_date', 500);
      setProfiles(data.filter((p) => profileHasInstructor(p)));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    return profiles.filter((p) => {
      if (fStatus !== 'todos' && p.status !== fStatus) return false;
      if (search) {
        const q = search.toLowerCase();
        const blob = `${p.nombre} ${p.apellidos} ${p.email} ${p.username || ''}`.toLowerCase();
        if (!blob.includes(q)) return false;
      }
      return true;
    });
  }, [profiles, fStatus, search]);

  const setStatus = async (id, status) => {
    setActionLoading((p) => ({ ...p, [id]: true }));
    try {
      await authService.updateProfile(id, { status });
      setProfiles((prev) => prev.map((p) => (p.id === id ? { ...p, status } : p)));
      if (detailUser?.id === id) setDetailUser((u) => ({ ...u, status }));
    } finally {
      setActionLoading((p) => ({ ...p, [id]: false }));
    }
  };

  const remove = async (id) => {
    if (!window.confirm('¿Eliminar este instructor? Esta acción no se puede deshacer.')) return;
    setActionLoading((p) => ({ ...p, [id]: true }));
    try {
      await authService.deleteProfile(id);
      setProfiles((prev) => prev.filter((p) => p.id !== id));
    } finally {
      setActionLoading((p) => ({ ...p, [id]: false }));
    }
  };

  const resetPassword = async () => {
    if (!detailUser?.id) return;
    if (!window.confirm(`¿Enviar enlace de restablecimiento a ${detailUser.email}?`)) return;
    try {
      const res = await authService.adminResetPassword(detailUser.id);
      window.alert(res.detail || 'Enlace enviado.');
    } catch (err) {
      window.alert(err.response?.data?.detail || 'No se pudo enviar el enlace.');
    }
  };

  const counts = useMemo(() => ({
    total: profiles.length,
    activo: profiles.filter((p) => p.status === 'activo').length,
    pendiente: profiles.filter((p) => p.status === 'pendiente').length,
    bloqueado: profiles.filter((p) => p.status === 'bloqueado').length,
  }), [profiles]);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h2 className="font-heading text-lg font-bold text-foreground flex items-center gap-2">
            <UserCheck className="w-5 h-5 text-primary" /> Gestión de Instructores
          </h2>
          <p className="text-xs text-muted-foreground mt-1">Crea, edita, activa, bloquea o elimina cuentas de instructor. Acceso exclusivo del administrador.</p>
        </div>
        <button
          onClick={() => setCreateOpen(true)}
          className="inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground px-5 py-2.5 font-bold uppercase tracking-tighter text-sm hover:bg-primary/80 transition-all"
        >
          <UserPlus className="w-4 h-4" /> Nuevo instructor
        </button>
      </div>

      {/* Stat chips */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Total', value: counts.total, icon: UserCheck },
          { label: 'Activos', value: counts.activo, icon: CheckCircle },
          { label: 'Pendientes', value: counts.pendiente, icon: Filter },
          { label: 'Bloqueados', value: counts.bloqueado, icon: Ban },
        ].map((c) => (
          <div key={c.label} className="glass-card p-3">
            <div className="flex items-center gap-2 mb-1">
              <c.icon className="w-3.5 h-3.5 text-primary" />
              <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground/70">{c.label}</span>
            </div>
            <p className="font-heading text-lg font-bold text-foreground">{c.value}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col md:flex-row gap-3">
        <div className="flex items-center gap-2 px-3 h-10 flex-1 border border-border-subtle rounded-md bg-surface-subtle focus-within:border-primary/30">
          <Search className="w-4 h-4 text-muted-foreground/60" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre, email o usuario…"
            className="bg-transparent text-sm text-foreground placeholder:text-muted-foreground/40 outline-none w-full"
          />
        </div>
        <select
          value={fStatus}
          onChange={(e) => setFStatus(e.target.value)}
          className="h-10 px-3 bg-card border border-border-subtle rounded-md text-sm text-foreground outline-none focus:border-transparent"
        >
          <option value="todos">Todos los estados</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="glass-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-subtle text-left">
                <th className="px-4 py-3 text-[10px] font-mono uppercase tracking-widest text-muted-foreground/60">Instructor</th>
                <th className="px-4 py-3 text-[10px] font-mono uppercase tracking-widest text-muted-foreground/60 hidden lg:table-cell">Roles</th>
                <th className="px-4 py-3 text-[10px] font-mono uppercase tracking-widest text-muted-foreground/60">Estado</th>
                <th className="px-4 py-3 text-[10px] font-mono uppercase tracking-widest text-muted-foreground/60 hidden md:table-cell">Alta</th>
                <th className="px-4 py-3 text-[10px] font-mono uppercase tracking-widest text-muted-foreground/60 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} className="py-12 text-center"><Loader2 className="w-6 h-6 text-primary animate-spin mx-auto" /></td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={5} className="py-12 text-center text-sm text-muted-foreground">No se encontraron instructores.</td></tr>
              ) : filtered.map((p) => (
                <tr key={p.id} className="border-b border-border-subtle hover:bg-surface-subtle transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      {p.foto_perfil ? (
                        <img src={p.foto_perfil} alt={p.nombre} className="w-8 h-8 rounded-full object-cover border border-primary/20" />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-primary/15 text-primary flex items-center justify-center text-xs font-bold shrink-0">
                          {(p.nombre || '?').charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="text-foreground truncate">{p.nombre} {p.apellidos}</p>
                        <p className="text-[10px] text-muted-foreground/70 truncate">{p.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 hidden lg:table-cell">
                    <div className="flex flex-wrap gap-1">
                      {getRoles(p).map((r) => (
                        <span key={r} className="px-1.5 py-0.5 text-[9px] font-mono uppercase border border-border-subtle text-muted-foreground rounded">{r}</span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-block px-2 py-0.5 text-[10px] font-mono uppercase border rounded ${STATUS_STYLE[p.status] || ''}`}>
                      {p.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell text-xs text-muted-foreground">{fmtDate(p.created_date)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      {actionLoading[p.id] ? (
                        <Loader2 className="w-4 h-4 text-muted-foreground animate-spin" />
                      ) : (
                        <>
                          {p.status !== 'activo' && (
                            <button onClick={() => setStatus(p.id, 'activo')} title="Activar" className="w-7 h-7 flex items-center justify-center text-success hover:bg-success-soft rounded transition-colors">
                              <CheckCircle className="w-4 h-4" />
                            </button>
                          )}
                          {p.status !== 'bloqueado' && (
                            <button onClick={() => setStatus(p.id, 'bloqueado')} title="Bloquear" className="w-7 h-7 flex items-center justify-center text-warning hover:bg-warning-soft rounded transition-colors">
                              <Ban className="w-4 h-4" />
                            </button>
                          )}
                          <button onClick={() => setDetailUser(p)} title="Ver detalles" className="w-7 h-7 flex items-center justify-center text-info hover:bg-info-soft rounded transition-colors">
                            <Eye className="w-4 h-4" />
                          </button>
                          <button onClick={() => setEditUser(p)} title="Editar" className="w-7 h-7 flex items-center justify-center text-primary hover:bg-primary/10 rounded transition-colors">
                            <Edit className="w-4 h-4" />
                          </button>
                          <button onClick={() => remove(p.id)} title="Eliminar" className="w-7 h-7 flex items-center justify-center text-danger hover:bg-danger-soft rounded transition-colors">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3 border-t border-border-subtle text-xs text-muted-foreground">
          {filtered.length} de {profiles.length} instructores
        </div>
      </div>

      <CreateInstructorModal open={createOpen} onClose={() => setCreateOpen(false)} onCreated={() => { setCreateOpen(false); load(); }} />

      <EditInstructorModal
        user={editUser}
        onClose={() => setEditUser(null)}
        onSave={async (id, patch) => {
          await authService.updateProfile(id, patch);
          setProfiles((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
          setEditUser(null);
        }}
      />

      <InstructorDetailModal
        user={detailUser}
        onClose={() => setDetailUser(null)}
        onResetPassword={resetPassword}
      />
    </div>
  );
}

function CreateInstructorModal({ open, onClose, onCreated }) {
  const [formKey, setFormKey] = useState(0);

  useEffect(() => {
    if (open) setFormKey((k) => k + 1);
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm overflow-y-auto"
        >
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 16, scale: 0.98 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-2xl my-8"
          >
            <div className="flex items-center justify-between mb-4 px-1">
              <h3 className="font-heading text-lg font-bold text-foreground">Nuevo instructor</h3>
              <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
            </div>
            <NuevoInstructorForm key={formKey} onCreated={onCreated} />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function EditInstructorModal({ user, onClose, onSave }) {
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (user) {
      const roles = getRoles(user);
      setForm({
        nombre: user.nombre,
        apellidos: user.apellidos,
        email: user.email,
        username: user.username,
        status: user.status,
        esAdmin: roles.includes('admin'),
      });
    }
  }, [user]);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const roles = ['instructor'];
      if (form.esAdmin) roles.push('admin');
      await onSave(user.id, {
        nombre: form.nombre,
        apellidos: form.apellidos,
        email: form.email,
        username: form.username,
        status: form.status,
        roles,
      });
    } finally { setSaving(false); }
  };

  return (
    <AnimatePresence>
      {user && form && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm"
        >
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 16, scale: 0.98 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg glass-card p-6"
          >
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-heading text-lg font-bold text-foreground">Editar instructor</h3>
              <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={submit} className="space-y-4">
              <div className="grid sm:grid-cols-2 gap-4">
                <Field label="Nombre" value={form.nombre} onChange={(v) => setForm({ ...form, nombre: v })} />
                <Field label="Apellidos" value={form.apellidos} onChange={(v) => setForm({ ...form, apellidos: v })} />
                <Field label="Email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} />
                <Field label="Usuario" value={form.username} onChange={(v) => setForm({ ...form, username: v })} />
                <div className="space-y-1">
                  <label className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Estado</label>
                  <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="w-full h-10 px-3 bg-card border border-border-subtle rounded-md text-sm text-foreground outline-none focus:border-transparent">
                    {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!!form.esAdmin}
                      onChange={(e) => setForm({ ...form, esAdmin: e.target.checked })}
                      className="accent-primary"
                    />
                    También es administrador
                  </label>
                  <p className="text-[10px] text-muted-foreground">Mantiene el rol instructor y añade o quita acceso al panel /admin.</p>
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={onClose} className="px-5 py-2.5 border border-border-subtle text-muted-foreground text-sm font-bold uppercase tracking-tighter hover:border-primary/30 hover:text-primary transition-all">Cancelar</button>
                <button type="submit" disabled={saving} className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground text-sm font-bold uppercase tracking-tighter hover:bg-primary/80 transition-all disabled:opacity-50">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />} Guardar
                </button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function InstructorDetailModal({ user, onClose, onResetPassword }) {
  const [ultimoAcceso, setUltimoAcceso] = useState('Cargando...');
  const [assignedAlumnos, setAssignedAlumnos] = useState([]);
  const [loadingAlumnos, setLoadingAlumnos] = useState(true);
  const [assignModalOpen, setAssignModalOpen] = useState(false);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const regs = await conexionesService.registros.list('-fecha_hora', 1, {});
        const match = (Array.isArray(regs) ? regs : []).find(
          (r) => r.profile === user.id || r.profile_id === user.id,
        );
        if (!cancelled) {
          setUltimoAcceso(match ? (match.ultima_actividad || match.fecha_hora) : null);
        }
      } catch {
        if (!cancelled) setUltimoAcceso(null);
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  const loadAlumnos = async () => {
    if (!user?.id) return;
    setLoadingAlumnos(true);
    try {
      const data = await authService.getAssignedAlumnos(user.id);
      setAssignedAlumnos(Array.isArray(data) ? data : data?.results || []);
    } catch {
      setAssignedAlumnos([]);
    } finally {
      setLoadingAlumnos(false);
    }
  };

  useEffect(() => {
    if (user?.id) loadAlumnos();
  }, [user?.id]);

  return (
    <AnimatePresence>
      {user && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm overflow-y-auto"
        >
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 16, scale: 0.98 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg glass-card p-6 my-8"
          >
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-heading text-lg font-bold text-foreground">Detalles del instructor</h3>
              <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
            </div>
            <div className="flex items-center gap-3 mb-5">
              {user.foto_perfil ? (
                <img src={user.foto_perfil} alt={user.nombre} className="w-12 h-12 rounded-full object-cover border border-primary/20" />
              ) : (
                <div className="w-12 h-12 rounded-full bg-primary/15 text-primary flex items-center justify-center text-lg font-bold">
                  {(user.nombre || '?').charAt(0).toUpperCase()}
                </div>
              )}
              <div className="min-w-0">
                <p className="text-foreground font-medium truncate">{user.nombre} {user.apellidos}</p>
                <p className="text-xs text-muted-foreground truncate">{user.email}</p>
              </div>
              <span className={`ml-auto shrink-0 inline-block px-2 py-0.5 text-[10px] font-mono uppercase border rounded ${STATUS_STYLE[user.status] || ''}`}>{user.status}</span>
            </div>
            <div className="grid sm:grid-cols-2 gap-4 text-sm">
              <Detail label="Usuario" value={`@${user.username || '—'}`} />
              <Detail label="DNI / NIE" value={user.dni_nie || '—'} />
              <Detail label="Fecha de alta" value={fmtDate(user.created_date)} />
              <Detail label="Último acceso" value={ultimoAcceso ? fmtDate(ultimoAcceso) : 'Sin registros'} />
            </div>
            {/* Assigned Alumnos */}
            <div className="mt-5">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground">
                  Alumnos asignados ({assignedAlumnos.length})
                </p>
                <button
                  onClick={() => setAssignModalOpen(true)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-[10px] font-mono uppercase tracking-widest text-primary border border-primary/20 hover:bg-primary/5 rounded transition-colors"
                >
                  <UserPlus className="w-3 h-3" /> Asignar
                </button>
              </div>
              {loadingAlumnos ? (
                <div className="py-4 text-center"><Loader2 className="w-4 h-4 text-primary animate-spin mx-auto" /></div>
              ) : assignedAlumnos.length === 0 ? (
                <p className="text-xs text-muted-foreground/50 py-3">No hay alumnos asignados a este instructor.</p>
              ) : (
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {assignedAlumnos.map((a) => (
                    <div key={a.id} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-surface-subtle">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="w-6 h-6 rounded-full bg-primary/15 text-primary flex items-center justify-center text-[10px] font-bold shrink-0">
                          {(a.nombre || '?').charAt(0).toUpperCase()}
                        </div>
                        <span className="text-sm text-foreground truncate">{a.nombre} {a.apellidos}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {/* Permissions (prepared for RBAC) */}
            <div className="mt-4">
              <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-2 flex items-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5" /> Permisos</p>
              <p className="text-[10px] text-muted-foreground/50">Gestión de permisos preparada para la implementación RBAC futura.</p>
            </div>
            <div className="flex justify-end gap-3 pt-5 mt-5 border-t border-border-subtle">
              <button onClick={onResetPassword} className="inline-flex items-center gap-1.5 px-4 py-2 border border-border-subtle text-muted-foreground text-xs font-bold uppercase tracking-widest hover:border-primary/30 hover:text-primary transition-all">
                <KeyRound className="w-3.5 h-3.5" /> Restablecer contraseña
              </button>
              <button onClick={onClose} className="px-5 py-2 bg-primary text-primary-foreground text-sm font-bold uppercase tracking-tighter hover:bg-primary/80 transition-all">Cerrar</button>
            </div>
          </motion.div>
        </motion.div>
      )}

      {assignModalOpen && (
        <AssignStudentsModal
          instructorId={user.id}
          currentlyAssigned={assignedAlumnos.map((a) => a.id)}
          onClose={() => setAssignModalOpen(false)}
          onAssigned={(newAlumnos) => {
            setAssignedAlumnos((prev) => [...prev, ...newAlumnos]);
            setAssignModalOpen(false);
          }}
        />
      )}
    </AnimatePresence>
  );
}

function AssignStudentsModal({ instructorId, currentlyAssigned, onClose, onAssigned }) {
  const [alumnos, setAlumnos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await authService.listProfiles('-created_date', 500);
        const alumnosList = (Array.isArray(data) ? data : []).filter(
          (p) => p.role === 'alumno' || (Array.isArray(p.roles) && p.roles.includes('alumno')),
        );
        if (!cancelled) setAlumnos(alumnosList);
      } catch {
        if (!cancelled) setAlumnos([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    return alumnos.filter((a) => {
      if (search) {
        const q = search.toLowerCase();
        const blob = `${a.nombre} ${a.apellidos} ${a.email} ${a.username || ''}`.toLowerCase();
        if (!blob.includes(q)) return false;
      }
      return true;
    });
  }, [alumnos, search]);

  const toggleSelect = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleAssign = async () => {
    if (selected.size === 0) return;
    setSaving(true);
    try {
      const ids = Array.from(selected);
      await authService.assignAlumnos(instructorId, ids);
      const newAlumnos = alumnos.filter((a) => ids.includes(a.id));
      onAssigned(newAlumnos);
    } catch (err) {
      window.alert(err.response?.data?.detail || 'Error al asignar alumnos.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={onClose}
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm"
    >
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 16, scale: 0.98 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg glass-card p-6"
      >
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-heading text-lg font-bold text-foreground">Asignar alumnos</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>
        <div className="flex items-center gap-2 px-3 h-10 mb-4 border border-border-subtle rounded-md bg-surface-subtle focus-within:border-primary/30">
          <Search className="w-4 h-4 text-muted-foreground/60" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre, email o usuario…"
            className="bg-transparent text-sm text-foreground placeholder:text-muted-foreground/40 outline-none w-full"
          />
        </div>
        <div className="max-h-64 overflow-y-auto space-y-1">
          {loading ? (
            <div className="py-8 text-center"><Loader2 className="w-5 h-5 text-primary animate-spin mx-auto" /></div>
          ) : filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No se encontraron alumnos.</p>
          ) : filtered.map((a) => {
            const isAssigned = currentlyAssigned.includes(a.id);
            return (
              <label
                key={a.id}
                className={`flex items-center gap-3 px-3 py-2 rounded cursor-pointer transition-colors ${
                  isAssigned ? 'opacity-50' : 'hover:bg-surface-subtle'
                }`}
              >
                <input
                  type="checkbox"
                  checked={selected.has(a.id)}
                  disabled={isAssigned}
                  onChange={() => toggleSelect(a.id)}
                  className="accent-primary"
                />
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-6 h-6 rounded-full bg-primary/15 text-primary flex items-center justify-center text-[10px] font-bold shrink-0">
                    {(a.nombre || '?').charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm text-foreground truncate">{a.nombre} {a.apellidos}</p>
                    <p className="text-[10px] text-muted-foreground/70 truncate">{a.email}</p>
                  </div>
                </div>
                {isAssigned && (
                  <span className="ml-auto text-[10px] text-muted-foreground/50 shrink-0">Asignado</span>
                )}
              </label>
            );
          })}
        </div>
        <div className="flex justify-end gap-3 pt-4 mt-4 border-t border-border-subtle">
          <button onClick={onClose} className="px-5 py-2.5 border border-border-subtle text-muted-foreground text-sm font-bold uppercase tracking-tighter hover:border-primary/30 hover:text-primary transition-all">Cancelar</button>
          <button
            onClick={handleAssign}
            disabled={saving || selected.size === 0}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground text-sm font-bold uppercase tracking-tighter hover:bg-primary/80 transition-all disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
            Asignar {selected.size > 0 && `(${selected.size})`}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function Field({ label, value, onChange }) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-mono uppercase tracking-widest text-muted-foreground">{label}</label>
      <input
        value={value || ''}
        onChange={(e) => onChange(e.target.value.replace(/[<>{}]/g, ''))}
        className="w-full h-10 px-3 bg-surface-muted border border-border-subtle rounded-md text-sm text-foreground outline-none focus:border-transparent"
      />
    </div>
  );
}

function Detail({ label, value }) {
  return (
    <div>
      <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground/60 mb-0.5">{label}</p>
      <p className="text-foreground">{value}</p>
    </div>
  );
}
