import { jsPDF } from 'jspdf';

const PAGE_MARGIN = 14;
const LINE_HEIGHT = 5;
const CONTENT_WIDTH = 182;

/** @param {string | number | Date} value */
function formatMessageDateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/** @param {string} value */
function safeFilenamePart(value) {
  return (value || 'conversacion')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 48) || 'conversacion';
}

/**
 * @param {object} options
 * @param {string} options.title
 * @param {string} [options.subtitle]
 * @param {string} [options.participantA]
 * @param {string} [options.participantB]
 * @param {Array<{ author: string, content: string, created_date: string }>} options.messages
 * @param {string} [options.filename]
 */
type ExportChatOptions = {
  title: string;
  subtitle?: string;
  participantA?: string;
  participantB?: string;
  messages?: Array<{ author: string; content: string; created_date: string }>;
  filename?: string;
};

export function exportChatConversationPdf({
  title,
  subtitle = '',
  participantA = '',
  participantB = '',
  messages = [],
  filename,
}: ExportChatOptions) {
  if (!messages.length) {
    return false;
  }

  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  let y = PAGE_MARGIN;

  const ensureSpace = (needed) => {
    if (y + needed <= 287) return;
    doc.addPage();
    y = PAGE_MARGIN;
  };

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(title || 'Conversación', PAGE_MARGIN, y);
  y += 8;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(80, 80, 80);

  if (subtitle) {
    doc.text(subtitle, PAGE_MARGIN, y);
    y += 5;
  }
  if (participantA && participantB) {
    doc.text(`Participantes: ${participantA} ↔ ${participantB}`, PAGE_MARGIN, y);
    y += 5;
  }
  doc.text(`Exportado: ${formatMessageDateTime(new Date())} · Mensajes: ${messages.length}`, PAGE_MARGIN, y);
  y += 8;

  doc.setDrawColor(200, 200, 200);
  doc.line(PAGE_MARGIN, y, PAGE_MARGIN + CONTENT_WIDTH, y);
  y += 6;

  doc.setTextColor(30, 30, 30);

  messages.forEach((msg) => {
    const author = String(msg.author || '—');
    const content = String(msg.content || '').trim() || '(sin contenido)';
    const when = formatMessageDateTime(msg.created_date);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    const header = `${author}  ·  ${when}`;
    const headerLines = doc.splitTextToSize(header, CONTENT_WIDTH);
    ensureSpace(headerLines.length * LINE_HEIGHT + 12);
    doc.text(headerLines, PAGE_MARGIN, y);
    y += headerLines.length * LINE_HEIGHT + 1;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    const bodyLines = doc.splitTextToSize(content, CONTENT_WIDTH);
    ensureSpace(bodyLines.length * LINE_HEIGHT + 8);
    doc.text(bodyLines, PAGE_MARGIN, y);
    y += bodyLines.length * LINE_HEIGHT + 6;
  });

  const stamp = new Date();
  const defaultName = [
    safeFilenamePart(title),
    safeFilenamePart(participantB || participantA),
    stamp.toISOString().slice(0, 10),
  ].filter(Boolean).join('-');

  doc.save(filename || `${defaultName}.pdf`);
  return true;
}
