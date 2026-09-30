import { IMPACTS } from '../../types/audit.types';
import type {
  AxeResults,
  Compliance,
  ComplianceGroup,
  Counters,
  Impact,
  PageIssue,
} from '../../types/audit.types';
import { complianceGroup, ruleLevel } from './levels';

const emptyCounters = (): Counters => ({
  violations: 0,
  violationNodes: 0,
  critical: 0,
  serious: 0,
  moderate: 0,
  minor: 0,
  passes: 0,
  incomplete: 0,
  inapplicable: 0,
});

export const emptyGroup = (): ComplianceGroup => ({
  score: null,
  passes: 0,
  violations: 0,
  violationNodes: 0,
  critical: 0,
  serious: 0,
  moderate: 0,
  minor: 0,
  incomplete: 0,
});

const isImpact = (value: unknown): value is Impact =>
  typeof value === 'string' && (IMPACTS as readonly string[]).includes(value);

/**
 * Porcentaje de reglas aplicables que la pagina supera.
 *
 * Deliberadamente NO es un "score" ponderado inventado: es un dato verificable
 * (reglas superadas / reglas aplicables). Las reglas `inapplicable` no cuentan
 * porque no habia nada que evaluar, y las `incomplete` tampoco porque axe no
 * pudo decidir y requieren revision manual.
 */
export const computeScore = (passes: number, violations: number): number => {
  const applicable = passes + violations;
  if (applicable === 0) return 100;
  return Math.round((passes / applicable) * 1000) / 10;
};

/**
 * Separa las reglas en cumplimiento legal (A/AA) y mejoras (AAA y buenas
 * practicas), con la misma formula que el score global.
 *
 * Un grupo sin ninguna regla evaluada (ni siquiera inaplicable) deja `score` a
 * null: con los tags por defecto no se ejecuta ninguna mejora, y un 100 % ahi
 * se leeria como "cumple" cuando lo cierto es "no se ha mirado".
 */
export const computeCompliance = (
  results: Pick<AxeResults, 'violations' | 'passes' | 'incomplete' | 'inapplicable'>,
): Compliance => {
  const compliance: Compliance = { legal: emptyGroup(), improvements: emptyGroup() };
  const evaluated = { legal: false, improvements: false };
  const groupOf = (tags: string[]) => complianceGroup(ruleLevel(tags));

  for (const violation of results.violations) {
    const key = groupOf(violation.tags);
    const group = compliance[key];
    evaluated[key] = true;
    group.violations++;
    group.violationNodes += violation.nodes.length;
    if (isImpact(violation.impact)) group[violation.impact]++;
  }
  for (const pass of results.passes) {
    const key = groupOf(pass.tags);
    evaluated[key] = true;
    compliance[key].passes++;
  }
  for (const item of results.incomplete) {
    const key = groupOf(item.tags);
    evaluated[key] = true;
    compliance[key].incomplete++;
  }
  for (const item of results.inapplicable) {
    evaluated[groupOf(item.tags)] = true;
  }

  for (const key of ['legal', 'improvements'] as const) {
    const group = compliance[key];
    group.score = evaluated[key] ? computeScore(group.passes, group.violations) : null;
  }
  return compliance;
};

/**
 * Agregado de una auditoria: contadores sumados y score medio de las paginas,
 * igual que el score global de `finalizeAudit`. Las paginas sin desglose
 * (antiguas sin JSON crudo) no cuentan.
 */
export const aggregateCompliance = (pages: Array<Compliance | null>): Compliance | null => {
  const known = pages.filter((page): page is Compliance => page !== null);
  if (known.length === 0) return null;

  const result: Compliance = { legal: emptyGroup(), improvements: emptyGroup() };
  for (const key of ['legal', 'improvements'] as const) {
    const target = result[key];
    const scores: number[] = [];
    for (const page of known) {
      const group = page[key];
      target.passes += group.passes;
      target.violations += group.violations;
      target.violationNodes += group.violationNodes;
      target.critical += group.critical;
      target.serious += group.serious;
      target.moderate += group.moderate;
      target.minor += group.minor;
      target.incomplete += group.incomplete;
      if (group.score !== null) scores.push(group.score);
    }
    target.score =
      scores.length > 0
        ? Math.round((scores.reduce((sum, score) => sum + score, 0) / scores.length) * 10) / 10
        : null;
  }
  return result;
};

export const summarize = (
  results: AxeResults,
): { counters: Counters; score: number; compliance: Compliance; issues: PageIssue[] } => {
  const counters = emptyCounters();
  const issues: PageIssue[] = [];

  for (const violation of results.violations) {
    const nodeCount = violation.nodes.length;
    counters.violations++;
    counters.violationNodes += nodeCount;
    if (isImpact(violation.impact)) counters[violation.impact]++;

    issues.push({
      ruleId: violation.id,
      impact: isImpact(violation.impact) ? violation.impact : null,
      level: ruleLevel(violation.tags),
      nodeCount,
      help: violation.help,
      helpUrl: violation.helpUrl,
      description: violation.description,
    });
  }

  counters.passes = results.passes.length;
  counters.incomplete = results.incomplete.length;
  counters.inapplicable = results.inapplicable.length;

  return {
    counters,
    score: computeScore(counters.passes, counters.violations),
    compliance: computeCompliance(results),
    issues,
  };
};
