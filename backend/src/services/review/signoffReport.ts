import { BASE_STYLES, escapeHtml, formatDate, LEGAL_BASIS, notLegalTag, screenLabel } from '../report/reportBase';
import type { ConformanceStatus, EarlOutcome, SignOff, SignOffSnapshot } from '../../types/audit.types';

export const OUTCOME_LABEL: Record<EarlOutcome, string> = {
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

const tagOf = (criterion: SignOffSnapshot['criteria'][number]) => notLegalTag(criterion.legal, criterion.level);

const screen = (page: SignOffSnapshot['pages'][number]) => screenLabel(page.device, page.viewport);

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
        <th scope="row">${escapeHtml(criterion.criterion)} ${escapeHtml(criterion.name)}${tagOf(criterion)}</th>
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
<style>${BASE_STYLES}</style>
</head>
<body>
  <h1>Informe de accesibilidad: ${escapeHtml(snapshot.site.name)}</h1>
  <p class="muted">${escapeHtml(snapshot.site.origins.join(', '))} · Catálogo ${escapeHtml(snapshot.catalog.id)} v${snapshot.catalog.version} · Firmado el ${escapeHtml(formatDate(signOff.signedAt))}</p>

  <div class="status s-${conformance.status}">${CONFORMANCE_LABEL[conformance.status]}</div>
  <p>
    Requisitos legales (${LEGAL_BASIS}): ${conformance.passed} cumplen, ${conformance.failed} no cumplen
    y ${conformance.inapplicable} no aplican, de ${conformance.applicable + conformance.inapplicable}.
    Criterios nuevos de WCAG 2.2, aún no exigibles: ${snapshot.wcag22.passed} cumplen o no aplican, ${snapshot.wcag22.failed} no cumplen.
    ${
      snapshot.aaa
        ? `Criterios AAA, no exigibles legalmente: ${snapshot.aaa.passed} cumplen o no aplican, ${snapshot.aaa.failed} no cumplen.`
        : ''
    }
  </p>
  <p class="muted">
    &laquo;No conforme&raquo; significa que falla la mitad o más de los requisitos que aplican; &laquo;parcialmente conforme&raquo;,
    que falla alguno pero menos de la mitad. Es la regla de la metodología de seguimiento simplificado del Observatorio
    de Accesibilidad Web, que concreta la &laquo;mayoría de los requisitos&raquo; del modelo de declaración
    (Decisión de Ejecución (UE) 2018/1523).
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
