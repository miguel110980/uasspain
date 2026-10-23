import React, { useState } from 'react';
import { FileDown, Loader2 } from 'lucide-react';
import { exportChatConversationPdf } from '@/lib/exportChatPdf';

/**
 * @param {{
 *   title: string,
 *   subtitle?: string,
 *   participantA?: string,
 *   participantB?: string,
 *   messages: object[],
 *   mapMessage?: (msg: object) => { author: string, content: string, created_date: string },
 *   disabled?: boolean,
 *   className?: string,
 * }} props
 */
type ChatExportPdfButtonProps = {
  title: string;
  subtitle?: string;
  participantA?: string;
  participantB?: string;
  messages: any[];
  mapMessage?: (message: any) => { author: string; content: string; created_date: string };
  disabled?: boolean;
  className?: string;
};

export default function ChatExportPdfButton({
  title,
  subtitle = '',
  participantA,
  participantB,
  messages,
  mapMessage,
  disabled = false,
  className = '',
}: ChatExportPdfButtonProps) {
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');

  const handleExport = () => {
    setError('');
    const rows = (messages || []).map((msg) => (
      mapMessage ? mapMessage(msg) : {
        author: String(msg.author || msg.remitente || '—'),
        content: String(msg.content || msg.texto || ''),
        created_date: msg.created_date,
      }
    ));
    if (!rows.length) {
      setError('No hay mensajes para exportar.');
      return;
    }
    setExporting(true);
    try {
      const ok = exportChatConversationPdf({
        title,
        subtitle,
        participantA,
        participantB,
        messages: rows,
      });
      if (!ok) setError('No se pudo generar el PDF.');
    } catch {
      setError('Error al exportar la conversación.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className={`flex flex-col items-end gap-1 ${className}`}>
      <button aria-label="Exportar conversación a PDF"
        type="button"
        onClick={handleExport}
        disabled={disabled || exporting || !messages?.length}
        title="Exportar conversación a PDF"
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-mono uppercase tracking-widest border border-border-subtle text-muted-foreground hover:border-primary/40 hover:text-brand-cyan-text transition-colors rounded-sm disabled:opacity-40 disabled:pointer-events-none"
      >
        {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileDown className="w-3.5 h-3.5" />}
        PDF
      </button>
      {error && <p className="text-[10px] text-destructive max-w-[12rem] text-right">{error}</p>}
    </div>
  );
}
