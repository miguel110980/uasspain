import { primaryRole, roleDisplayLabel, ROLE_BADGE_CLASS, ROLE_LABELS } from '@/lib/roles';

/**
 * @param {{ profile?: object | null, role?: string, className?: string }} props
 */
export default function RoleBadge({ profile, role, className = '' }: { profile?: any; role?: string; className?: string }) {
  const key = role || (profile ? primaryRole(profile) : 'alumno');
  const label = role ? (ROLE_LABELS[role] || role) : roleDisplayLabel(profile);
  const style = ROLE_BADGE_CLASS[key] || ROLE_BADGE_CLASS.alumno;

  return (
    <span
      className={`inline-block shrink-0 px-1.5 py-0.5 text-[9px] font-mono uppercase border rounded ${style} ${className}`}
    >
      {label}
    </span>
  );
}
