import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle, X } from 'lucide-react';
import { CLEAR_SUCCESS_FEEDBACK, SUCCESS_FEEDBACK_DURATION } from '@/lib/successFeedback';
import { cn } from '@/lib/utils';

export default function SuccessNotice({ message, onDismiss, className }: { message: string; onDismiss?: () => void; className?: string }) {
  const [hidden, setHidden] = useState(false);
  const [focused, setFocused] = useState(false);
  const callback = useRef(onDismiss);
  callback.current = onDismiss;
  const origin = useRef(typeof document === 'undefined' ? null : document.activeElement as HTMLElement | null);
  const close = useCallback(() => { setHidden(true); callback.current?.(); }, []);
  useEffect(() => { setHidden(false); }, [message]);
  useEffect(() => {
    if (hidden || focused) return;
    const timer = window.setTimeout(close, SUCCESS_FEEDBACK_DURATION);
    return () => window.clearTimeout(timer);
  }, [message, hidden, focused, close]);
  useEffect(() => {
    window.addEventListener(CLEAR_SUCCESS_FEEDBACK, close);
    return () => window.removeEventListener(CLEAR_SUCCESS_FEEDBACK, close);
  }, [close]);
  if (hidden) return null;
  return <div role="status" aria-live="polite" aria-atomic="true"
    onFocusCapture={() => setFocused(true)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}
    className={cn('flex min-w-0 items-start gap-2 rounded border border-success-border bg-success-soft px-3 py-2 text-sm text-success', className)}>
    <CheckCircle aria-hidden="true" className="mt-1 h-4 w-4 shrink-0" />
    <span className="min-w-0 flex-1 break-words">{message}</span>
    <button type="button" aria-label="Cerrar mensaje de éxito" onClick={() => { close(); if (origin.current?.isConnected && origin.current !== document.body) origin.current.focus(); }}
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current">
      <X aria-hidden="true" className="h-4 w-4" />
    </button>
  </div>;
}
