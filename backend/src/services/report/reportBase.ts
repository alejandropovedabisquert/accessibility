/**
 * Piezas comunes de los informes en PDF (auditoria y firma). Van juntas para
 * que los dos se sigan pareciendo: si cambias el aspecto de uno, cambia aqui.
 */

export const escapeHtml = (value: unknown): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export const formatDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('es-ES', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/Madrid' }) : '—';

/**
 * Pie de cada hoja del PDF. Chromium lo pinta fuera del documento, asi que no
 * hereda sus estilos: el tamano de letra hay que darlo aqui o sale a 0.
 */
export const footerTemplate = (text: string) => `
  <div style="font-family: 'Trebuchet MS', sans-serif; font-size: 8px; color: #5b626c; width: 100%; padding: 0 10mm; display: flex; justify-content: space-between;">
    <span>${escapeHtml(text)}</span>
    <span><span class="pageNumber"></span> / <span class="totalPages"></span></span>
  </div>`;

export const BASE_STYLES = `
  body { font-family: "Trebuchet MS", "Lucida Sans Unicode", sans-serif; color: #16191d; font-size: 11px; line-height: 1.45; margin: 0; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  h2 { font-size: 15px; margin: 22px 0 8px; border-bottom: 1px solid #e2e5ea; padding-bottom: 4px; }
  h3 { font-size: 12px; margin: 12px 0 4px; }
  .muted { color: #5b626c; }
  .status { display: inline-block; font-size: 16px; font-weight: bold; padding: 6px 12px; border-radius: 6px; margin: 8px 0; }
  .s-full { background: #e6f4ec; color: #1d6340; }
  .s-partial { background: #fbf5df; color: #6b5500; }
  .s-non-conformant { background: #fdeaec; color: #a4192b; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 3px 6px; border-bottom: 1px solid #e2e5ea; vertical-align: top; }
  thead th { font-size: 10px; color: #5b626c; text-transform: uppercase; }
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; }
  tbody th { font-weight: normal; }
  .o-failed { color: #a4192b; font-weight: bold; }
  .o-passed { color: #1d6340; }
  .o-cantTell { color: #6b5500; }
  .o-inapplicable { color: #5b626c; }
  .tag { font-size: 9px; color: #5b626c; border: 1px solid #e2e5ea; border-radius: 8px; padding: 0 4px; white-space: nowrap; }
  .failure { page-break-inside: avoid; }
  code { font-family: Consolas, "Courier New", monospace; font-size: 10px; word-break: break-all; }
  .signature { margin-top: 24px; border: 1px solid #e2e5ea; border-radius: 6px; padding: 10px 12px; page-break-inside: avoid; }
  .notice { border: 1px solid #e2e5ea; border-left: 4px solid #6b5500; background: #fbf5df; border-radius: 6px; padding: 8px 12px; margin: 12px 0; }
`;
