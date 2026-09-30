import type { AxeResults, ComplianceGroup } from '../../types/audit.types';
import { complianceGroup } from '../audit/levels';
import { aggregateCompliance, computeCompliance, emptyGroup } from '../audit/summary';
import {
  DEFAULT_MAX_NODES,
  scopeWarnings,
  compareFindingPriority,
  findingBase,
  reportedRules,
  toCompactNode,
  type CompactFinding,
  type CompactNode,
  type CompactPageInfo,
} from './compact';
import { fingerprint, normalizeHtml, type FingerprintPattern } from './fingerprint';

/**
 * Version propia de la exportacion agregada; la de por pagina sigue en 1.0.
 *
 * 1.1: `findings[].pages` pasa a ser `[indice en pages, nodos]` y desaparece
 * `findings[].viewports` (sale de `pages[indice].viewport`); el summary anade
 * `ruleOccurrences` (con `violations` como alias) y existe `detail=legal`.
 */
export const AGGREGATED_SCHEMA_VERSION = '1.1';

/** Nodos de ejemplo por regla en el bloque resumido de mejoras. */
export const MAX_IMPROVEMENT_EXAMPLES = 3;

export type ExportDetail = 'full' | 'legal';

/** `[indice en el array superior pages, nodos del grupo en esa pagina]`. */
export type PageRef = [number, number];

/**
 * Un grupo es una regla + estado + huella del elemento: el mismo componente
 * fallando igual en varias paginas. `count` suma los nodos de todas ellas y
 * `nodes` trae ejemplos distintos (selectores que cambian entre paginas).
 */
export interface AggregatedFinding extends CompactFinding {
  fingerprint: string;
  pages: PageRef[];
}

/**
 * Reglas AAA y de buenas practicas resumidas por regla y estado, en
 * `detail=legal`: se sabe que estan y donde, sin el detalle grupo a grupo.
 */
export interface ImprovementSummary {
  rule: string;
  status: CompactFinding['status'];
  level: CompactFinding['level'];
  impact: CompactFinding['impact'];
  help: string;
  helpUrl: string;
  /** Grupos (elementos distintos) que tendria en `detail=full`. */
  groups: number;
  count: number;
  /** Indices unicos en `pages`. */
  pages: number[];
  nodes: CompactNode[];
}

/**
 * En la agregada, `violations` sumaria la misma regla una vez por pagina (una
 * regla que falla en 18 paginas cuenta 18), y se leia como "reglas
 * incumplidas". `ruleOccurrences` dice lo que es; `violations` se mantiene
 * igual como alias para quien ya lo lea.
 */
export interface AggregatedComplianceGroup extends ComplianceGroup {
  ruleOccurrences: number;
}

export interface AggregatedSummary {
  legal: AggregatedComplianceGroup;
  improvements: AggregatedComplianceGroup;
  passes: number;
  inapplicable: number;
  /** Nodos con algun hallazgo antes de agrupar, frente a `groups` despues. Independiente de `detail`. */
  nodes: number;
  groups: number;
}

export interface AggregatedExport {
  schemaVersion: string;
  detail: ExportDetail;
  tool: { axe: string; tags: string[] };
  audit: { id: string; label: string | null; createdAt: string; status: string };
  pages: CompactPageInfo[];
  /** Paginas que no se pudieron escanear: lo que hay en `findings` no las cubre. */
  failedPages: Array<CompactPageInfo & { error: string | null }>;
  /** Selectores excluidos y en cuantas paginas. Lo excluido no esta en `findings`. */
  excluded: Array<{ selector: string; pages: number }>;
  /** Las mismas advertencias que en la exportacion por pagina, sin repetir. */
  warnings: string[];
  summary: AggregatedSummary;
  findings: AggregatedFinding[];
  /** Solo con `detail=legal`. */
  improvements?: ImprovementSummary[];
}

export interface AggregateInput {
  audit: AggregatedExport['audit'];
  tags: string[];
  pages: Array<{ info: CompactPageInfo; results: AxeResults }>;
  failedPages: AggregatedExport['failedPages'];
  maxNodes?: number;
  detail?: ExportDetail;
  patterns?: readonly FingerprintPattern[];
}

const withOccurrences = (group: ComplianceGroup): AggregatedComplianceGroup => {
  const { violations, ...rest } = group;
  return { ...rest, ruleOccurrences: violations, violations };
};

/** Lo que afecta a mas paginas primero dentro del mismo estado, nivel e impacto: suele ser un componente comun. */
const byPriorityThenReach = <T extends Pick<CompactFinding, 'status' | 'level' | 'impact' | 'count' | 'rule'>>(
  reach: (item: T) => number,
  tieBreak: (a: T, b: T) => number = () => 0,
) =>
  (a: T, b: T) =>
    compareFindingPriority(a, b) || reach(b) - reach(a) || b.count - a.count || a.rule.localeCompare(b.rule) || tieBreak(a, b);

const summarizeImprovements = (findings: AggregatedFinding[], maxNodes: number): ImprovementSummary[] => {
  const byRule = new Map<string, ImprovementSummary & { pageSet: Set<number> }>();

  for (const finding of findings) {
    const key = `${finding.status}\n${finding.rule}`;
    let entry = byRule.get(key);
    if (!entry) {
      entry = {
        rule: finding.rule,
        status: finding.status,
        level: finding.level,
        impact: finding.impact,
        help: finding.help,
        helpUrl: finding.helpUrl,
        groups: 0,
        count: 0,
        pages: [],
        nodes: [],
        pageSet: new Set(),
      };
      byRule.set(key, entry);
    }
    entry.groups++;
    entry.count += finding.count;
    for (const [index] of finding.pages) entry.pageSet.add(index);
    // Un ejemplo por grupo antes que varios del mismo: asi se ven elementos distintos.
    const example = finding.nodes[0];
    if (example && entry.nodes.length < Math.min(MAX_IMPROVEMENT_EXAMPLES, maxNodes)) entry.nodes.push(example);
  }

  return [...byRule.values()]
    .map(({ pageSet, ...entry }) => ({ ...entry, pages: [...pageSet].sort((a, b) => a - b) }))
    .sort(byPriorityThenReach((entry) => entry.pages.length));
};

export const buildAuditExport = (input: AggregateInput): AggregatedExport => {
  const maxNodes = input.maxNodes ?? DEFAULT_MAX_NODES;
  const detail = input.detail ?? 'full';
  const groups = new Map<string, AggregatedFinding>();
  let nodes = 0;

  input.pages.forEach(({ results }, pageIndex) => {
    for (const { rule, status } of reportedRules(results)) {
      for (const node of rule.nodes) {
        nodes++;
        const key = `${status}\n${rule.id}\n${normalizeHtml(node.html, input.patterns)}`;
        let group = groups.get(key);
        if (!group) {
          group = {
            ...findingBase(rule, status),
            fingerprint: fingerprint(rule.id, node.html, input.patterns),
            count: 0,
            nodes: [],
            pages: [],
          };
          groups.set(key, group);
        }
        group.count++;

        // Las paginas se recorren en orden, asi que la ultima referencia es la de esta pagina si ya existe.
        const last = group.pages[group.pages.length - 1];
        if (last && last[0] === pageIndex) last[1]++;
        else group.pages.push([pageIndex, 1]);

        if (group.nodes.length < maxNodes) {
          const example: CompactNode = toCompactNode(node);
          if (!group.nodes.some((n) => n.selector === example.selector && n.html === example.html)) {
            group.nodes.push(example);
          }
        }
      }
    }
  });

  const all = [...groups.values()].sort(
    byPriorityThenReach((finding) => finding.pages.length, (a, b) => a.fingerprint.localeCompare(b.fingerprint)),
  );
  const isLegal = (finding: AggregatedFinding) => complianceGroup(finding.level) === 'legal';

  const excluded = new Map<string, number>();
  for (const { info } of input.pages) {
    if (info.exclude) excluded.set(info.exclude, (excluded.get(info.exclude) ?? 0) + 1);
  }

  const compliance = aggregateCompliance(input.pages.map(({ results }) => computeCompliance(results)));

  return {
    schemaVersion: AGGREGATED_SCHEMA_VERSION,
    detail,
    tool: { axe: input.pages[0]?.results.testEngine?.version ?? 'desconocida', tags: input.tags },
    audit: input.audit,
    pages: input.pages.map(({ info }) => info),
    failedPages: input.failedPages,
    excluded: [...excluded.entries()].map(([selector, pages]) => ({ selector, pages })),
    warnings: [...new Set(input.pages.flatMap(({ info }) => scopeWarnings(info)))],
    summary: {
      legal: withOccurrences(compliance?.legal ?? emptyGroup()),
      improvements: withOccurrences(compliance?.improvements ?? emptyGroup()),
      passes: input.pages.reduce((sum, { results }) => sum + results.passes.length, 0),
      inapplicable: input.pages.reduce((sum, { results }) => sum + results.inapplicable.length, 0),
      nodes,
      groups: all.length,
    },
    ...(detail === 'legal'
      ? { findings: all.filter(isLegal), improvements: summarizeImprovements(all.filter((f) => !isLegal(f)), maxNodes) }
      : { findings: all }),
  };
};
