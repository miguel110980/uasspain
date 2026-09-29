export type UserRole = 'admin' | 'instructor' | 'alumno';
export type AccountStatus = 'pendiente' | 'activo' | 'bloqueado' | 'rechazado';

export interface UserProfile {
  id: string;
  user_id: number | null;
  nombre: string;
  apellidos: string;
  email: string;
  username: string;
  dni_nie: string;
  fecha_nacimiento: string | null;
  foto_perfil: string;
  status: AccountStatus;
  role: UserRole;
  roles: UserRole[];
  session_role?: UserRole | '';
  assigned_instructor_id: string | null;
  created_date: string;
}

export interface AuthSession {
  id: string;
  user_id: number;
  email: string;
  full_name: string;
  role: UserRole;
  roles: UserRole[];
  session_role: UserRole | '';
  status: AccountStatus;
  profile: UserProfile;
}

export interface ExamAnswer {
  question_id: string;
  answer: 'A' | 'B' | 'C' | 'D' | null;
}

export interface ExamResult {
  aciertos: number;
  errores: number;
  porcentaje: number;
  nota: number;
  aprobado: boolean;
}

export type ChatEvent =
  | { type: 'ping' }
  | { type: 'pong' }
  | { type: 'message'; room_id: string; sender_id: string; content: string }
  | { type: 'ack'; room_id: string };

export type BackupDestination = 'local' | 'remote1' | 'remote2';
export type BackupKind = 'full' | 'incremental';

export interface ApiErrorBody {
  detail: string;
  code?: string;
  correlation_id?: string;
}

