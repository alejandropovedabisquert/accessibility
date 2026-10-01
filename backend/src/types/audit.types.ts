import type AxeBuilder from '@axe-core/playwright';

/** Resultado crudo devuelto por axe-core. */
export type AxeResults = Awaited<ReturnType<InstanceType<typeof AxeBuilder>['analyze']>>;
export type AxeResult = AxeResults['violations'][number];

export type ScanBrowser = 'chromium' | 'firefox' | 'webkit';
export type ScanWaitUntil = 'load' | 'domcontentloaded' | 'networkidle';
export type Impact = 'critical' | 'serious' | 'moderate' | 'minor';

export const IMPACTS: readonly Impact[] = ['critical', 'serious', 'moderate', 'minor'] as const;

/** Nivel de una regla segun sus tags de axe. Ver `services/audit/levels.ts`. */
export type RuleLevel = 'A' | 'AA' | 'AAA' | 'best-practice';

/** `legal` = WCAG A/AA (lo que exige EN 301 549); `improvements` = AAA y buenas practicas. */
export type ComplianceGroupKey = 'legal' | 'improvements';

export type AuditStatus = 'queued' | 'running' | 'completed' | 'failed';
export type PageStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface Viewport {
  width: number;
  height: number;
}

/** Con el que se escanea si no se pide resolucion ni dispositivo. */
export const DEFAULT_VIEWPORT: Viewport = { width: 1366, height: 768 };

/**
 * Seccion concreta de una pagina a analizar.
 *
 * `include` a null significa la pagina entera. Va por pagina y no en
 * `AuditConfig` a proposito: una misma auditoria puede mirar la cabecera de una
 * URL y el pie de otra.
 */
export interface ScanScope {
  include: string | null;
  exclude: string | null;
}

/** Una URL con la seccion que se quiere analizar de ella. */
export interface ScanTarget extends ScanScope {
  url: string;
}

/**
 * Pantalla con la que se escanea una pagina. `device` es el dispositivo de
 * Playwright si la auditoria usaba uno (y entonces `viewport` es el suyo).
 * Forma parte de la clave del historico: movil y escritorio no se comparan.
 */
export interface ScanScreen {
  viewport: Viewport | null;
  device: string | null;
}

/** Configuracion con la que se lanza una auditoria. */
export interface AuditConfig {
  browser: ScanBrowser;
  device: string | null;
  /** El primero de `viewports` si se pidio alguno; se mantiene por compatibilidad. */
  viewport: Viewport | null;
  /** Resoluciones en las que se escanea cada URL. Vacio si se usa `device`. */
  viewports: Viewport[];
  waitUntil: ScanWaitUntil;
  timeoutMs: number;
  tags: string[];
  /** Recoger evidencia para la revision manual (capturas, foco, reflujo...). Ver `services/evidence/`. */
  evidence: boolean;
}

/** Contadores agregados, compartidos por auditoria y por pagina. */
export interface Counters {
  violations: number;
  violationNodes: number;
  critical: number;
  serious: number;
  moderate: number;
  minor: number;
  passes: number;
  incomplete: number;
  inapplicable: number;
}

/**
 * Metrica y contadores de un grupo de reglas. `score` es la misma formula que
 * el score global, restringida a las reglas del grupo; null si no se evaluo
 * ninguna regla del grupo (p. ej. sin los tags AAA ni best-practice).
 */
export interface ComplianceGroup {
  score: number | null;
  passes: number;
  violations: number;
  violationNodes: number;
  critical: number;
  serious: number;
  moderate: number;
  minor: number;
  incomplete: number;
}

export type Compliance = Record<ComplianceGroupKey, ComplianceGroup>;

export interface AuditPage extends Counters, ScanScope, ScanScreen {
  id: string;
  auditId: string;
  url: string;
  host: string;
  status: PageStatus;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  score: number | null;
  /** null en paginas no completadas o antiguas sin JSON crudo del que recalcularlo. */
  compliance: Compliance | null;
  error: string | null;
}

export interface Audit extends Counters {
  id: string;
  label: string | null;
  status: AuditStatus;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  config: AuditConfig;
  totalPages: number;
  completedPages: number;
  failedPages: number;
  score: number | null;
  compliance: Compliance | null;
  error: string | null;
}

export interface AuditWithPages extends Audit {
  pages: AuditPage[];
}

/** Una regla de axe incumplida en una pagina. Se guarda aplanada para poder diffear. */
export interface PageIssue {
  ruleId: string;
  impact: Impact | null;
  level: RuleLevel;
  nodeCount: number;
  help: string;
  helpUrl: string;
  description: string;
}

/** Lo que acepta la API por cada entrada de `urls`: la URL sola o con seccion. */
export type CreateAuditTarget = string | { url: string; include?: string; exclude?: string };

export interface CreateAuditInput {
  urls: CreateAuditTarget[];
  label?: string;
  browser?: ScanBrowser;
  device?: string;
  viewport?: Viewport;
  viewports?: Viewport[];
  waitUntil?: ScanWaitUntil;
  timeout?: number;
  tags?: string[];
  evidence?: boolean;
}

export interface ListAuditsQuery {
  page: number;
  pageSize: number;
  status?: AuditStatus;
  search?: string;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/** Comparacion de una pagina contra el escaneo anterior de la misma URL. */
export interface PageDiff {
  previous: { auditId: string; pageId: string; finishedAt: string | null } | null;
  added: PageIssue[];
  resolved: PageIssue[];
  changed: Array<PageIssue & { previousNodeCount: number }>;
  unchanged: number;
}

export interface HistoryPoint extends Counters, ScanScreen {
  auditId: string;
  pageId: string;
  finishedAt: string | null;
  score: number | null;
  include: string | null;
}

/** Una serie del historico: URL + seccion + pantalla. */
export interface SeriesKey extends ScanScreen {
  url: string;
  include: string | null;
}

// ---------------------------------------------------------------------------
// Revision manual (capas 2 y 3) y firma. El vocabulario de resultados es el de
// EARL (W3C) para poder exportarlo sin traducciones: ver `services/review/`.
// ---------------------------------------------------------------------------

/** Nivel de un criterio WCAG del catalogo. El catalogo cerrado solo tiene A y AA. */
export type WcagLevel = 'A' | 'AA';

/** Version de WCAG que introdujo el criterio. Los de 2.2 aun no estan en EN 301 549 v3.2.1. */
export type WcagVersion = '2.0' | '2.1' | '2.2';

/** `site` = se evalua comparando varias paginas del sitio (navegacion coherente, multiples vias...). */
export type CheckScope = 'page' | 'site';

/**
 * Evidencia que se recoge antes de juzgar un criterio. `interaction` no tiene
 * recolector automatico: significa que hay que manejar la pagina (MCP de
 * Playwright o una persona).
 */
export type EvidenceKind =
  | 'screenshot'
  | 'orientation'
  | 'focus-sequence'
  | 'reflow-320'
  | 'zoom-200'
  | 'text-spacing'
  | 'images'
  | 'media'
  | 'forms'
  | 'controls'
  | 'headings'
  | 'landmarks'
  | 'text-content'
  | 'interaction';

/**
 * `partial`: axe comprueba parte del criterio; una violacion basta para darlo
 * por fallado, pero sus `passes` nunca lo cierran. `manual`: axe no mira nada.
 * Se calcula con la version de axe instalada, no se escribe en el catalogo.
 */
export type CheckCoverage = 'partial' | 'manual';

/** Un criterio del catalogo de revision, ya enriquecido con lo que sale de axe. */
export interface Check {
  /** Ancla de la especificacion del W3C (`non-text-content`); estable entre versiones. */
  id: string;
  criterion: string;
  level: WcagLevel;
  introducedIn: WcagVersion;
  name: string;
  scope: CheckScope;
  evidence: EvidenceKind[];
  /** La capa 3 tiene que probarlo con un lector de pantalla real. */
  requiresAssistiveTech: boolean;
  /** Si no casa con nada en la pagina, el criterio se propone como no aplicable. */
  appliesWhen: string | null;
  instructions: string;
  /** Apartado de EN 301 549 (`9.1.1.1`); null en los criterios nuevos de WCAG 2.2. */
  en301549: string | null;
  axeRules: string[];
  coverage: CheckCoverage;
}

export interface CheckCatalog {
  id: string;
  version: number;
  wcagVersion: WcagVersion;
  checks: Check[];
}

/** Resultados de EARL. `untested` no se guarda: es la ausencia de hallazgo. */
export type EarlOutcome = 'passed' | 'failed' | 'cantTell' | 'inapplicable' | 'untested';
export type FindingOutcome = Exclude<EarlOutcome, 'untested'>;

/** Modo de EARL; sale de quien evalua (axe, IA o persona), no se guarda aparte. */
export type EarlMode = 'automatic' | 'semiAuto' | 'manual';

/** Estado de la validacion de la capa 3, independiente del resultado. */
export type ReviewStatus = 'proposed' | 'validated' | 'rejected' | 'amended';

/** Una web: puede servirse desde varios origenes (www, subdominios por idioma...). */
export interface Site {
  id: string;
  name: string;
  origins: string[];
  createdAt: string;
}

export type FindingSubject = { kind: 'page'; pageId: string } | { kind: 'site'; siteId: string };

/**
 * `applicability`: propuesta de no aplicable porque `appliesWhen` no caso con
 * nada al recoger la evidencia. La pone el sistema, como las de axe.
 * `axe-false-positive`: la capa 3 declara que una violacion de axe no lo es
 * para ese criterio. Nace validado y solo lo crea una persona.
 */
export type FindingSource =
  | { kind: 'check'; checkId: string; catalogVersion: number }
  | { kind: 'axe-needs-review'; ruleId: string; checkId: string }
  | { kind: 'applicability'; checkId: string; selector: string }
  | { kind: 'axe-false-positive'; ruleId: string; checkId: string };

export interface FindingTarget {
  selector: string;
  html: string;
}

/** `tool` solo lo pone el sistema: las propuestas que salen de las `needs-review` de axe. */
export interface Assertor {
  type: 'tool' | 'ai' | 'human';
  name: string;
  /** Modelo de IA que hizo la evaluacion, si la hizo una IA. */
  model: string | null;
  /** Producto de apoyo con el que se probo (`NVDA 2025.1 + Firefox`), si se uso. */
  assistiveTech: string | null;
}

export interface FindingReview {
  status: ReviewStatus;
  by: string | null;
  at: string | null;
  note: string | null;
}

export interface ManualFinding {
  id: string;
  subject: FindingSubject;
  source: FindingSource;
  outcome: FindingOutcome;
  targets: FindingTarget[];
  /** Nodos afectados en total, aunque en `targets` vayan menos (la revision los recorta). */
  targetCount: number;
  description: string;
  recommendation: string | null;
  evidenceRefs: string[];
  assertedBy: Assertor;
  review: FindingReview;
  createdAt: string;
  /** Hallazgo de la linea base del que se hereda, y huella de region con la que se heredo. */
  inheritedFrom: { findingId: string; fingerprint: string } | null;
}

/**
 * Estado de un criterio en una pagina. Una violacion de axe lo da por fallado;
 * si no, manda lo peor de los hallazgos no rechazados: failed > cantTell >
 * passed > inapplicable. Sin hallazgos ni violaciones es `untested`.
 */
export interface CheckReview {
  checkId: string;
  criterion: string;
  name: string;
  outcome: EarlOutcome;
  /** `violations` ya sin las que la capa 3 ha marcado como falso positivo, que van en `falsePositives`. */
  axe: { violations: string[]; needsReview: string[]; falsePositives: string[] };
  /** Hallazgos sin validar todavia por la capa 3. */
  pendingReview: number;
  findings: ManualFinding[];
}

/** Revision de una pagina: los criterios de ambito `page` del catalogo, en orden de la especificacion. */
export interface PageReview {
  page: AuditPage;
  site: Site | null;
  catalog: { id: string; version: number };
  /** Que evidencia hay para esta pagina; null si la auditoria no la pidio. */
  evidence: { collected: string[]; errors: Record<string, string> } | null;
  summary: Record<EarlOutcome, number>;
  checks: CheckReview[];
}

export interface SiteDetail extends Site {
  /** Paginas completadas de los hosts del sitio, de la mas reciente a la mas antigua. */
  pages: AuditPage[];
  findings: ManualFinding[];
}

/** Estado de conformidad de la declaracion de accesibilidad (RD 1112/2018). */
export type ConformanceStatus = 'full' | 'partial' | 'non-conformant';

/** Firma de una web. Inmutable: `findingsHash` es la huella de lo firmado. */
export interface SignOff {
  id: string;
  siteId: string;
  /** Muestra de paginas (WCAG-EM) que elige quien firma. */
  pageIds: string[];
  catalogId: string;
  catalogVersion: number;
  signer: string;
  credential: string | null;
  signedAt: string;
  conformance: ConformanceStatus;
  findingsHash: string;
  statement: string;
}

/** Un criterio en toda la muestra: el peor resultado de sus paginas (o el del sitio). */
export interface CriterionResult {
  checkId: string;
  criterion: string;
  name: string;
  level: WcagLevel;
  scope: CheckScope;
  /** Esta en EN 301 549 v3.2.1 y por tanto cuenta para la conformidad legal. */
  legal: boolean;
  outcome: EarlOutcome;
  /** Resultado en cada pagina de la muestra; vacio en los criterios de sitio. */
  byPage: Record<string, EarlOutcome>;
  /** Violaciones de axe que cuentan (sin falsos positivos), por pagina. */
  axeViolations: Record<string, string[]>;
  findings: ManualFinding[];
}

export interface ConformanceSummary {
  status: ConformanceStatus;
  /** Criterios legales con contenido al que aplicar (no `inapplicable`). */
  applicable: number;
  passed: number;
  failed: number;
  inapplicable: number;
}

/** Lo que se firma. Su hash (JSON con claves ordenadas) es `SignOff.findingsHash`. */
export interface SignOffSnapshot {
  site: Site;
  pages: Array<Pick<AuditPage, 'id' | 'auditId' | 'url' | 'include' | 'exclude' | 'viewport' | 'device' | 'finishedAt'>>;
  catalog: { id: string; version: number };
  criteria: CriterionResult[];
  /** Solo criterios legales (WCAG 2.1 A/AA via EN 301 549). */
  conformance: ConformanceSummary;
  /** Los criterios nuevos de WCAG 2.2, que aun no son exigibles. */
  wcag22: { passed: number; failed: number; pending: number };
}

export interface SignOffBlocker {
  kind: 'pending-review' | 'undecided' | 'untested' | 'page';
  checkId: string | null;
  pageId: string | null;
  message: string;
}

/** Vista previa de la firma: lo que se firmaria y lo que lo impide todavia. */
export interface SignOffPreview {
  snapshot: SignOffSnapshot;
  blockers: SignOffBlocker[];
  canSign: boolean;
}

export interface SignOffDetail extends SignOff {
  snapshot: SignOffSnapshot;
  /**
   * Si lo firmado sigue coincidiendo con los datos actuales. false = alguien ha
   * cambiado un hallazgo despues; null = ya no se puede recalcular (se borro una auditoria).
   */
  stillMatches: boolean | null;
}

// ---------------------------------------------------------------------------
// Evidencia para la revision manual. Se guarda en disco junto al JSON de axe
// (`scan-results/<auditId>/evidence/<pageId>/`), nunca en SQLite. Las capturas
// van como ficheros aparte y aqui solo su nombre.
// ---------------------------------------------------------------------------

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Un elemento de la pagina. `name` es una aproximacion del nombre accesible
 * calculada en el DOM; el de Chromium de verdad esta en `landmarks.ariaSnapshot`.
 */
export interface EvidenceElement {
  selector: string;
  tag: string;
  role: string | null;
  name: string;
  box: Box | null;
  /** Dentro de la seccion analizada (`include` sin `exclude`). Siempre true en pagina entera. */
  inScope: boolean;
}

export interface FocusStop extends EvidenceElement {
  index: number;
  /** Si al enfocarlo cambia algun estilo que haga de indicador; `unknown` si no se pudo comparar. */
  indicator: 'changed' | 'unchanged' | 'unknown';
  indicatorProperties: string[];
  /** Cuanto lo tapan otros elementos (cabeceras fijas, banners): 2.4.11. */
  obscured: 'none' | 'partial' | 'full' | 'offscreen';
  screenshot: string | null;
}

export interface FocusSequenceEvidence {
  stops: FocusStop[];
  /** `cycle`: volvio al principio o salio del documento; `stuck`: el foco no avanza (posible trampa). */
  stoppedBecause: 'cycle' | 'limit' | 'stuck' | 'no-focusable';
}

/** Reflujo, zoom y espaciado de texto comparten forma: lo que se desborda o se corta. */
export interface LayoutEvidence {
  viewport: Viewport;
  horizontalScroll: boolean;
  scrollWidth: number;
  /** Elementos que se salen por la derecha del viewport. */
  overflowing: EvidenceElement[];
  /** Elementos con texto cortado (overflow oculto con contenido que no cabe). */
  clipped: EvidenceElement[];
  screenshot: string | null;
}

export interface OrientationEvidence {
  portrait: { viewport: Viewport; horizontalScroll: boolean; screenshot: string | null };
  landscape: { viewport: Viewport; horizontalScroll: boolean; screenshot: string | null };
}

export interface ImageItem extends EvidenceElement {
  src: string | null;
  /** null = sin atributo alt, '' = alt vacio. No son lo mismo. */
  alt: string | null;
  decorative: boolean;
  screenshot: string | null;
}

export interface MediaItem extends EvidenceElement {
  kind: 'video' | 'audio' | 'iframe';
  src: string | null;
  autoplay: boolean;
  muted: boolean;
  controls: boolean;
  tracks: Array<{ kind: string; srclang: string | null; label: string | null }>;
}

export interface FormField extends EvidenceElement {
  type: string;
  label: string | null;
  placeholder: string | null;
  required: boolean;
  autocomplete: string | null;
  invalid: boolean;
  description: string | null;
  /** Leyenda del fieldset o nombre del grupo que lo contiene. */
  group: string | null;
}

export interface ControlItem extends EvidenceElement {
  visibleText: string;
  href: string | null;
  /** aria-expanded, aria-pressed, aria-selected, aria-checked... tal y como estan. */
  states: Record<string, string>;
  /** Enlace dentro de un bloque de texto: exento de 2.5.8. */
  inline: boolean;
}

export interface EvidenceData {
  screenshot: { viewport: string | null; fullPage: string | null; fullPageTruncated: boolean };
  orientation: OrientationEvidence;
  'focus-sequence': FocusSequenceEvidence;
  'reflow-320': LayoutEvidence;
  'zoom-200': LayoutEvidence;
  'text-spacing': LayoutEvidence;
  images: { items: ImageItem[]; total: number };
  media: { items: MediaItem[]; runningAnimations: number };
  forms: { fields: FormField[]; total: number };
  controls: { items: ControlItem[]; total: number };
  headings: { items: Array<{ level: number; text: string; selector: string; inScope: boolean }> };
  landmarks: { items: EvidenceElement[]; ariaSnapshot: string };
  'text-content': {
    title: string;
    lang: string | null;
    langParts: Array<{ selector: string; lang: string; text: string }>;
    text: string;
    truncated: boolean;
  };
}

/** Lo que tiene recolector: todo menos `interaction`, que es manejar la pagina a mano. */
export type CollectedEvidenceKind = keyof EvidenceData;

export interface PageEvidence {
  collectedAt: string;
  browser: ScanBrowser;
  viewport: Viewport | null;
  scope: ScanScope;
  items: Partial<EvidenceData>;
  /** Recolectores que fallaron, con su error. El resto de la evidencia sigue valiendo. */
  errors: Partial<Record<CollectedEvidenceKind, string>>;
  /** Elementos que casan con `appliesWhen` de cada criterio, por id de criterio. */
  applicability: Record<string, number>;
}
