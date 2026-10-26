import type { Audit, AuditPage, AxeResults, Check, Impact, RuleLevel } from '../../types/audit.types';
import { catalog, checksForAxeRule } from '../review/catalog';
import { aggregateCompliance, computeCompliance } from '../audit/summary';
import { complianceGroup } from '../audit/levels';
import { buildAuditExport, summarizeByRule, type ImprovementSummary } from '../export/aggregate';
import { scopeWarnings, type CompactPageInfo } from '../export/compact';
import { BASE_STYLES, escapeHtml, formatDate, LEGAL_BASIS, notLegalTag, screenLabel } from './reportBase';
import { displayUrl } from '../../utils/url';

export interface AuditReportPage {
  page: AuditPage;
  info: CompactPageInfo;
  /** null si la pagina no se pudo escanear o ya no se conserva su JSON. */
  results: AxeResults | null;
}

export interface AuditReportInput {
  audit: Audit;
  /** Todas las paginas en el orden de la auditoria: su posicion da el P1..Pn del informe. */
  pages: AuditReportPage[];
}

/** Elementos de ejemplo por regla. Mas no ayuda a corregir y engorda el PDF. */
export const MAX_EXAMPLES = 5;

/** Columnas de pagina por tabla de la matriz: con mas no caben en un A4 vertical. */
const PAGES_PER_MATRIX = 18;

/**
 * Lo que axe dice de un criterio en una pagina, de peor a mejor. `passed` no es
 * "cumple": es que las reglas automaticas no encuentran fallos, y eso nunca
 * cubre el criterio entero.
 */
type Cell = 'failed' | 'cantTell' | 'passed' | 'inapplicable';
const CELL_ORDER: readonly Cell[] = ['failed', 'cantTell', 'passed', 'inapplicable'];

const CELL_SHORT: Record<Cell, string> = { failed: 'F', cantTell: 'R', passed: '✓', inapplicable: '–' };
const CELL_LABEL: Record<Cell, string> = {
  failed: 'Fallo detectado',
  cantTell: 'Revisar',
  passed: 'Sin fallos detectados',
  inapplicable: 'No aplica',
};

const IMPACT_LABEL: Record<Impact, string> = { critical: 'crítico', serious: 'grave', moderate: 'moderado', minor: 'leve' };
const LEVEL_LABEL: Record<RuleLevel, string> = { A: 'A', AA: 'AA', AAA: 'AAA', 'best-practice': 'Buena práctica' };

const worst = (a: Cell | undefined, b: Cell): Cell =>
  a !== undefined && CELL_ORDER.indexOf(a) <= CELL_ORDER.indexOf(b) ? a : b;

/** Estado de cada criterio del catalogo en una pagina; los que ninguna regla ejecutada toca no estan. */
const cellsOf = (results: AxeResults): Map<string, Cell> => {
  const cells = new Map<string, Cell>();
  const mark = (rules: AxeResults['violations'], cell: Cell) => {
    for (const rule of rules) {
      for (const check of checksForAxeRule(rule.id)) cells.set(check.id, worst(cells.get(check.id), cell));
    }
  };
  mark(results.violations, 'failed');
  mark(results.incomplete, 'cantTell');
  mark(results.passes, 'passed');
  mark(results.inapplicable, 'inapplicable');
  return cells;
};

const isLegal = (check: Check) => check.en301549 !== null;

const tagOf = (check: Check) => notLegalTag(isLegal(check), check.level);

const screenOf = ({ page, info }: AuditReportPage) => screenLabel(page.device, info.viewport);

/** `[1, 2, 3, 5]` → `P1–P3, P5`. */
export const pageRanges = (numbers: number[]): string => {
  const sorted = [...new Set(numbers)].sort((a, b) => a - b);
  const ranges: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i] as number;
    let end = start;
    while (sorted[i + 1] === end + 1) end = sorted[++i] as number;
    ranges.push(end === start ? `P${start}` : end === start + 1 ? `P${start}, P${end}` : `P${start}–P${end}`);
  }
  return ranges.join(', ');
};

const chunk = <T>(items: T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));

const requirements = (n: number) => (n === 1 ? 'requisito legal' : 'requisitos legales');

const percent = (score: number | null) => (score === null ? 'n/d' : `${score} %`);

/** La etiqueta de la auditoria o, sin ella, los dominios analizados. */
export const reportName = (audit: Pick<Audit, 'label'>, pages: Array<Pick<AuditPage, 'host'>>) =>
  audit.label ?? [...new Set(pages.map((page) => page.host))].join(', ');

/**
 * Informe de una auditoria entera, autocontenido para pasarlo a PDF. Sigue la
 * estructura de los informes automaticos del Observatorio de Accesibilidad Web
 * (muestra, resumen, matriz criterio × pagina e incidencias) con el aspecto del
 * informe de la firma. A proposito no da un estado de conformidad: con lo que
 * detecta axe no se puede decir, y contradiria al de la firma.
 */
export const auditReportHtml = ({ audit, pages }: AuditReportInput, generatedAt: string): string => {
  const name = reportName(audit, pages.map(({ page }) => page));
  const scanned = pages
    .map((entry, index) => ({ ...entry, number: index + 1 }))
    .filter((entry): entry is AuditReportPage & { number: number; results: AxeResults } => entry.results !== null);
  const failed = pages.map((entry, index) => ({ ...entry, number: index + 1 })).filter((entry) => entry.results === null);

  // --- Matriz criterio × pagina ---
  const pageCells = scanned.map(({ results }) => cellsOf(results));
  const rows = catalog.checks.flatMap((check) => {
    const cells = pageCells.map((cells) => cells.get(check.id));
    const site = cells.reduce<Cell | undefined>((acc, cell) => (cell ? worst(acc, cell) : acc), undefined);
    return site ? [{ check, cells, site }] : [];
  });
  const legalRows = rows.filter(({ check }) => isLegal(check));
  const otherRows = rows.filter(({ check }) => !isLegal(check));
  const count = (list: typeof rows, cell: Cell) => list.filter((row) => row.site === cell).length;
  const legalChecks = catalog.checks.filter(isLegal).length;

  const matrix = (list: typeof rows) =>
    chunk(scanned.map((entry, index) => ({ ...entry, index })), PAGES_PER_MATRIX)
      .map(
        (columns) => `
    <table class="matrix">
      <thead><tr><th>Criterio</th><th>Sitio</th>${columns.map(({ number }) => `<th class="c">P${number}</th>`).join('')}</tr></thead>
      <tbody>${list
        .map(
          ({ check, cells, site }) => `
        <tr>
          <th scope="row">${escapeHtml(check.criterion)} ${escapeHtml(check.name)} <span class="muted">(${check.level})</span>${tagOf(check)}</th>
          <td class="o-${site}">${CELL_LABEL[site]}</td>
          ${columns
            .map(({ index }) => {
              const cell = cells[index];
              return cell ? `<td class="c x-${cell}">${CELL_SHORT[cell]}</td>` : '<td class="c"></td>';
            })
            .join('')}
        </tr>`,
        )
        .join('')}</tbody>
    </table>`,
      )
      .join('');

  // --- Incidencias agrupadas por regla entre paginas ---
  const grouped = buildAuditExport({
    audit: { id: audit.id, label: audit.label, createdAt: audit.createdAt, status: audit.status },
    tags: audit.config.tags,
    pages: scanned.map(({ info, results }) => ({ info, results })),
    failedPages: [],
    maxNodes: MAX_EXAMPLES,
  });
  const byRule = summarizeByRule(grouped.findings, MAX_EXAMPLES);
  const numbersOf = (entry: ImprovementSummary) => entry.pages.map((index) => scanned[index]?.number ?? 0);
  const isLegalLevel = (level: RuleLevel) => complianceGroup(level) === 'legal';
  const failures = byRule.filter((entry) => entry.status === 'fail');
  const reviews = byRule.filter((entry) => entry.status === 'needs-review');

  const criteriaOf = (rule: string) =>
    checksForAxeRule(rule)
      .map((check) => `${check.criterion} ${check.name}`)
      .join(' · ');

  const incident = (entry: ImprovementSummary) => {
    const criteria = criteriaOf(entry.rule);
    return `
    <section class="failure">
      <h3>${escapeHtml(entry.help)}</h3>
      <p class="muted">
        <code>${escapeHtml(entry.rule)}</code> · ${criteria ? `${escapeHtml(criteria)} · ` : ''}Nivel ${LEVEL_LABEL[entry.level]}${
          entry.impact ? ` · Impacto ${IMPACT_LABEL[entry.impact]}` : ''
        }<br>
        En ${escapeHtml(pageRanges(numbersOf(entry)))} · ${entry.count} ${entry.count === 1 ? 'elemento' : 'elementos'}${
          entry.groups > 1 ? `, ${entry.groups} distintos` : ''
        } · <a href="${escapeHtml(entry.helpUrl)}">Documentación</a>
      </p>
      <ul class="examples">${entry.nodes
        .map(
          (node) =>
            `<li>
          <p class="selector"><span class="label">Selector</span><code>${escapeHtml(node.selector)}</code></p>
          <pre class="snippet"><code>${escapeHtml(node.html)}</code></pre>
          ${node.message ? `<p class="reason"><span class="label">Motivo</span>${escapeHtml(node.message)}</p>` : ''}
        </li>`,
        )
        .join('')}</ul>
    </section>`;
  };

  const legalFailures = failures.filter((entry) => isLegalLevel(entry.level));
  const otherFailures = failures.filter((entry) => !isLegalLevel(entry.level));

  // --- Resumen ---
  const compliances = scanned.map(({ results }) => computeCompliance(results));
  const total = aggregateCompliance(compliances);
  const warnings = [...new Set(scanned.flatMap(({ info }) => scopeWarnings(info)))];
  const axeVersion = scanned[0]?.results.testEngine?.version ?? 'desconocida';
  const scannedAt = audit.finishedAt ?? audit.createdAt;

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Informe de accesibilidad · ${escapeHtml(name)}</title>
<style>
  ${BASE_STYLES}
  .cover { min-height: 250mm; display: flex; flex-direction: column; page-break-after: always; }
  .cover .eyebrow { text-transform: uppercase; letter-spacing: 0.08em; color: #5b626c; font-size: 11px; margin: 40mm 0 6px; }
  .cover h1 { font-size: 30px; line-height: 1.2; }
  .cover dl { display: grid; grid-template-columns: max-content 1fr; gap: 4px 16px; margin: 24px 0; font-size: 12px; }
  .cover dt { color: #5b626c; }
  .cover dd { margin: 0; }
  .cover nav { margin-top: auto; }
  .cover nav ol { padding-left: 18px; }
  .cover nav a { color: inherit; text-decoration: none; }
  .chapter { page-break-before: always; }
  h2, h3 { break-after: avoid; page-break-after: avoid; }
  .kpis { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin: 10px 0 14px; }
  .kpi { border: 1px solid #e2e5ea; border-radius: 6px; padding: 8px 12px; }
  .kpi strong { display: block; font-size: 20px; }
  .num { text-align: right; }
  .matrix { margin-bottom: 14px; font-size: 9.5px; }
  .matrix th, .matrix td { padding: 2px 4px; }
  .matrix .c { text-align: center; width: 22px; }
  .x-failed { background: #fdeaec; color: #a4192b; font-weight: bold; }
  .x-cantTell { background: #fbf5df; color: #6b5500; }
  .x-passed { color: #1d6340; }
  .x-inapplicable { color: #5b626c; }
  .legend { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 10px; color: #5b626c; margin: 4px 0 12px; }
  .examples { list-style: none; padding: 0; margin: 6px 0 0; }
  .examples li { border: 1px solid #e2e5ea; border-radius: 6px; padding: 6px 8px; margin-bottom: 6px; page-break-inside: avoid; }
  .examples p { margin: 0; }
  .label { display: inline-block; font-size: 8.5px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.04em; color: #5b626c; margin-right: 6px; }
  .selector code { background: #eef1f6; color: #1f4f8a; border-radius: 4px; padding: 1px 5px; }
  .snippet { margin: 5px 0; padding: 6px 8px; background: #f4f5f7; border-left: 3px solid #1f4f8a; border-radius: 0 4px 4px 0; white-space: pre-wrap; word-break: break-all; }
  .snippet code { font-size: 9.5px; color: #16191d; }
  .reason { color: #3b4048; }
  .failure { border-bottom: 1px solid #e2e5ea; padding-bottom: 6px; }
  a { color: #1f4f8a; }
</style>
</head>
<body>
  <section class="cover">
    <p class="eyebrow">Informe de accesibilidad · Análisis automático</p>
    <h1>${escapeHtml(name)}</h1>
    <dl>
      <dt>Páginas analizadas</dt><dd>${scanned.length}${failed.length > 0 ? ` (${failed.length} no se pudieron escanear)` : ''}</dd>
      <dt>Fecha del análisis</dt><dd>${escapeHtml(formatDate(scannedAt))}</dd>
      <dt>Normas</dt><dd>${escapeHtml(audit.config.tags.join(', '))}</dd>
      <dt>Herramienta</dt><dd>axe-core ${escapeHtml(axeVersion)}</dd>
      <dt>Informe generado</dt><dd>${escapeHtml(formatDate(generatedAt))}</dd>
    </dl>
    <div class="notice">
      Este informe recoge solo lo que detecta una herramienta automática, y sus resultados son
      <strong>estimados</strong>: las reglas automáticas solo cubren en parte ${legalRows.length} de los
      ${legalChecks} requisitos legales, y el resto exige revisión manual. <strong>No es</strong> la revisión de accesibilidad
      del artículo 17 del RD 1112/2018 ni sirve para declarar la conformidad: eso sale de la revisión manual y su firma.
    </div>
    <nav aria-label="Contenido">
      <h2>Contenido</h2>
      <ol>
        <li><a href="#muestra">Muestra analizada</a></li>
        <li><a href="#resumen">Resumen de resultados</a></li>
        <li><a href="#matriz">Resultados por criterio y página</a></li>
        <li><a href="#incidencias">Incidencias</a></li>
        ${reviews.length > 0 ? '<li><a href="#revisar">Pendiente de revisión manual</a></li>' : ''}
        <li><a href="#metodologia">Metodología</a></li>
      </ol>
    </nav>
  </section>

  <h2 id="muestra">1. Muestra analizada</h2>
  <table>
    <thead><tr><th>#</th><th>Página</th><th>Pantalla</th><th>Escaneada</th></tr></thead>
    <tbody>
      ${pages
        .map((entry, index) => {
          const { page, results } = entry;
          return `<tr><td>P${index + 1}</td><td><code>${escapeHtml(page.url)}</code>${
            page.include ? `<br><span class="muted">Solo ${escapeHtml(page.include)}</span>` : ''
          }${page.exclude ? `<br><span class="muted">Excluye ${escapeHtml(page.exclude)}</span>` : ''}${
            results
              ? ''
              : `<br><span class="o-failed">${page.status === 'completed' ? 'No se conserva el resultado' : 'No se pudo escanear'}</span>${
                  page.error ? ` <span class="muted">· ${escapeHtml(page.error)}</span>` : ''
                }`
          }</td><td>${escapeHtml(screenOf(entry))}</td><td>${escapeHtml(formatDate(page.finishedAt))}</td></tr>`;
        })
        .join('')}
    </tbody>
  </table>
  ${failed.length > 0 ? `<p class="muted">Las páginas sin resultado no aparecen en el resto del informe.</p>` : ''}

  <h2 id="resumen">2. Resumen de resultados</h2>
  <div class="kpis">
    <div class="kpi"><strong>${percent(total?.legal.score ?? null)}</strong>reglas superadas de WCAG A y AA (media de las páginas)</div>
    <div class="kpi"><strong>${count(legalRows, 'failed')}</strong>${requirements(count(legalRows, 'failed'))} con fallos detectados, de ${legalRows.length} que comprueba axe</div>
    <div class="kpi"><strong>${count(legalRows, 'cantTell')}</strong>${requirements(count(legalRows, 'cantTell'))} que axe no pudo decidir: hay que revisarlos</div>
  </div>
  <p class="muted">
    &laquo;Reglas superadas&raquo; es reglas que pasan entre reglas que pasan o fallan; las que no aplican o axe no pudo
    decidir no cuentan. No es una puntuación ponderada: se puede comprobar contra el resultado de axe de cada página.
    AAA y buenas prácticas van aparte (${percent(total?.improvements.score ?? null)}) porque no son exigibles legalmente.
  </p>
  <table>
    <thead><tr><th>#</th><th>Página</th><th class="num">Reglas superadas A/AA</th><th class="num">Reglas con fallo</th><th class="num">Elementos</th><th class="num">Críticas</th><th class="num">Graves</th><th class="num">A revisar</th></tr></thead>
    <tbody>
      ${scanned
        .map(({ number, page }, index) => {
          const legal = compliances[index]?.legal;
          return `<tr><td>P${number}</td><td>${escapeHtml(displayUrl(page.url))}</td><td class="num">${percent(legal?.score ?? null)}</td><td class="num">${
            legal?.violations ?? 0
          }</td><td class="num">${legal?.violationNodes ?? 0}</td><td class="num">${legal?.critical ?? 0}</td><td class="num">${
            legal?.serious ?? 0
          }</td><td class="num">${legal?.incomplete ?? 0}</td></tr>`;
        })
        .join('')}
    </tbody>
  </table>

  <section class="chapter">
    <h2 id="matriz">3. Resultados por criterio y página</h2>
    <p>
      Una fila por criterio WCAG que comprueba alguna regla de axe, y una columna por página. Lo que falla en muchas páginas
      suele ser un componente común (cabecera, pie, plantilla): corregirlo una vez lo arregla en todas.
    </p>
    <div class="legend">
      <span><strong class="x-failed">F</strong> fallo detectado</span>
      <span><strong class="x-cantTell">R</strong> axe no pudo decidir: revisar</span>
      <span><strong class="x-passed">✓</strong> sin fallos detectados (no equivale a cumplir)</span>
      <span><strong>–</strong> no aplica</span>
      <span>vacío: ninguna regla de ese criterio se ejecutó en la página</span>
    </div>
    <h3>Requisitos legales (${LEGAL_BASIS})</h3>
    ${legalRows.length > 0 ? matrix(legalRows) : '<p class="muted">Ninguna regla ejecutada comprueba requisitos legales.</p>'}
    ${otherRows.length > 0 ? `<h3>No exigibles: criterios nuevos de WCAG 2.2 y AAA</h3>${matrix(otherRows)}` : ''}
  </section>

  <section class="chapter">
    <h2 id="incidencias">4. Incidencias</h2>
    <p>
      Una entrada por regla incumplida, con las páginas donde aparece. Un mismo elemento que falla igual en varias páginas
      se cuenta una vez en &laquo;distintos&raquo;; los ejemplos son elementos distintos, hasta ${MAX_EXAMPLES} por regla.
    </p>
    ${failures.length === 0 ? '<p>axe no ha detectado incumplimientos en ninguna página.</p>' : ''}
    ${legalFailures.length > 0 ? `<h3>Requisitos legales (WCAG A y AA)</h3>${legalFailures.map(incident).join('')}` : ''}
    ${otherFailures.length > 0 ? `<h3>Mejoras (AAA y buenas prácticas)</h3>${otherFailures.map(incident).join('')}` : ''}
  </section>

  ${
    reviews.length > 0
      ? `<h2 id="revisar">5. Pendiente de revisión manual</h2>
  <p>Reglas en las que axe encontró elementos pero no pudo decidir si cumplen. Hay que mirarlos a mano.</p>
  <table>
    <thead><tr><th>Regla</th><th>Nivel</th><th>Páginas</th><th class="num">Elementos</th></tr></thead>
    <tbody>${reviews
      .map(
        (entry) =>
          `<tr><th scope="row">${escapeHtml(entry.help)}<br><code class="muted">${escapeHtml(entry.rule)}</code></th><td>${
            LEVEL_LABEL[entry.level]
          }</td><td>${escapeHtml(pageRanges(numbersOf(entry)))}</td><td class="num">${entry.count}</td></tr>`,
      )
      .join('')}</tbody>
  </table>`
      : ''
  }

  <h2 id="metodologia">${reviews.length > 0 ? 6 : 5}. Metodología</h2>
  <p>
    Cada página se carga en ${escapeHtml(audit.config.browser)} y se analiza con axe-core ${escapeHtml(axeVersion)} con las normas
    ${escapeHtml(audit.config.tags.join(', '))}. Las reglas de axe se asignan a los criterios WCAG por sus etiquetas; una regla
    puede tocar más de un criterio. Un criterio sale como &laquo;fallo detectado&raquo; en el sitio si falla en alguna página.
  </p>
  <p>
    axe comprueba en parte ${rows.length} de los ${catalog.checks.length} criterios WCAG 2.2 A, AA y AAA del catálogo
    (${legalRows.length} de los ${legalChecks} legales). El resto solo se puede evaluar en la revisión manual.
  </p>
  ${warnings.length > 0 ? `<h3>Límites de este análisis</h3><ul>${warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join('')}</ul>` : ''}
</body>
</html>`;
};
