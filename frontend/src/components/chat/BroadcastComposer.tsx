import SuccessNotice from '@/components/ui/SuccessNotice';
import React, { useMemo, useState } from 'react';
import { Loader2, Send, Users, X } from 'lucide-react';
import { sanitizeInput } from '@/lib/sanitize';
import { profileDisplayName } from '@/lib/staffChat';

export default function BroadcastComposer({ recipients, title, description, onSend }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');
  const ordered = useMemo(
    () => [...recipients].sort((a, b) => profileDisplayName(a).localeCompare(profileDisplayName(b), 'es')),
    [recipients],
  );

  if (!ordered.length) return null;

  const toggle = (id) => {
    setSelected((current) => {
      const next = new Set(current);
      const key = String(id);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const submit = async (event) => {
    event.preventDefault();
    const contenido = sanitizeInput(message, 'message').trim();
    if (!contenido || selected.size === 0 || sending) return;
    setSending(true);
    setError('');
    setFeedback('');
    try {
      await onSend([...selected], contenido);
      setFeedback(`Mensaje enviado a ${selected.size} destinatario(s).`);
      setMessage('');
      setSelected(new Set());
    } catch (err) {
      setError(err?.response?.data?.detail || err?.message || 'No se pudo enviar el mensaje.');
    } finally {
      setSending(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 border border-primary/30 bg-primary/5 px-4 py-2 text-xs font-bold uppercase tracking-widest text-primary hover:bg-primary/10"
      >
        <Users className="h-4 w-4" /> Enviar a varios
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="glass-card space-y-4 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-heading text-base font-bold text-foreground">{title}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        </div>
        <button type="button" onClick={() => setOpen(false)} aria-label="Cerrar difusión">
          <X className="h-4 w-4 text-muted-foreground" />
        </button>
      </div>
      <div className="grid max-h-40 gap-2 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
        {ordered.map((recipient) => {
          const id = String(recipient.id);
          return (
            <label key={id} className="flex cursor-pointer items-center gap-2 border border-border-subtle p-2 text-xs text-foreground">
              <input type="checkbox" checked={selected.has(id)} onChange={() => toggle(id)} />
              <span className="truncate">{profileDisplayName(recipient)}</span>
            </label>
          );
        })}
      </div>
      <div className="flex gap-2 text-xs">
        <button type="button" onClick={() => setSelected(new Set(ordered.map((item) => String(item.id))))} className="text-primary">Seleccionar todos</button>
        <button type="button" onClick={() => setSelected(new Set())} className="text-muted-foreground">Limpiar selección</button>
      </div>
      <textarea aria-label="Escribe el mensaje para los destinatarios seleccionados…"
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        maxLength={4000}
        placeholder="Escribe el mensaje para los destinatarios seleccionados…"
        className="min-h-24 w-full border border-border-subtle bg-surface-muted p-3 text-sm text-foreground outline-none focus:border-primary/40"
      />
      {error && <p className="text-xs text-danger">{error}</p>}
      {feedback && <SuccessNotice message={feedback} onDismiss={() => setFeedback('')} />}
      <button
        type="submit"
        disabled={sending || selected.size === 0 || !message.trim()}
        className="inline-flex items-center gap-2 bg-primary px-4 py-2 text-xs font-bold uppercase tracking-widest text-primary-foreground disabled:opacity-50"
      >
        {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        Enviar a {selected.size || 0}
      </button>
    </form>
  );
}
