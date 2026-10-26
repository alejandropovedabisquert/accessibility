import type { Assertor, CriterionResult, ManualFinding, SignOff, SignOffSnapshot } from '../../types/audit.types';
import { displayUrl } from '../../utils/url';
import { CONFORMANCE_LABEL, OUTCOME_LABEL } from './signoffReport';
import { LEGAL_BASIS, LEGAL_STANDARD, screenLabel } from '../report/reportBase';

/**
 * Exportacion EARL 1.0 (https://www.w3.org/TR/EARL10-Schema/) en JSON-LD con
 * la forma de una evaluacion WCAG-EM, para abrirla con "Open evaluation" en el
 * WCAG-EM Report Tool del W3C (https://www.w3.org/WAI/eval/report-tool/,
 * repositorio w3c/wai-wcag-em-report-tool). Ese importador no valida nada: si
 * algo no le cuadra, no importa o se queda a medias sin decir nada. Lo que
 * sigue esta hecho a la medida de su `evaluationStore.open()`:
 *
 * - Las paginas de una asercion se emparejan con la muestra **por titulo**, asi
 *   que el titulo de cada pagina es unico (`P1 · ...`).
 * - Los sujetos de las aserciones van enteros (tipo y titulo) en cada una: el
 *   importador lee `subject.type` y `subject.title` sin comprobar que existan.
 * - Los criterios van como `WCAG22:<ancla>` sin definir el prefijo, como los
 *   escribe la propia herramienta: solo mira lo que va tras los ultimos `:`.
 * - Su resumen solo cuenta las aserciones del sitio: hay una por criterio, y
 *   ademas una por pagina en los criterios de pagina.
 * - No tiene campo para selectores ni para quien evaluo cada cosa, y el modo lo
 *   reescribe a manual: todo eso va en la descripcion, que pinta como Markdown.
 * - La interfaz solo existe en ingles, neerlandes, frances y polaco: con
 *   `language: es` no la encuentra. Los textos nuestros salen tal cual.
 *
 * Lo firmado (huella, firmante, hallazgos con sus revisores) va ademas en
 * `a11y:signOff`, un vocabulario propio que el importador ignora.
 */

const CONTEXT = {
  wcagem: 'http://www.w3.org/TR/WCAG-EM/#',
  earl: 'http://www.w3.org/ns/earl#',
  dcterms: 'http://purl.org/dc/terms/',
  foaf: 'http://xmlns.com/foaf/0.1/',
  WAI: 'http://www.w3.org/WAI/',
  a11y: 'urn:accessibility-tool:',
  Evaluation: 'wcagem:procedure',
  defineScope: 'wcagem:step1',
  scope: 'wcagem:step1a',
  conformanceTarget: 'wcagem:step1b',
  accessibilitySupportBaseline: 'wcagem:step1c',
  additionalEvaluationRequirements: 'wcagem:step1d',
  wcagVersion: 'WAI:standards-guidelines/wcag/#versions',
  exploreTarget: 'wcagem:step2',
  essentialFunctionality: 'wcagem:step2b',
  pageTypeVariety: 'wcagem:step2c',
  technologiesReliedUpon: 'wcagem:step2d',
  selectSample: 'wcagem:step3',
  structuredSample: 'wcagem:step3a',
  randomSample: 'wcagem:step3b',
  auditSample: 'wcagem:step4',
  reportFindings: 'wcagem:step5',
  commissioner: 'wcagem:commissioner',
  evaluator: 'wcagem:evaluator',
  evaluationSpecifics: 'wcagem:step5b',
  Website: 'wcagem:website',
  Webpage: 'wcagem:webpage',
  Assertion: 'earl:Assertion',
  Assertor: 'earl:Assertor',
  TestSubject: 'earl:TestSubject',
  TestResult: 'earl:TestResult',
  TestRequirement: 'earl:TestRequirement',
  assertedBy: 'earl:assertedBy',
  mode: 'earl:mode',
  result: 'earl:result',
  subject: 'earl:subject',
  test: 'earl:test',
  outcome: 'earl:outcome',
  title: 'dcterms:title',
  description: 'dcterms:description',
  summary: 'dcterms:summary',
  date: 'dcterms:date',
  id: '@id',
  type: '@type',
  language: '@language',
};

type SnapshotPage = SignOffSnapshot['pages'][number];

const screen = (page: SnapshotPage) => screenLabel(page.device, page.viewport) || null;

/**
 * Unico dentro de la muestra: el importador empareja las paginas por titulo.
 * Corto porque la herramienta lo pinta en una columna estrecha: sin el dominio
 * si toda la muestra es de uno, y sin la pantalla si todas usan la misma.
 */
const pageTitles = (pages: SnapshotPage[]): string[] => {
  const oneHost = new Set(pages.map((page) => new URL(page.url).host)).size === 1;
  const oneScreen = new Set(pages.map(screen)).size === 1;
  return pages.map((page, index) => {
    const url = new URL(page.url);
    return [
      `P${index + 1} · ${oneHost ? `${url.pathname}${url.search}` : displayUrl(page.url)}`,
      page.include ? `solo ${page.include}` : null,
      oneScreen ? null : screen(page),
    ]
      .filter(Boolean)
      .join(' · ');
  });
};

const pageDescription = (page: SnapshotPage) =>
  [page.url, page.include ? `Solo ${page.include}` : null, page.exclude ? `Excluye ${page.exclude}` : null, screen(page)]
    .filter(Boolean)
    .join(' · ');

const assertorLabel = (assertor: Assertor) => {
  const kind = assertor.type === 'human' ? 'Persona' : assertor.type === 'ai' ? 'IA' : 'Herramienta';
  const extra = [assertor.model, assertor.assistiveTech].filter(Boolean).join(', ');
  return `${kind}: ${assertor.name}${extra ? ` (${extra})` : ''}`;
};

/** Para que un `*` o un `_` del texto del hallazgo no se lea como Markdown. */
const plain = (text: string) => text.replace(/([\\`*_[\]#<>])/g, '\\$1');

const findingLine = (finding: ManualFinding) => {
  const lines = [`- **${OUTCOME_LABEL[finding.outcome]}** · ${plain(assertorLabel(finding.assertedBy))}: ${plain(finding.description)}`];
  if (finding.recommendation) lines.push(`  Cómo corregirlo: ${plain(finding.recommendation)}`);
  if (finding.targets.length > 0) {
    const more = finding.targetCount > finding.targets.length ? ` y ${finding.targetCount - finding.targets.length} más` : '';
    lines.push(`  Elementos: ${finding.targets.map((target) => `\`${target.selector.replace(/`/g, "'")}\``).join(', ')}${more}`);
  }
  if (finding.review.by) {
    lines.push(`  Validado por ${plain(finding.review.by)}${finding.review.note ? `: ${plain(finding.review.note)}` : ''}`);
  }
  // Salto de linea forzado de Markdown: sin los dos espacios se juntaria todo en un parrafo.
  return lines.join('  \n');
};

/** Los que cuentan: sin rechazados ni falsos positivos, que ya quitaron su violacion de axe. */
const countingFindings = (criterion: CriterionResult) =>
  criterion.findings.filter((finding) => finding.review.status !== 'rejected' && finding.source.kind !== 'axe-false-positive');

const result = (outcome: CriterionResult['outcome'], description: string) => ({
  type: 'TestResult',
  outcome: { id: `earl:${outcome}` },
  ...(description ? { description } : {}),
});

export type EarlTarget = 'AA' | 'AAA';

export const buildEarl = (signOff: SignOff, snapshot: SignOffSnapshot, axeVersion: string, target: EarlTarget = 'AA') => {
  const pageIndex = new Map(snapshot.pages.map((page, index) => [page.id, index]));
  const titles = pageTitles(snapshot.pages);
  const evaluator = `${signOff.signer}${signOff.credential ? ` (${signOff.credential})` : ''}`;
  const assertedBy = { type: ['Assertor', 'foaf:Person'], 'foaf:name': evaluator };
  const siteSubject = () => ({ type: ['TestSubject', 'Website'], title: snapshot.site.name });
  const pageSubject = (pageId: string) => {
    const index = pageIndex.get(pageId) ?? 0;
    const page = snapshot.pages[index];
    return page ? { type: ['TestSubject', 'Webpage'], title: titles[index], description: pageDescription(page) } : siteSubject();
  };

  const assertions = snapshot.criteria.flatMap((criterion) => {
    const test = { id: `WCAG22:${criterion.checkId}`, type: 'TestRequirement' };
    const findings = countingFindings(criterion);
    const assertion = (subject: object, outcome: CriterionResult['outcome'], description: string) => ({
      type: 'Assertion',
      assertedBy,
      mode: 'earl:manual',
      subject,
      test,
      result: result(outcome, description),
    });

    const notLegal = criterion.legal
      ? []
      : [`_No cuenta para la conformidad legal (${criterion.level === 'AAA' ? 'nivel AAA' : 'criterio nuevo de WCAG 2.2, aún sin apartado en EN 301 549'})._`];

    if (criterion.scope === 'site') {
      const lines = [...notLegal, ...findings.map(findingLine)];
      return [assertion(siteSubject(), criterion.outcome, lines.join('\n\n'))];
    }

    const failedPages = Object.entries(criterion.byPage)
      .filter(([, outcome]) => outcome === 'failed')
      .map(([pageId]) => `P${(pageIndex.get(pageId) ?? 0) + 1}`);
    const site = assertion(
      siteSubject(),
      criterion.outcome,
      [...notLegal, failedPages.length > 0 ? `No cumple en ${failedPages.join(', ')}.` : ''].filter(Boolean).join('\n\n'),
    );

    const pages = snapshot.pages.map((page) => {
      const axeRules = criterion.axeViolations[page.id] ?? [];
      const lines = [
        ...(axeRules.length > 0
          ? [`- **No cumple** · Herramienta: axe-core ${axeVersion}: reglas incumplidas ${axeRules.map((rule) => `\`${rule}\``).join(', ')}`]
          : []),
        ...findings.filter((finding) => finding.subject.kind === 'page' && finding.subject.pageId === page.id).map(findingLine),
      ];
      return assertion(pageSubject(page.id), criterion.byPage[page.id] ?? 'untested', lines.join('\n'));
    });

    return [site, ...pages];
  });

  const { conformance } = snapshot;
  const summary = [
    `**${CONFORMANCE_LABEL[conformance.status]}** con los requisitos legales (${LEGAL_BASIS}): ` +
      `${conformance.passed} cumplen, ${conformance.failed} no cumplen y ${conformance.inapplicable} no aplican.`,
    `Criterios nuevos de WCAG 2.2, aún no exigibles: ${snapshot.wcag22.passed} cumplen o no aplican, ${snapshot.wcag22.failed} no cumplen.` +
      (snapshot.aaa ? ` Criterios AAA, no exigibles: ${snapshot.aaa.passed} cumplen o no aplican, ${snapshot.aaa.failed} no cumplen.` : ''),
    plain(signOff.statement),
    `Huella de lo firmado (SHA-256): \`${signOff.findingsHash}\``,
  ].join('\n\n');

  const assistiveTech = [
    ...new Set(snapshot.criteria.flatMap((criterion) => criterion.findings.map((finding) => finding.assertedBy.assistiveTech)).filter(Boolean)),
  ];

  return {
    '@context': CONTEXT,
    type: 'Evaluation',
    id: `a11y:sign-off/${signOff.id}`,
    // Ver arriba: con `es` la herramienta no encuentra su interfaz.
    language: 'en',
    defineScope: {
      scope: {
        id: `a11y:site/${snapshot.site.id}`,
        type: ['TestSubject', 'Website'],
        title: snapshot.site.name,
        description: snapshot.site.origins.join(', '),
      },
      wcagVersion: '2.2',
      // AA por defecto: con AAA su resumen cuenta tambien los AAA, que nunca cuentan para la conformidad legal.
      conformanceTarget: target,
      accessibilitySupportBaseline: assistiveTech.join('; '),
      additionalEvaluationRequirements:
        `La conformidad legal se mide con WCAG 2.1 A y AA (${LEGAL_STANDARD}, RD 1112/2018). ` +
        'Los criterios nuevos de WCAG 2.2 y los AAA se evalúan e informan, pero no cuentan para ella.',
    },
    exploreTarget: { technologiesReliedUpon: [], essentialFunctionality: '', pageTypeVariety: '' },
    selectSample: {
      structuredSample: snapshot.pages.map((page, index) => ({
        id: `a11y:page/${page.id}`,
        type: ['TestSubject', 'Webpage'],
        title: titles[index],
        description: pageDescription(page),
      })),
      randomSample: [],
    },
    auditSample: assertions,
    reportFindings: {
      title: `Evaluación de accesibilidad de ${snapshot.site.name}`,
      commissioner: '',
      evaluator,
      // Literal tipado: el importador lee `date['@value']` y una cadena suelta se pierde.
      date: { '@value': signOff.signedAt.slice(0, 10), '@type': 'http://www.w3.org/TR/NOTE-datetime' },
      summary,
      evaluationSpecifics:
        `Escaneo automático con axe-core ${axeVersion}, revisión asistida por IA de los ${snapshot.criteria.length} criterios ` +
        `del catálogo ${snapshot.catalog.id} v${snapshot.catalog.version} y validación de cada resultado por una persona, ` +
        'que firma. Cada observación indica quién evaluó qué.',
    },
    'a11y:signOff': {
      signer: signOff.signer,
      credential: signOff.credential,
      signedAt: signOff.signedAt,
      statement: signOff.statement,
      findingsHash: signOff.findingsHash,
      catalog: snapshot.catalog,
      conformance: snapshot.conformance,
      wcag22: snapshot.wcag22,
      ...(snapshot.aaa ? { aaa: snapshot.aaa } : {}),
      criteria: snapshot.criteria.map((criterion) => ({
        test: `WCAG22:${criterion.checkId}`,
        criterion: criterion.criterion,
        level: criterion.level,
        legal: criterion.legal,
        outcome: `earl:${criterion.outcome}`,
      })),
    },
  };
};
