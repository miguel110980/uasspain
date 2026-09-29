const escapeCSV = (val) => {
  const s = val == null ? '' : String(val);
  if (/[",\n;]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
};

const escapeHtml = (val) => String(val ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const downloadBlob = (content, filename, mime) => {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

export const exportCSV = (rows, columns) => {
  const header = columns.map((c) => escapeCSV(c.label)).join(';');
  const body = rows
    .map((r) => columns.map((c) => escapeCSV(c.accessor(r))).join(';'))
    .join('\n');
  downloadBlob('\uFEFF' + header + '\n' + body, 'registro_conexiones.csv', 'text/csv;charset=utf-8;');
};

export const exportExcel = (rows, columns) => {
  const head = columns.map((c) => `<th style="background:#0a0e14;color:#00e5ff;padding:6px;border:1px solid #1c2330;font-family:Arial;">${escapeHtml(c.label)}</th>`).join('');
  const body = rows
    .map(
      (r) =>
        '<tr>' +
        columns.map((c) => `<td style="padding:6px;border:1px solid #1c2330;color:#ddd;font-family:Arial;">${escapeHtml(c.accessor(r) ?? '')}</td>`).join('') +
        '</tr>'
    )
    .join('');
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"></head><body><table>${head}${body}</table></body></html>`;
  downloadBlob(html, 'registro_conexiones.xls', 'application/vnd.ms-excel');
};

export const exportPDF = (rows, columns) => {
  const head = columns.map((c) => `<th>${escapeHtml(c.label)}</th>`).join('');
  const body = rows
    .map((r) => '<tr>' + columns.map((c) => `<td>${escapeHtml(c.accessor(r) ?? '')}</td>`).join('') + '</tr>')
    .join('');
  const printable = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Registro de Conexiones</title>
  <style>
    body { font-family: Arial, sans-serif; color: #222; margin: 24px; }
    h1 { font-size: 18px; margin-bottom: 4px; }
    .meta { font-size: 11px; color: #888; margin-bottom: 16px; }
    table { width: 100%; border-collapse: collapse; font-size: 10px; }
    th { background: #0a0e14; color: #00e5ff; text-align: left; padding: 6px 8px; border: 1px solid #ccc; white-space: nowrap; }
    td { padding: 5px 8px; border: 1px solid #ddd; white-space: nowrap; }
    tr:nth-child(even) { background: #f4f7fa; }
    @media print { body { margin: 0; } }
  </style></head><body>
  <h1>Registro de Conexiones</h1>
  <div class="meta">Generado: ${new Date().toLocaleString('es-ES')} · Registros: ${rows.length}</div>
  <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
  </body></html>`;
  const url = URL.createObjectURL(new Blob([printable], { type: 'text/html;charset=utf-8' }));
  const win = window.open('about:blank', '_blank');
  if (!win) {
    URL.revokeObjectURL(url);
    return;
  }
  win.opener = null;
  win.location.replace(url);
  window.setTimeout(() => {
    try {
      win.print();
    } finally {
      URL.revokeObjectURL(url);
    }
  }, 500);
};
