// @ts-expect-error jsonld 3.2 no trae tipos; es la version que usa la herramienta del W3C.
import jsonld from 'jsonld';

/**
 * Reproduce el "Open evaluation" del WCAG-EM Report Tool del W3C
 * (w3c/wai-wcag-em-report-tool, `src/stores/evaluationStore.js`, `open()`),
 * con su contexto de importacion (`src/data/jsonld/appContext.js`) y la misma
 * version de jsonld. Ese importador no valida ni avisa: falla en silencio o a
 * medias. Aqui cada uno de esos fallos lanza, para que un test los vea.
 */
const deprecatedContext = {
  DfnTechnologyWcag20: 'WCAG20:technologydef',
  DfnReliedUponTechnologyWcag20: 'WCAG20:reliedupondef',
  DfnSetOfWebpagesWcag20: 'WCAG20:set-of-web-pagesdef',
  DfnWebpageWcag20: 'WCAG20:webpagedef',
  DfnTechnologyWcag21: 'WCAG21:dfn-technologies',
  DfnReliedUponTechnologyWcag21: 'WCAG21:dfn-relied-upon',
  DfnSetOfWebpagesWcag21: 'WCAG21:dfn-set-of-web-pages',
  DfnWebpageWcag21: 'WCAG21:dfn-web-page-s',
  testcase: 'wcagem:testcase',
  source: { '@id': 'dcterms:source', '@type': '@id' },
  schema: 'http://schema.org/',
  name: 'schema:name',
  WebSite: 'schema:WebSite',
  WebPage: 'schema:WebPage',
};

const exportContext = {
  reporter: 'http://github.com/w3c/wai-wcag-em-report-tool/',
  wcagem: 'http://www.w3.org/TR/WCAG-EM/#',
  Evaluation: 'wcagem:procedure',
  defineScope: 'wcagem:step1',
  scope: 'wcagem:step1a',
  step1b: { '@id': 'wcagem:step1b', '@type': '@id' },
  conformanceTarget: 'step1b',
  accessibilitySupportBaseline: 'wcagem:step1c',
  additionalEvaluationRequirements: 'wcagem:step1d',
  exploreTarget: 'wcagem:step2',
  essentialFunctionality: 'wcagem:step2b',
  pageTypeVariety: 'wcagem:step2c',
  technologiesReliedUpon: 'wcagem:step2d',
  selectSample: 'wcagem:step3',
  structuredSample: 'wcagem:step3a',
  randomSample: 'wcagem:step3b',
  Website: 'wcagem:website',
  Webpage: 'wcagem:webpage',
  auditSample: 'wcagem:step4',
  reportFindings: 'wcagem:step5',
  documentSteps: 'wcagem:step5a',
  commissioner: 'wcagem:commissioner',
  evaluator: 'wcagem:evaluator',
  evaluationSpecifics: 'wcagem:step5b',
  WCAG: 'http://www.w3.org/TR/WCAG/#',
  WCAG20: 'http://www.w3.org/TR/WCAG20/#',
  WCAG21: 'http://www.w3.org/TR/WCAG21/#',
  WAI: 'http://www.w3.org/WAI/',
  A: 'WAI:WCAG2A-Conformance',
  AA: 'WAI:WCAG2AA-Conformance',
  AAA: 'WAI:WCAG2AAA-Conformance',
  wcagVersion: 'WAI:standards-guidelines/wcag/#versions',
  reportToolVersion: 'wcagem:reportToolVersion',
  earl: 'http://www.w3.org/ns/earl#',
  Assertion: 'earl:Assertion',
  TestMode: 'earl:TestMode',
  TestCriterion: 'earl:TestCriterion',
  TestCase: 'earl:TestCase',
  TestRequirement: 'earl:TestRequirement',
  TestSubject: 'earl:TestSubject',
  TestResult: 'earl:TestResult',
  OutcomeValue: 'earl:OutcomeValue',
  Pass: 'earl:Pass',
  Fail: 'earl:Fail',
  CannotTell: 'earl:CannotTell',
  NotApplicable: 'earl:NotApplicable',
  NotTested: 'earl:NotTested',
  assertedBy: 'earl:assertedBy',
  mode: 'earl:mode',
  result: 'earl:result',
  subject: 'earl:subject',
  test: 'earl:test',
  outcome: 'earl:outcome',
  dcterms: 'http://purl.org/dc/terms/',
  title: 'dcterms:title',
  description: 'dcterms:description',
  summary: 'dcterms:summary',
  date: 'dcterms:date',
  hasPart: 'dcterms:hasPart',
  isPartOf: 'dcterms:isPartOf',
  id: '@id',
  type: '@type',
  language: '@language',
};

const importContext = { ...deprecatedContext, ...exportContext };

const OUTCOMES = ['earl:passed', 'earl:failed', 'earl:cantTell', 'earl:inapplicable', 'earl:untested'];

type Node = Record<string, any>;
const types = (node: Node | undefined): string[] => [].concat(node?.type ?? []);

export interface ImportedAssertion {
  /** `website` o el titulo de la pagina de la muestra con la que casa. */
  subject: string;
  /** Lo que va tras los ultimos `:` del id del test: el ancla del criterio. */
  criterion: string;
  outcome: string;
  description: string;
}

export interface ImportedEvaluation {
  language: string;
  siteName: string;
  wcagVersion: string;
  conformanceTarget: string;
  sample: Array<{ title: string; description: string }>;
  date: string;
  evaluator: string;
  summary: string;
  assertions: ImportedAssertion[];
}

export const importWcagEm = async (file: unknown, criteria: ReadonlySet<string>): Promise<ImportedEvaluation> => {
  const expanded = await jsonld.expand(file);
  const evaluation: Node = await jsonld.frame(expanded, {
    '@context': importContext,
    '@type': ['Evaluation', 'wcagem:Evaluation'],
  });

  const scope = evaluation.defineScope?.scope;
  // El importador lee `scope.title` sin comprobar: sin scope revienta despues de vaciar la evaluacion abierta.
  if (!scope) throw new Error('Sin defineScope.scope: el importador revienta');

  const sample: Node[] = [].concat(evaluation.selectSample?.structuredSample ?? [], evaluation.selectSample?.randomSample ?? []);
  const date = evaluation.reportFindings?.date?.['@value'];
  if (!date) throw new Error('reportFindings.date sin @value: la fecha se pierde');

  const framed: Node = await jsonld.frame(evaluation, { '@context': importContext, '@type': ['Assertion'] });
  // `jsonld.getItems` solo mira `@graph`: con una sola asercion no hay `@graph` y no importa ninguna.
  if (!Array.isArray(framed['@graph'])) throw new Error('Sin @graph de aserciones: no importa ninguna');

  const assertions = (framed['@graph'] as Node[]).map((assertion): ImportedAssertion => {
    const subjectTypes = assertion.subject?.type;
    // `assertion.subject.type.indexOf(...)`: sin type, TypeError.
    if (subjectTypes === undefined) throw new Error(`Asercion sin subject.type: ${JSON.stringify(assertion.subject)}`);
    const isSite = types(assertion.subject).some((type) => type === 'Website' || type === 'WebSite');
    const page = isSite ? null : sample.find((item) => item.title == assertion.subject.title);
    if (!isSite && !page) throw new Error(`La pagina "${assertion.subject.title}" no casa con ninguna de la muestra`);

    const testId: string = assertion.test?.id ?? assertion.test ?? '';
    const criterion = testId.split(':').slice(-1)[0] ?? '';
    // `getCriterionById(scID).num`: un criterio que no conoce aborta toda la importacion.
    if (!criteria.has(criterion)) throw new Error(`Criterio desconocido: ${testId}`);

    const outcome = assertion.result?.outcome?.id;
    if (!OUTCOMES.includes(outcome)) throw new Error(`Resultado que no reconoce: ${JSON.stringify(assertion.result?.outcome)}`);

    return {
      subject: isSite ? 'website' : String(page?.title),
      criterion,
      outcome,
      description: assertion.result?.description ?? '',
    };
  });

  return {
    language: evaluation.language ?? 'en',
    siteName: scope.title ?? '',
    wcagVersion: evaluation.defineScope.wcagVersion ?? '2.2',
    conformanceTarget: evaluation.defineScope.conformanceTarget ?? evaluation.defineScope.step1b ?? '',
    sample: sample.map((item) => ({ title: item.title, description: item.description })),
    date,
    evaluator: evaluation.reportFindings?.evaluator ?? '',
    summary: evaluation.reportFindings?.summary ?? '',
    assertions,
  };
};
