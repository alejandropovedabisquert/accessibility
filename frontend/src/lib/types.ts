export type AuditStatus = 'queued' | 'running' | 'completed' | 'failed';
export type PageStatus = 'pending' | 'running' | 'completed' | 'failed';
export type Impact = 'critical' | 'serious' | 'moderate' | 'minor';

export const IMPACTS: Impact[] = ['critical', 'serious', 'moderate', 'minor'];

/** Nivel de una regla segun sus tags de axe. Misma regla que `backend/src/services/audit/levels.ts`. */
export type RuleLevel = 'A' | 'AA' | 'AAA' | 'best-practice';

/** `legal` = WCAG A/AA; `improvements` = AAA y buenas practicas. */
export type ComplianceGroupKey = 'legal' | 'improvements';

/** `score` a null = no se evaluo ninguna regla del grupo. */
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

export interface Viewport {
  width: number;
  height: number;
}

/** Pantalla de una pagina. Es parte de la clave del historico, como la seccion. */
export interface ScanScreen {
  viewport: Viewport | null;
  device: string | null;
}

export interface AuditConfig {
  browser: string;
  device: string | null;
  /** El primero de `viewports`; se mantiene por compatibilidad. */
  viewport: Viewport | null;
  /** Resoluciones en las que se escanea cada URL. Vacio si se usa `device`. */
  viewports: Viewport[];
  waitUntil: string;
  timeoutMs: number;
  tags: string[];
}

/** Seccion analizada de una pagina. `include` a null = la pagina entera. */
export interface ScanScope {
  include: string | null;
  exclude: string | null;
}

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

export interface PageIssue {
  ruleId: string;
  impact: Impact | null;
  level: RuleLevel;
  nodeCount: number;
  help: string;
  helpUrl: string;
  description: string;
}

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

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface Meta {
  browsers: Array<{ id: string; name: string }>;
  devices: Array<{ name: string; viewport: { width: number; height: number } | null; isMobile?: boolean }>;
  tags: Array<{ id: string; label: string }>;
  sections: Array<{ id: string; label: string; selector: string }>;
  viewports: Array<{ id: string; label: string; viewport: Viewport }>;
  defaults: {
    browser: string;
    waitUntil: string;
    tags: string[];
    timeout: number;
    viewport: { width: number; height: number };
  };
  limits: {
    maxUrlsPerAudit: number;
    scanConcurrency: number;
    maxSelectorLength: number;
    maxViewports: number;
  };
}

export interface ScannedUrl extends ScanScreen {
  url: string;
  host: string;
  include: string | null;
  runs: number;
  lastScan: string | null;
}

/** Nodo concreto de axe que incumple una regla. */
export interface AxeNode {
  html: string;
  target: string[];
  failureSummary?: string;
}

export interface AxeRule {
  id: string;
  impact: Impact | null;
  description: string;
  help: string;
  helpUrl: string;
  tags: string[];
  nodes: AxeNode[];
}

export interface AxeResults {
  url: string;
  timestamp: string;
  violations: AxeRule[];
  passes: AxeRule[];
  incomplete: AxeRule[];
  inapplicable: AxeRule[];
}

// ---------------------------------------------------------------------------
// Revision manual (capas 2 y 3) y firma. El vocabulario de resultados es el de
// EARL (W3C) para poder exportarlo sin traducciones: ver `backend/src/services/review/`.
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

export type FindingSource =
  | { kind: 'check'; checkId: string; catalogVersion: number }
  | { kind: 'axe-needs-review'; ruleId: string; checkId: string };

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
  axe: { violations: string[]; needsReview: string[] };
  /** Hallazgos sin validar todavia por la capa 3. */
  pendingReview: number;
  findings: ManualFinding[];
}

/** Revision de una pagina: los criterios de ambito `page` del catalogo, en orden de la especificacion. */
export interface PageReview {
  page: AuditPage;
  site: Site | null;
  catalog: { id: string; version: number };
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
