import type {
  ConformanceStatus,
  AuditStatus,
  ComplianceGroupKey,
  EarlOutcome,
  ReviewStatus,
  Assertor,
  Impact,
  Meta,
  PageStatus,
  RuleLevel,
  ScanScreen,
  Viewport,
} from './types';

export const formatDateTime = (iso: string | null): string => {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export const formatRelative = (iso: string | null): string => {
  if (!iso) return '—';
  const diffSeconds = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['second', 60],
    ['minute', 60],
    ['hour', 24],
    ['day', 30],
    ['month', 12],
    ['year', Infinity],
  ];

  let value = diffSeconds;
  for (const [unit, size] of units) {
    if (Math.abs(value) < size) {
      return new Intl.RelativeTimeFormat('es-ES', { numeric: 'auto' }).format(Math.round(value), unit);
    }
    value /= size;
  }
  return formatDateTime(iso);
};

export const formatDuration = (ms: number | null): string => {
  if (ms === null) return '—';
  if (ms < 1000) return `${ms} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  return `${Math.floor(seconds / 60)} min ${Math.round(seconds % 60)} s`;
};

export const displayUrl = (url: string): string => url.replace(/^https?:\/\//, '').replace(/\/$/, '');

export const AUDIT_STATUS_LABEL: Record<AuditStatus, string> = {
  queued: 'En cola',
  running: 'Escaneando',
  completed: 'Completada',
  failed: 'Fallida',
};

export const PAGE_STATUS_LABEL: Record<PageStatus, string> = {
  pending: 'Pendiente',
  running: 'Escaneando',
  completed: 'Completada',
  failed: 'Fallida',
};

export const IMPACT_LABEL: Record<Impact, string> = {
  critical: 'Crítico',
  serious: 'Grave',
  moderate: 'Moderado',
  minor: 'Leve',
};

export const isInProgress = (status: AuditStatus): boolean =>
  status === 'queued' || status === 'running';

export const formatViewport = (viewport: Viewport): string => `${viewport.width}×${viewport.height}`;

/** "iPhone 15 (393×659)", "390×844" o "—" en filas antiguas sin pantalla conocida. */
export const screenLabel = ({ viewport, device }: ScanScreen): string => {
  const size = viewport ? formatViewport(viewport) : null;
  if (device) return size ? `${device} (${size})` : device;
  return size ?? '—';
};

/** Parámetros de consulta de `/api/history` que identifican la pantalla de una serie. */
export const screenQuery = ({ viewport, device }: ScanScreen): Record<string, string> => ({
  ...(viewport ? { viewport: `${viewport.width}x${viewport.height}` } : {}),
  ...(device ? { device } : {}),
});

/** Valor del desplegable de sección que abre el campo de selector libre. */
export const CUSTOM_SECTION = '__custom__';

/**
 * Nombre legible de una sección. En la BD se guarda el selector CSS resuelto y
 * no el id del atajo, así que se busca al revés contra la lista que sirve
 * `/api/meta`. Si no es un atajo conocido, se enseña el CSS tal cual.
 */
export const sectionLabel = (
  include: string | null,
  sections: Meta['sections'] = []
): string | null => {
  if (!include) return null;
  return sections.find((section) => section.selector === include)?.label ?? include;
};

export const LEVEL_LABEL: Record<RuleLevel, string> = {
  A: 'WCAG A',
  AA: 'WCAG AA',
  AAA: 'WCAG AAA',
  'best-practice': 'Buena práctica',
};

/**
 * Copia de `ruleLevel` del backend (no hay paquete compartido): AAA gana a
 * todo, luego AA, luego A; sin tag de nivel es buena práctica.
 */
export const ruleLevel = (tags: readonly string[]): RuleLevel => {
  if (tags.some((tag) => /^wcag2\d?aaa$/.test(tag))) return 'AAA';
  if (tags.some((tag) => /^wcag2\d?aa$/.test(tag))) return 'AA';
  if (tags.some((tag) => /^wcag2\d?a$/.test(tag))) return 'A';
  return 'best-practice';
};

export const complianceGroup = (level: RuleLevel): ComplianceGroupKey =>
  level === 'A' || level === 'AA' ? 'legal' : 'improvements';

export const COMPLIANCE_LABEL: Record<ComplianceGroupKey, { title: string; hint: string }> = {
  legal: {
    title: 'Cumplimiento legal',
    hint: 'WCAG A y AA: lo que exigen la Ley 11/2023 y EN 301 549',
  },
  improvements: {
    title: 'Mejoras',
    hint: 'WCAG AAA y buenas prácticas: no exigibles legalmente',
  },
};

/** Resultados EARL en castellano. `untested` es "nadie lo ha mirado", no "no cumple". */
export const OUTCOME_LABEL: Record<EarlOutcome, string> = {
  passed: 'Cumple',
  failed: 'No cumple',
  cantTell: 'Sin decidir',
  inapplicable: 'No aplica',
  untested: 'Sin revisar',
};

export const OUTCOMES: readonly EarlOutcome[] = ['failed', 'cantTell', 'untested', 'passed', 'inapplicable'];

export const REVIEW_STATUS_LABEL: Record<ReviewStatus, string> = {
  proposed: 'Pendiente de validar',
  validated: 'Validado',
  rejected: 'Rechazado',
  amended: 'Corregido',
};

export const assertorLabel = (assertor: Assertor): string => {
  if (assertor.type === 'tool') return assertor.name;
  if (assertor.type === 'ai') return assertor.model ? `${assertor.name} (${assertor.model})` : `${assertor.name} (IA)`;
  return assertor.assistiveTech ? `${assertor.name} · ${assertor.assistiveTech}` : assertor.name;
};

const OUTCOME_SEVERITY: readonly EarlOutcome[] = ['failed', 'cantTell', 'passed', 'inapplicable', 'untested'];

/**
 * Estado de un criterio de sitio: lo peor de sus hallazgos no rechazados. Es la
 * misma regla que `deriveOutcome` del backend, sin la parte de axe (los
 * criterios de sitio no tienen reglas de axe).
 */
export const siteCheckOutcome = (findings: ReadonlyArray<{ outcome: EarlOutcome; review: { status: ReviewStatus } }>): EarlOutcome => {
  const outcomes = new Set(findings.filter((finding) => finding.review.status !== 'rejected').map((finding) => finding.outcome));
  return OUTCOME_SEVERITY.find((outcome) => outcomes.has(outcome)) ?? 'untested';
};

/** Los tres estados de la declaración de accesibilidad del RD 1112/2018. */
export const CONFORMANCE_LABEL: Record<ConformanceStatus, string> = {
  full: 'Plenamente conforme',
  partial: 'Parcialmente conforme',
  'non-conformant': 'No conforme',
};
