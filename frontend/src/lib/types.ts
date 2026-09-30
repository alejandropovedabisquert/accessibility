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
