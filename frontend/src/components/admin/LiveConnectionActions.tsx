import React from 'react';
import { Ban, Eye, History, LogOut } from 'lucide-react';

type Session = { rol?: string; can_manage_session?: boolean };
export const canManageLiveSession = (record: Session, readOnly = false) =>
  !readOnly && record.can_manage_session === true && record.rol !== 'admin';

export default function LiveConnectionActions({ record, readOnly, onDetails, onFinish, onFinishAll, onBlock }: {
  record: Session; readOnly: boolean; onDetails: () => void; onFinish: () => void;
  onFinishAll: () => void; onBlock: () => void;
}) {
  const button = 'w-7 h-7 flex items-center justify-center border border-border-subtle rounded transition-all';
  return <>
    <button aria-label="Ver detalles" onClick={onDetails} title="Ver detalles" className={`${button} text-muted-foreground hover:border-primary/40 hover:text-brand-cyan-text`}><Eye className="w-3.5 h-3.5" /></button>
    {canManageLiveSession(record, readOnly) && <>
      <button aria-label="Finalizar sesión" onClick={onFinish} title="Finalizar sesión" className={`${button} text-warning hover:border-warning-border hover:bg-warning-soft`}><LogOut className="w-3.5 h-3.5" /></button>
      <button aria-label="Finalizar todas" onClick={onFinishAll} title="Finalizar todas" className={`${button} text-warning hover:border-warning-border hover:bg-warning-soft`}><History className="w-3.5 h-3.5" /></button>
      <button aria-label="Bloquear usuario" onClick={onBlock} title="Bloquear usuario" className={`${button} text-danger hover:border-danger-border hover:bg-danger-soft`}><Ban className="w-3.5 h-3.5" /></button>
    </>}
  </>;
}
