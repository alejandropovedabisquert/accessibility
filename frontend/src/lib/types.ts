export type AuditStatus = 'queued' | 'running' | 'completed' | 'failed';
export type PageStatus = 'pending' | 'running' | 'completed' | 'failed';
export type Impact = 'critical' | 'serious' | 'moderate' | 'minor';

export const IMPACTS: Impact[] = ['critical', 'serious', 'moderate', 'minor'];

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

export interface AuditConfig {
  browser: string;
  device: string | null;
  viewport: { width: number; height: number } | null;
  waitUntil: string;
  timeoutMs: number;
  tags: string[];
}

export interface AuditPage extends Counters {
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

export interface PageIssue {
  ruleId: string;
  impact: Impact | null;
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

export interface HistoryPoint extends Counters {
  auditId: string;
  pageId: string;
  finishedAt: string | null;
  score: number | null;
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
  defaults: {
    browser: string;
    waitUntil: string;
    tags: string[];
    timeout: number;
    viewport: { width: number; height: number };
  };
  limits: { maxUrlsPerAudit: number; scanConcurrency: number };
}

export interface ScannedUrl {
  url: string;
  host: string;
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
