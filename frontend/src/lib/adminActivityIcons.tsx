import {
  Activity,
  Award,
  BookOpen,
  ClipboardList,
  LogIn,
  UserPlus,
} from 'lucide-react';

/** @typedef {import('./adminActivity').ActivityTipo} ActivityTipo */

/** @type {Record<ActivityTipo, typeof Activity>} */
export const ACTIVITY_ICON_MAP = {
  login: LogIn,
  user: UserPlus,
  material: BookOpen,
  examen: ClipboardList,
  resultado: Award,
};

/**
 * @param {ActivityTipo} tipo
 */
export function getActivityIcon(tipo) {
  return ACTIVITY_ICON_MAP[tipo] ?? Activity;
}
