import type { ConformanceStatus, EarlOutcome, SignOff, SignOffSnapshot } from '../../types/audit.types';

const escapeHtml = (value: unknown): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const OUTCOME_LABEL: Record<EarlOutcome, string> = {
  passed: 'Cumple',
  failed: 'No cumple',
  cantTell: 'Sin decidir',
  inapplicable: 'No aplica',
  untested: 'Sin revisar',
};

/** Texto de la declaracion de accesibilidad del RD 1112/2018. */
export const CONFORMANCE_LABEL: Record<ConformanceStatus, string> = {
  full: 'Plenamente conforme',
  partial: 'Parcialmente conforme',
  'non-conformant': 'No conforme',
};

const formatDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('es-ES', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/Madrid' }) : '—';

const screen = (page: SignOffSnapshot['pages'][number]) =>
  page.device ?? (page.viewport ? `${page.viewport.width}×${page.viewport.height}` : '');

/**
 * Informe firmado, autocontenido para pasarlo a PDF. Sale todo de la copia
 * congelada (`snapshot`), nunca de la BD: el PDF tiene que decir lo mismo que
 * se firmo aunque despues cambien los hallazgos.
 */
export const signOffReportHtml = (signOff: SignOff, snapshot: SignOffSnapshot): string => {
  const pageIndex = new Map(snapshot.pages.map((page, index) => [page.id, index + 1]));
  const failures = snapshot.criteria.filter((criterion) => criterion.outcome === 'failed');

  const rows = snapshot.criteria
    .map(
      (criterion) => `
      <tr>
        <th scope="row">${escapeHtml(criterion.criterion)} ${escapeHtml(criterion.name)}${criterion.legal ? '' : ' <span class="tag">WCAG 2.2</span>'}</th>
        <td>${escapeHtml(criterion.level)}</td>
        <td class="o-${criterion.outcome}">${OUTCOME_LABEL[criterion.outcome]}</td>
        <td>${
          criterion.scope === 'site'
            ? criterion.outcome === 'failed'
              ? 'Sitio'
              : ''
            : Object.entries(criterion.byPage)
                .filter(([, outcome]) => outcome === 'failed')
                .map(([pageId]) => `P${pageIndex.get(pageId) ?? '?'}`)
                .join(', ')
        }</td>
      </tr>`,
    )
    .join('');

  const failureDetails = failures
    .map((criterion) => {
      const items = [
        ...Object.entries(criterion.axeViolations).map(
          ([pageId, rules]) => `<li><strong>P${pageIndex.get(pageId) ?? '?'}</strong> · axe: ${escapeHtml(rules.join(', '))}</li>`,
        ),
        ...criterion.findings
          .filter((finding) => finding.outcome === 'failed' && finding.review.status !== 'rejected')
          .map((finding) => {
            const where = finding.subject.kind === 'page' ? `P${pageIndex.get(finding.subject.pageId) ?? '?'}` : 'Sitio';
            return `<li><strong>${where}</strong> · ${escapeHtml(finding.description)}${
              finding.recommendation ? `<br><em>Cómo corregirlo:</em> ${escapeHtml(finding.recommendation)}` : ''
            }</li>`;
          }),
      ];
      return `<section class="failure"><h3>${escapeHtml(criterion.criterion)} ${escapeHtml(criterion.name)}</h3><ul>${items.join('')}</ul></section>`;
    })
    .join('');

  const { conformance } = snapshot;
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Informe de accesibilidad · ${escapeHtml(snapshot.site.name)}</title>
<style>
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
  tbody th { font-weight: normal; }
  .o-failed { color: #a4192b; font-weight: bold; }
  .o-passed { color: #1d6340; }
  .o-inapplicable { color: #5b626c; }
  .tag { font-size: 9px; color: #5b626c; border: 1px solid #e2e5ea; border-radius: 8px; padding: 0 4px; }
  .failure { page-break-inside: avoid; }
  code { font-family: Consolas, "Courier New", monospace; font-size: 10px; word-break: break-all; }
  .signature { margin-top: 24px; border: 1px solid #e2e5ea; border-radius: 6px; padding: 10px 12px; page-break-inside: avoid; }
</style>
</head>
<body>
  <h1>Informe de accesibilidad: ${escapeHtml(snapshot.site.name)}</h1>
  <p class="muted">${escapeHtml(snapshot.site.origins.join(', '))} · Catálogo ${escapeHtml(snapshot.catalog.id)} v${snapshot.catalog.version} · Firmado el ${escapeHtml(formatDate(signOff.signedAt))}</p>

  <div class="status s-${conformance.status}">${CONFORMANCE_LABEL[conformance.status]}</div>
  <p>
    Requisitos legales (WCAG 2.1 A y AA, por EN 301 549 v3.2.1): ${conformance.passed} cumplen, ${conformance.failed} no cumplen
    y ${conformance.inapplicable} no aplican, de ${conformance.applicable + conformance.inapplicable}.
    Criterios nuevos de WCAG 2.2, aún no exigibles: ${snapshot.wcag22.passed} cumplen o no aplican, ${snapshot.wcag22.failed} no cumplen.
  </p>
  <p class="muted">
    &laquo;No conforme&raquo; significa que falla la mitad o más de los requisitos que aplican; &laquo;parcialmente conforme&raquo;,
    que falla alguno pero menos de la mitad.
  </p>

  <h2>Muestra evaluada</h2>
  <table>
    <thead><tr><th>#</th><th>Página</th><th>Pantalla</th><th>Escaneada</th></tr></thead>
    <tbody>
      ${snapshot.pages
        .map(
          (page, index) => `<tr><td>P${index + 1}</td><td><code>${escapeHtml(page.url)}</code>${
            page.include ? `<br><span class="muted">Solo ${escapeHtml(page.include)}</span>` : ''
          }${page.exclude ? `<br><span class="muted">Excluye ${escapeHtml(page.exclude)}</span>` : ''}</td><td>${escapeHtml(screen(page))}</td><td>${escapeHtml(
            formatDate(page.finishedAt),
          )}</td></tr>`,
        )
        .join('')}
    </tbody>
  </table>

  <h2>Resultado por criterio</h2>
  <table>
    <thead><tr><th>Criterio</th><th>Nivel</th><th>Resultado</th><th>Falla en</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>

  ${failures.length > 0 ? `<h2>Incumplimientos</h2>${failureDetails}` : ''}

  <div class="signature">
    <p><strong>Firma:</strong> ${escapeHtml(signOff.signer)}${signOff.credential ? ` · ${escapeHtml(signOff.credential)}` : ''}</p>
    <p>${escapeHtml(signOff.statement)}</p>
    <p class="muted">Huella de lo firmado (SHA-256): <code>${escapeHtml(signOff.findingsHash)}</code></p>
  </div>
</body>
</html>`;
};
