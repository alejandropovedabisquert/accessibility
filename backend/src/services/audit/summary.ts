import { IMPACTS } from '../../types/audit.types';
import type { AxeResults, Counters, Impact, PageIssue } from '../../types/audit.types';

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

export const summarize = (results: AxeResults): { counters: Counters; score: number; issues: PageIssue[] } => {
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
      nodeCount,
      help: violation.help,
      helpUrl: violation.helpUrl,
      description: violation.description,
    });
  }

  counters.passes = results.passes.length;
  counters.incomplete = results.incomplete.length;
  counters.inapplicable = results.inapplicable.length;

  return { counters, score: computeScore(counters.passes, counters.violations), issues };
};
