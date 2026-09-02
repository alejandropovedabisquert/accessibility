import type AxeBuilder from '@axe-core/playwright';

/** Resultado crudo devuelto por axe-core. */
export type AxeResults = Awaited<ReturnType<InstanceType<typeof AxeBuilder>['analyze']>>;
export type AxeResult = AxeResults['violations'][number];

export type ScanBrowser = 'chromium' | 'firefox' | 'webkit';
export type ScanWaitUntil = 'load' | 'domcontentloaded' | 'networkidle';
export type Impact = 'critical' | 'serious' | 'moderate' | 'minor';

export const IMPACTS: readonly Impact[] = ['critical', 'serious', 'moderate', 'minor'] as const;

export type AuditStatus = 'queued' | 'running' | 'completed' | 'failed';
export type PageStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface Viewport {
  width: number;
  height: number;
}

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

/** Configuracion con la que se lanza una auditoria. */
export interface AuditConfig {
  browser: ScanBrowser;
  device: string | null;
  viewport: Viewport | null;
  waitUntil: ScanWaitUntil;
  timeoutMs: number;
  tags: string[];
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

export interface AuditPage extends Counters, ScanScope {
  id: string;
  auditId: string;
  url: string;
  host: string;
  status: PageStatus;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  score: number | null;
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
  error: string | null;
}

export interface AuditWithPages extends Audit {
  pages: AuditPage[];
}

/** Una regla de axe incumplida en una pagina. Se guarda aplanada para poder diffear. */
export interface PageIssue {
  ruleId: string;
  impact: Impact | null;
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
  waitUntil?: ScanWaitUntil;
  timeout?: number;
  tags?: string[];
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

export interface HistoryPoint extends Counters {
  auditId: string;
  pageId: string;
  finishedAt: string | null;
  score: number | null;
  include: string | null;
}
