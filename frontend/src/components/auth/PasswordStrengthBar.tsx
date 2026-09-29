import React from 'react';
import { assessPasswordStrength } from '@/lib/passwordStrength';

const COLORS = {
  weak: 'bg-danger',
  medium: 'bg-warning',
  strong: 'bg-success',
};

const TEXT = {
  weak: 'text-danger',
  medium: 'text-warning',
  strong: 'text-success',
};

export default function PasswordStrengthBar({ password, username = '', email = '', dni = '' }) {
  if (!password) return null;

  const { level, label, hints } = assessPasswordStrength(password, { username, email, dni });
  const width = level === 'weak' ? '33%' : level === 'medium' ? '66%' : '100%';

  return (
    <div className="mt-1.5 space-y-1">
      <div className="h-1.5 w-full bg-surface-muted border border-border-subtle rounded-full overflow-hidden">
        <div className={`h-full transition-all duration-300 ${COLORS[level]}`} style={{ width }} />
      </div>
      <p className={`text-[10px] font-mono uppercase tracking-widest ${TEXT[level]}`}>
        Fortaleza: {label}
      </p>
      {hints.length > 0 && (
        <p className="text-[10px] text-muted-foreground leading-relaxed">{hints.join(' ')}</p>
      )}
    </div>
  );
}
