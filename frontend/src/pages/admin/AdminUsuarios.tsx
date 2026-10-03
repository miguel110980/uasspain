import PanelModal from '@/components/ui/PanelModal';
import React, { useEffect, useState, useMemo, useRef } from 'react';
import { AnimatePresence } from 'framer-motion';
import {
  Users, Search, Filter, Loader2, CheckCircle, Ban, Trash2, Edit, X, UserCheck, Shield, Download, ClipboardList, BarChart2, AlertCircle, Lock,
} from 'lucide-react';
import authService from '@/services/authService';
import examenesService from '@/services/examenesService';
import conexionesService from '@/services/conexionesService';
import materialesService from '@/services/materialesService';
import { extractErrorMessage } from '@/lib/errors';
import { useToast } from '@/components/ui/use-toast';
import { getRoles, hasRole, profileHasAdmin, profileHasInstructor } from '@/lib/roles';
import type { AssignableInstructor } from '@/types/api';

const instructorLabel = (instructor: AssignableInstructor) => `${`${instructor.nombre} ${instructor.apellidos}`.trim() || 'Instructor'} · ${instructor.username ? `@${instructor.username}` : instructor.id}`;

const ROLES = ['alumno', 'instructor', 'admin'];
const STATUSES = ['pendiente', 'activo', 'bloqueado', 'rechazado'];

const STATUS_STYLE = {
  pendiente: 'text-info bg-info-soft border-info-border',
  activo: 'text-success bg-success-soft border-success-border',
  bloqueado: 'text-warning bg-warning-soft border-warning-border',
  rechazado: 'text-danger bg-danger-soft border-danger-border',
};
const ROLE_STYLE = {
  alumno: 'text-info bg-info-soft border-info-border',
  instructor: 'text-success bg-success-soft border-success-border',
  admin: 'text-primary bg-primary/15 border-primary/30',
};

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—');

/** @param {{ scopeRole?: string | null, onExamenes?: (profile: any) => void, onResultados?: (profile: any) => void, onAccesos?: (profile: any) => void, allowEdit?: boolean }} props */
type AdminUsuariosProps = {
  scopeRole?: string | null;
  onExamenes?: (profile: any) => void;
  onResultados?: (profile: any) => void;
  onAccesos?: (profile: any) => void;
  allowEdit?: boolean;
  allowInstructorAssignment?: boolean;
  assignmentOwnerId?: string;
  onAssignmentChanged?: () => void;
};

export default function AdminUsuarios({ scopeRole = null, onExamenes, onResultados, onAccesos, allowEdit = true, allowInstructorAssignment = false, assignmentOwnerId, onAssignmentChanged }: AdminUsuariosProps) {
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [fRole, setFRole] = useState('todos');
  const [fStatus, setFStatus] = useState('todos');
  const [actionLoading, setActionLoading] = useState({});
  const [editUser, setEditUser] = useState(null);
  const [instructors, setInstructors] = useState<AssignableInstructor[]>([]);
  const [loadError, setLoadError] = useState('');
  const [assignmentErrors, setAssignmentErrors] = useState<Record<string, string>>({});
  const loadVersion = useRef(0);
  const pendingAssignments = useRef(new Set<string>());
  const { toast } = useToast();

  const load = async (silent = false) => {
    const version = ++loadVersion.current;
    if (!silent) setLoading(true);
    try {
      const [data, options] = await Promise.all([
        authService.listProfiles('-created_date', 500),
        allowInstructorAssignment ? authService.listInstructors() : Promise.resolve([]),
      ]);
      if (version !== loadVersion.current) return;
      setProfiles(scopeRole ? data.filter((p) => {
        return hasRole(p, scopeRole);
      }) : data);
      setInstructors(options);
      setLoadError('');
    } catch (error) {
      if (version === loadVersion.current) setLoadError(extractErrorMessage(error, 'No se pudieron cargar los alumnos e instructores.'));
    } finally {
      if (version === loadVersion.current) setLoading(false);
    }
  };
  useEffect(() => {
    void load();
    if (!allowInstructorAssignment) return;
    const unsubscribe = conexionesService.subscribeConexiones(event => {
      const payload = conexionesService.parseWsPayload(event);
      if (payload?.type === 'asignacion' || event.type === 'poll') void load(true);
    });
    const onFocus = () => { void load(true); };
    window.addEventListener('focus', onFocus);
    return () => { unsubscribe(); window.removeEventListener('focus', onFocus); loadVersion.current++; };
  }, [allowInstructorAssignment, scopeRole]);

  const assignInstructor = async (student, instructorId: string) => {
    if (!instructorId || instructorId === String(student.assigned_instructor_id) || pendingAssignments.current.has(student.id)) return;
    pendingAssignments.current.add(student.id);
    loadVersion.current++;
    setActionLoading(current => ({ ...current, [student.id]: true }));
    setAssignmentErrors(current => ({ ...current, [student.id]: '' }));
    try {
      const result = await authService.assignAlumnos(instructorId, [student.id]);
      if (result.assigned_count !== 1 || result.assigned_instructor_id !== instructorId) throw new Error('La asignación no se pudo confirmar.');
      setProfiles(current => assignmentOwnerId && instructorId !== assignmentOwnerId
        ? current.filter(profile => profile.id !== student.id)
        : current.map(profile => profile.id === student.id ? { ...profile, assigned_instructor_id: instructorId } : profile));
      toast({ title: 'Instructor asignado', description: assignmentOwnerId && instructorId !== assignmentOwnerId ? 'El alumno pasa al listado del instructor seleccionado.' : 'La asignación se ha guardado.' });
      onAssignmentChanged?.();
      await load(true);
    } catch (error) {
      const message = extractErrorMessage(error, 'No se pudo cambiar el instructor.');
      setAssignmentErrors(current => ({ ...current, [student.id]: message }));
      toast({ title: 'Error al asignar instructor', description: message, variant: 'destructive' });
    } finally {
      pendingAssignments.current.delete(student.id);
      setActionLoading(current => ({ ...current, [student.id]: false }));
    }
  };

  const filtered = useMemo(() => {
    return profiles.filter((p) => {
      if (!scopeRole && fRole !== 'todos') {
        const roles = Array.isArray(p.roles) ? p.roles : [p.role || 'alumno'];
        if (!roles.includes(fRole)) return false;
      }
      if (fStatus !== 'todos' && p.status !== fStatus) return false;
      if (search) {
        const q = search.toLowerCase();
        const blob = `${p.nombre} ${p.apellidos} ${p.email} ${p.username || ''}`.toLowerCase();
        if (!blob.includes(q)) return false;
      }
      return true;
    });
  }, [profiles, fRole, fStatus, search, scopeRole]);

  const setStatus = async (id, status) => {
    setActionLoading((p) => ({ ...p, [id]: true }));
    try {
      const updated = await authService.updateProfile(id, { status });
      setProfiles((prev) => prev.map((p) => (String(p.id) === String(updated.id) ? { ...p, ...updated } : p)));
    } catch (err) {
      toast({ title: 'Error al cambiar estado', description: extractErrorMessage(err), variant: 'destructive' });
    } finally {
      setActionLoading((p) => ({ ...p, [id]: false }));
    }
  };

  const remove = async (id) => {
    if (!window.confirm('¿Eliminar este usuario? Se borrarán también sus exámenes, resultados, conexiones, mensajes y materiales completados.')) return;
    setActionLoading((p) => ({ ...p, [id]: true }));
    try {
      // Limpiar datos relacionados del alumno antes de eliminar el perfil
      await Promise.allSettled([
        examenesService.resultados.deleteMany({ alumno_id: id }),
        conexionesService.conexiones.deleteMany({ alumno_id: id }),
        examenesService.bloqueos.deleteMany({ alumno_id: id }),
        materialesService.completados.deleteMany({ alumno_id: id }),
        conexionesService.mensajes.deleteMany({ alumno_id: id }),
      ]);
      await authService.deleteProfile(id);
      setProfiles((prev) => prev.filter((p) => p.id !== id));
      toast({ title: 'Usuario eliminado', description: 'Se han borrado también sus datos asociados.' });
    } catch (err) {
      toast({ title: 'Error al eliminar', description: extractErrorMessage(err, 'No se pudo eliminar el usuario. Compruebe sus permisos.'), variant: 'destructive' });
    } finally {
      setActionLoading((p) => ({ ...p, [id]: false }));
    }
  };

  const counts = useMemo(() => {
    if (scopeRole === 'alumno') {
      return {
        total: profiles.length,
        activo: profiles.filter((p) => p.status === 'activo').length,
        pendiente: profiles.filter((p) => p.status === 'pendiente').length,
        bloqueado: profiles.filter((p) => p.status === 'bloqueado').length,
        rechazado: profiles.filter((p) => p.status === 'rechazado').length,
      };
    }
    return {
      total: profiles.length,
      alumno: profiles.filter((p) => hasRole(p, 'alumno') && p.status === 'activo').length,
      instructor: profiles.filter((p) => profileHasInstructor(p) && p.status === 'activo').length,
      admin: profiles.filter((p) => profileHasAdmin(p) && p.status === 'activo').length,
      pendiente: profiles.filter((p) => p.status === 'pendiente').length,
    };
  }, [profiles, scopeRole]);

  const exportCSV = () => {
    const headers = ['Nombre', 'Apellidos', 'Email', 'Usuario', 'Rol', 'Estado', 'Alta'];
    const rows = filtered.map((p) => [
      p.nombre || '', p.apellidos || '', p.email || '', p.username || '',
      p.role || 'alumno', p.status || '', fmtDate(p.created_date),
    ]);
    const escape = (v) => `"${String(v).replace(/"/g, '""')}"`;
    const csv = [headers, ...rows].map((r) => r.map(escape).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `usuarios-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5">
      {loadError && <div role="alert" className="text-sm text-danger">{loadError} <button className="underline" onClick={() => void load()}>Reintentar</button></div>}
      {/* Stat chips */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {(scopeRole === 'alumno'
          ? [
              { label: 'Total', value: counts.total, icon: Users },
              { label: 'Activos', value: counts.activo, icon: CheckCircle },
              { label: 'Pendientes', value: counts.pendiente, icon: Filter },
              { label: 'Bloqueados', value: counts.bloqueado, icon: Ban },
              { label: 'Rechazados', value: counts.rechazado, icon: X },
            ]
          : [
              { label: 'Total', value: counts.total, icon: Users },
              { label: 'Alumnos', value: counts.alumno, icon: Users },
              { label: 'Instructores', value: counts.instructor, icon: UserCheck },
              { label: 'Admins', value: counts.admin, icon: Shield },
              { label: 'Pendientes', value: counts.pendiente, icon: Filter },
            ]
        ).map((c) => (
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
        {!scopeRole && (
          <select
            value={fRole}
            onChange={(e) => setFRole(e.target.value)}
            className="h-10 px-3 bg-card border border-border-subtle rounded-md text-sm text-foreground outline-none focus:border-transparent"
          >
            <option value="todos">Todos los roles</option>
            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        )}
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
                <th className="px-4 py-3 text-[10px] font-mono uppercase tracking-widest text-muted-foreground/60">Usuario</th>
                {!scopeRole && (<th className="px-4 py-3 text-[10px] font-mono uppercase tracking-widest text-muted-foreground/60">Rol</th>)}
                <th className="px-4 py-3 text-[10px] font-mono uppercase tracking-widest text-muted-foreground/60">Estado</th>
                {scopeRole === 'alumno' && (
                  <th className="px-4 py-3 text-[10px] font-mono uppercase tracking-widest text-muted-foreground/60 hidden lg:table-cell">Email</th>
                )}
                {scopeRole === 'alumno' && (
                  <th className="px-4 py-3 text-[10px] font-mono uppercase tracking-widest text-muted-foreground/60">Instructor</th>
                )}
                <th className="px-4 py-3 text-[10px] font-mono uppercase tracking-widest text-muted-foreground/60 hidden md:table-cell">Alta</th>
                <th className="px-4 py-3 text-[10px] font-mono uppercase tracking-widest text-muted-foreground/60 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={scopeRole === 'alumno' ? 6 : 5} className="py-12 text-center"><Loader2 className="w-6 h-6 text-primary animate-spin mx-auto" /></td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={scopeRole === 'alumno' ? 6 : 5} className="py-12 text-center text-sm text-muted-foreground">{scopeRole === 'alumno' ? 'No se encontraron alumnos.' : 'No se encontraron usuarios.'}</td></tr>
              ) : filtered.map((p) => (
                <tr key={p.id} className="border-b border-border-subtle hover:bg-surface-subtle transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-primary/15 text-primary flex items-center justify-center text-xs font-bold shrink-0">
                        {(p.nombre || '?').charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="text-foreground truncate">{p.nombre} {p.apellidos}</p>
                        <p className="text-[10px] text-muted-foreground/70 truncate">{p.email}</p>
                        <p className="text-[10px] text-muted-foreground/50 truncate">2FA: {p.login_2fa_enabled_override === true ? 'forzado' : p.login_2fa_enabled_override === false ? 'desactivado' : 'heredado'}</p>
                      </div>
                    </div>
                  </td>
                  {!scopeRole && (
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {getRoles(p).map((r) => (
                          <span key={r} className={`inline-block px-2 py-0.5 text-[10px] font-mono uppercase border rounded ${ROLE_STYLE[r] || ROLE_STYLE.alumno}`}>
                            {r}
                          </span>
                        ))}
                      </div>
                    </td>
                  )}
                  <td className="px-4 py-3">
                    <span className={`inline-block px-2 py-0.5 text-[10px] font-mono uppercase border rounded ${STATUS_STYLE[p.status] || ''}`}>
                      {p.status}
                    </span>
                  </td>
                  {scopeRole === 'alumno' && (
                    <td className="px-4 py-3 hidden lg:table-cell">
                      <span className={`inline-block px-2 py-0.5 text-[10px] font-mono uppercase border rounded ${
                        p.otp_verified
                          ? 'text-success bg-success-soft border-success-border'
                          : 'text-warning bg-warning-soft border-warning-border'
                      }`}>
                        {p.otp_verified ? 'Verificado' : 'Sin verificar'}
                      </span>
                    </td>
                  )}
                  {scopeRole === 'alumno' && (
                    <td className="px-4 py-3">
                      {allowInstructorAssignment ? <div className="w-56 space-y-1">
                        <select
                          aria-label={`Instructor de ${`${p.nombre} ${p.apellidos}`.trim() || p.username}`}
                          aria-describedby={assignmentErrors[p.id] ? `assignment-error-${p.id}` : undefined}
                          value={p.assigned_instructor_id || ''}
                          disabled={Boolean(actionLoading[p.id]) || loading || Boolean(loadError) || instructors.length === 0 || !assignmentOwnerId || profileHasAdmin(p) || profileHasInstructor(p)}
                          onChange={event => void assignInstructor(p, event.target.value)}
                          className="w-full h-10 px-2 bg-card border border-border-subtle rounded-md text-xs text-foreground focus-visible:outline-primary disabled:opacity-60"
                        >
                          <option value="" disabled>Sin instructor asignado</option>
                          {p.assigned_instructor_id && !instructors.some(instructor => instructor.id === p.assigned_instructor_id) && <option value={p.assigned_instructor_id} disabled>{p.assigned_instructor_name || 'Instructor asignado'} (no disponible)</option>}
                          {instructors.map(instructor => <option key={instructor.id} value={instructor.id}>{instructorLabel(instructor)}</option>)}
                        </select>
                        {actionLoading[p.id] && <span role="status" className="text-xs text-muted-foreground">Guardando asignación…</span>}
                        {instructors.length === 0 && <span className="text-xs text-muted-foreground">No hay instructores disponibles.</span>}
                        {(profileHasAdmin(p) || profileHasInstructor(p)) && <span className="text-xs text-muted-foreground">Asignación gestionada por administración.</span>}
                        {assignmentErrors[p.id] && <p role="alert" id={`assignment-error-${p.id}`} className="text-xs text-danger">{assignmentErrors[p.id]}</p>}
                      </div> : <span className="text-xs text-muted-foreground">{p.assigned_instructor_name || '—'}</span>}
                    </td>
                  )}
                  <td className="px-4 py-3 hidden md:table-cell text-xs text-muted-foreground">{fmtDate(p.created_date)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      {actionLoading[p.id] ? (
                        <Loader2 className="w-4 h-4 text-muted-foreground animate-spin" />
                      ) : (
                        <>
                          {onExamenes && (
                            <button onClick={() => onExamenes(p)} title="Exámenes" className="w-7 h-7 flex items-center justify-center text-foreground hover:bg-surface-active rounded transition-colors">
                              <ClipboardList className="w-4 h-4" />
                            </button>
                          )}
                          {onAccesos && (
                            <button onClick={() => onAccesos(p)} title="Gestionar accesos" className="w-7 h-7 flex items-center justify-center text-info hover:bg-info-soft rounded transition-colors">
                              <Lock className="w-4 h-4" />
                            </button>
                          )}
                          {onResultados && (
                            <button onClick={() => onResultados(p)} title="Resultados" className="w-7 h-7 flex items-center justify-center text-foreground hover:bg-surface-active rounded transition-colors">
                              <BarChart2 className="w-4 h-4" />
                            </button>
                          )}
                          {p.status === 'pendiente' && p.otp_verified && (
                            <button onClick={() => setStatus(p.id, 'activo')} title="Aprobar solicitud" className="w-7 h-7 flex items-center justify-center text-success hover:bg-success-soft rounded transition-colors">
                              <CheckCircle className="w-4 h-4" />
                            </button>
                          )}
                          {p.status === 'pendiente' && (
                            <button onClick={() => setStatus(p.id, 'rechazado')} title="Rechazar solicitud" className="w-7 h-7 flex items-center justify-center text-danger hover:bg-danger-soft rounded transition-colors">
                              <X className="w-4 h-4" />
                            </button>
                          )}
                          {p.status !== 'activo' && p.status !== 'pendiente' && (
                            <button onClick={() => setStatus(p.id, 'activo')} title="Activar" className="w-7 h-7 flex items-center justify-center text-success hover:bg-success-soft rounded transition-colors">
                              <CheckCircle className="w-4 h-4" />
                            </button>
                          )}
                          {p.status !== 'bloqueado' && (
                            <button onClick={() => setStatus(p.id, 'bloqueado')} title="Suspender" className="w-7 h-7 flex items-center justify-center text-warning hover:bg-warning-soft rounded transition-colors">
                              <Ban className="w-4 h-4" />
                            </button>
                          )}
                          {allowEdit && (
                            <button onClick={() => setEditUser(p)} title="Editar" className="w-7 h-7 flex items-center justify-center text-info hover:bg-info-soft rounded transition-colors">
                              <Edit className="w-4 h-4" />
                            </button>
                          )}
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
        <div className="px-4 py-3 border-t border-border-subtle flex items-center justify-between text-xs text-muted-foreground">
          <span>{filtered.length} de {profiles.length} usuarios</span>
          <button onClick={exportCSV} className="flex items-center gap-1.5 hover:text-primary transition-colors">
            <Download className="w-3.5 h-3.5" /> Exportar
          </button>
        </div>
      </div>

      {allowEdit && (
        <EditUserModal
          user={editUser}
          scopeRole={scopeRole}
          onClose={() => setEditUser(null)}
          onSave={async (id, patch) => {
            try {
              const updated = await authService.updateProfile(id, patch);
              setProfiles((prev) => prev.map((p) => (p.id === id ? updated : p)));
              setEditUser(null);
              toast({ title: 'Usuario actualizado' });
              return updated;
            } catch (err) {
              toast({ title: 'Error al guardar', description: extractErrorMessage(err), variant: 'destructive' });
            }
          }}
        />
      )}
    </div>
  );
}

function EditUserModal({ user, scopeRole, onClose, onSave }) {
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [instructors, setInstructors] = useState([]);
  const [instructorsLoading, setInstructorsLoading] = useState(false);
  const [formError, setFormError] = useState('');

  useEffect(() => {
    if (user) {
      const assignedId = user.assigned_instructor_id ? String(user.assigned_instructor_id) : '';
      setForm({
        nombre: user.nombre,
        apellidos: user.apellidos,
        email: user.email,
        username: user.username,
        role: user.role || 'alumno',
        status: user.status,
        login_2fa_enabled_override: user.login_2fa_enabled_override ?? null,
        assigned_instructor_id: assignedId,
      });
      const isAlumno = user.role === 'alumno' || (Array.isArray(user.roles) && user.roles.includes('alumno'));
      if (isAlumno) {
        setInstructorsLoading(true);
        authService.listInstructors()
          .then((list) => {
            setInstructors(Array.isArray(list) ? list : []);
          })
          .catch(() => setInstructors([]))
          .finally(() => setInstructorsLoading(false));
      } else {
        setInstructors([]);
      }
    }
  }, [user]);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setFormError('');
    try {
      const isAlumno = form.role === 'alumno' || (Array.isArray(user.roles) && user.roles.includes('alumno'));
      if (isAlumno && !form.assigned_instructor_id) {
        setFormError('Selecciona un instructor asignado.');
        return;
      }
      const { assigned_instructor_id, ...fields } = form;
      const payload = { ...fields, ...(isAlumno && assigned_instructor_id ? { assigned_instructor_id } : {}) };
      const updated = await onSave(user.id, payload);
      if (updated?.assigned_instructor_id !== undefined) {
        setForm((prev) => prev && ({ ...prev, assigned_instructor_id: updated.assigned_instructor_id ? String(updated.assigned_instructor_id) : '' }));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <AnimatePresence>
      {user && form && (
        <PanelModal label="Editar usuario" onClose={onClose} className="max-w-lg glass-card p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-heading text-lg font-bold text-foreground">Editar usuario</h3>
              <button onClick={onClose} aria-label="Cerrar" className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={submit} className="space-y-4">
              <div className="grid sm:grid-cols-2 gap-4">
                <Field label="Nombre" value={form.nombre} onChange={(v) => setForm({ ...form, nombre: v })} />
                <Field label="Apellidos" value={form.apellidos} onChange={(v) => setForm({ ...form, apellidos: v })} />
                <Field label="Email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} />
                <Field label="Usuario" value={form.username} onChange={(v) => setForm({ ...form, username: v })} />
                {!scopeRole && (
                 <div className="space-y-1">
                   <label htmlFor="edit-user-role" className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Rol</label>
                   <select id="edit-user-role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className="w-full h-10 px-3 bg-card border border-border-subtle rounded-md text-sm text-foreground outline-none focus:border-transparent">
                     {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                   </select>
                 </div>
                )}
                <div className="space-y-1">
                  <label htmlFor="edit-user-status" className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Estado</label>
                  <select id="edit-user-status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="w-full h-10 px-3 bg-card border border-border-subtle rounded-md text-sm text-foreground outline-none focus:border-transparent">
                    {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <label htmlFor="edit-user-two-factor" className="text-xs font-mono uppercase tracking-widest text-muted-foreground">2FA usuario</label>
                  <select id="edit-user-two-factor"
                    value={form.login_2fa_enabled_override == null ? 'inherit' : String(form.login_2fa_enabled_override)}
                    onChange={(e) => setForm({ ...form, login_2fa_enabled_override: e.target.value === 'inherit' ? null : e.target.value === 'true' })}
                    className="w-full h-10 px-3 bg-card border border-border-subtle rounded-md text-sm text-foreground outline-none focus:border-transparent"
                  >
                    <option value="inherit">Heredado de la política global</option>
                    <option value="true">Obligatorio para este usuario</option>
                    <option value="false">Desactivado para este usuario</option>
                  </select>
                </div>
                {(form.role === 'alumno' || (Array.isArray(user.roles) && user.roles.includes('alumno'))) && (
                  <div className="space-y-1 sm:col-span-2">
                    <label htmlFor="edit-user-instructor" className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Instructor asignado</label>
                    {instructorsLoading ? (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground bg-surface-subtle border border-border-subtle px-3 py-2 rounded">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Cargando instructores…
                      </div>
                    ) : (
                      <select id="edit-user-instructor"
                        value={form.assigned_instructor_id || ''}
                        onChange={(e) => {
                          setForm({ ...form, assigned_instructor_id: e.target.value });
                          setFormError('');
                        }}
                        required
                        disabled={instructors.length === 0}
                        className="w-full h-10 px-3 bg-card border border-border-subtle rounded-md text-sm text-foreground outline-none focus:border-transparent disabled:opacity-60"
                      >
                        <option value="" disabled>{instructors.length === 0 ? 'No hay instructores disponibles' : 'Selecciona un instructor'}</option>
                        {instructors.map((inst) => (
                          <option key={inst.id} value={inst.id}>{instructorLabel(inst)}</option>
                        ))}
                      </select>
                    )}
                  </div>
                )}
              </div>
              {formError && (
                <div className="flex items-center gap-2 text-xs text-danger bg-danger-soft border border-danger-border px-3 py-2 rounded-sm">
                  <AlertCircle className="w-3.5 h-3.5" /> {formError}
                </div>
              )}
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={onClose} className="px-5 py-2.5 border border-border-subtle text-muted-foreground text-sm font-bold uppercase tracking-tighter hover:border-primary/30 hover:text-primary transition-all">Cancelar</button>
                <button type="submit" disabled={saving} className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground text-sm font-bold uppercase tracking-tighter hover:bg-primary/80 transition-all disabled:opacity-50">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />} Guardar
                </button>
              </div>
            </form>
          </PanelModal>
      )}
    </AnimatePresence>
  );
}

function Field({ label, value, onChange }) {
  return (
    <label className="space-y-1 block">
      <span className="text-xs font-mono uppercase tracking-widest text-muted-foreground">{label}</span>
      <input
        value={value || ''}
        onChange={(e) => onChange(e.target.value.replace(/[<>{}]/g, ''))}
        className="w-full h-10 px-3 bg-surface-muted border border-border-subtle rounded-md text-sm text-foreground outline-none focus:border-transparent"
      />
    </label>
  );
}
