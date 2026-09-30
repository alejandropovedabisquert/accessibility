import { IMPACTS } from '../../types/audit.types';
import type {
  AxeResult,
  AxeResults,
  Compliance,
  Impact,
  RuleLevel,
  ScanScope,
  Viewport,
} from '../../types/audit.types';
import { en301549Clauses, LEVEL_ORDER, ruleLevel, wcagCriteria } from '../audit/levels';
import { computeCompliance } from '../audit/summary';

/**
 * Exportacion compacta pensada para pasarsela a un modelo de IA.
 *
 * El JSON crudo de axe pesa cerca de 1 MB por pagina y el 91 % es `passes`,
 * que no aporta nada para decidir que arreglar. Aqui solo van los
 * incumplimientos y lo que requiere revision manual, con unos pocos nodos de
 * ejemplo por regla y el HTML recortado. Si cambias la forma, sube
 * `COMPACT_SCHEMA_VERSION`: quien lo consuma puede depender de ella.
 */
export const COMPACT_SCHEMA_VERSION = '1.0';

export const DEFAULT_MAX_NODES = 5;
export const MAX_NODES_LIMIT = 50;
/** Lo justo para reconocer el elemento; el HTML completo ya esta en el JSON crudo. */
export const MAX_HTML_LENGTH = 150;
export const MAX_MESSAGE_LENGTH = 200;

export type FindingStatus = 'fail' | 'needs-review';

export interface CompactNode {
  selector: string;
  html: string;
  message: string;
}

export interface CompactFinding {
  rule: string;
  status: FindingStatus;
  level: RuleLevel;
  wcag: string[];
  en301549: string[];
  impact: Impact | null;
  help: string;
  helpUrl: string;
  /** Nodos afectados en total, aunque en `nodes` solo vayan unos pocos. */
  count: number;
  nodes: CompactNode[];
}

export interface CompactSummary extends Compliance {
  passes: number;
  inapplicable: number;
}

export interface CompactPageInfo extends ScanScope {
  url: string;
  viewport: Viewport | null;
  scannedAt: string;
}

export interface CompactPageExport {
  schemaVersion: string;
  tool: { axe: string; tags: string[] };
  page: CompactPageInfo;
  /** Limites del analisis que quien lea los findings tiene que conocer (exclusiones, seccion). */
  warnings: string[];
  summary: CompactSummary;
  findings: CompactFinding[];
}

type AxeNode = AxeResult['nodes'][number];

export const EXCLUDE_WARNING = (selector: string) =>
  `Se excluyo del analisis "${selector}": no se ha auditado. Si es contenido propio y no de un tercero, ` +
  'forma parte del sitio, cuenta para el cumplimiento legal y hay que revisarlo por separado.';

export const INCLUDE_WARNING = (selector: string) =>
  `Solo se analizo "${selector}": axe omite las reglas de ambito de pagina ` +
  '(html-has-lang, document-title, landmark-one-main, region...), que no se han comprobado.';

/**
 * Lo excluido no aparece en `findings`, y un modelo que lea el JSON lo tomaria
 * por "sin fallos". Por eso se dice explicitamente, no solo en `page.exclude`.
 */
export const scopeWarnings = (scope: ScanScope): string[] => [
  ...(scope.exclude ? [EXCLUDE_WARNING(scope.exclude)] : []),
  ...(scope.include ? [INCLUDE_WARNING(scope.include)] : []),
];

export const truncate = (value: string, max: number): string =>
  value.length > max ? `${value.slice(0, max - 1)}…` : value;

/**
 * El ultimo elemento de `target` es el propio nodo (los anteriores son los
 * iframes que lo contienen). Si esta dentro de shadow DOM, ese elemento es a su
 * vez una lista host → hijo, que se une con `>>>` como hace Playwright.
 */
export const nodeSelector = (node: Pick<AxeNode, 'target'>): string => {
  const last = node.target[node.target.length - 1];
  if (last === undefined) return '';
  return typeof last === 'string' ? last : (last as unknown[]).flat(Infinity).join(' >>> ');
};

/** Mensajes de los checks que fallan, sin repetir: `none` y `all` fallan todos; de `any` no paso ninguno. */
export const nodeMessage = (node: Pick<AxeNode, 'any' | 'all' | 'none'>): string => {
  const messages = [...node.none, ...node.all, ...node.any]
    .map((check) => check.message?.trim())
    .filter((message): message is string => Boolean(message));
  return truncate([...new Set(messages)].join('; '), MAX_MESSAGE_LENGTH);
};

export const toCompactNode = (node: AxeNode): CompactNode => ({
  selector: nodeSelector(node),
  html: truncate(node.html.replace(/\s+/g, ' ').trim(), MAX_HTML_LENGTH),
  message: nodeMessage(node),
});

const toImpact = (value: unknown): Impact | null =>
  typeof value === 'string' && (IMPACTS as readonly string[]).includes(value) ? (value as Impact) : null;

/** Todo lo de un finding salvo los nodos, que cada exportacion elige a su manera. */
export const findingBase = (rule: AxeResult, status: FindingStatus): Omit<CompactFinding, 'count' | 'nodes'> => ({
  rule: rule.id,
  status,
  level: ruleLevel(rule.tags),
  wcag: wcagCriteria(rule.tags),
  en301549: en301549Clauses(rule.tags),
  impact: toImpact(rule.impact),
  help: rule.help,
  helpUrl: rule.helpUrl,
});

const IMPACT_RANK = (impact: Impact | null) => (impact ? IMPACTS.indexOf(impact) : IMPACTS.length);

type Prioritized = Pick<CompactFinding, 'status' | 'level' | 'impact'>;

/** Incumplimientos antes que revisiones; luego nivel (A primero) e impacto (critico primero). */
export const compareFindingPriority = (a: Prioritized, b: Prioritized): number =>
  (a.status === b.status ? 0 : a.status === 'fail' ? -1 : 1) ||
  LEVEL_ORDER.indexOf(a.level) - LEVEL_ORDER.indexOf(b.level) ||
  IMPACT_RANK(a.impact) - IMPACT_RANK(b.impact);

export const compareFindings = (a: CompactFinding, b: CompactFinding): number =>
  compareFindingPriority(a, b) || b.count - a.count || a.rule.localeCompare(b.rule);

/** Reglas de axe que acaban en `findings`, cada una con su estado. */
export const reportedRules = (results: Pick<AxeResults, 'violations' | 'incomplete'>) => [
  ...results.violations.map((rule) => ({ rule, status: 'fail' as const })),
  ...results.incomplete.map((rule) => ({ rule, status: 'needs-review' as const })),
];

export const buildPageExport = (input: {
  results: AxeResults;
  page: CompactPageInfo;
  tags: string[];
  maxNodes?: number;
}): CompactPageExport => {
  const { results, page, tags, maxNodes = DEFAULT_MAX_NODES } = input;

  const findings = reportedRules(results)
    .map(({ rule, status }) => ({
      ...findingBase(rule, status),
      count: rule.nodes.length,
      nodes: rule.nodes.slice(0, maxNodes).map(toCompactNode),
    }))
    .sort(compareFindings);

  return {
    schemaVersion: COMPACT_SCHEMA_VERSION,
    tool: { axe: results.testEngine?.version ?? 'desconocida', tags },
    page,
    warnings: scopeWarnings(page),
    summary: {
      ...computeCompliance(results),
      passes: results.passes.length,
      inapplicable: results.inapplicable.length,
    },
    findings,
  };
};
