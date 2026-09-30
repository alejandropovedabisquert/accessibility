import axe from 'axe-core';
import type { ComplianceGroupKey, RuleLevel } from '../../types/audit.types';

export const LEVEL_ORDER: readonly RuleLevel[] = ['A', 'AA', 'AAA', 'best-practice'] as const;

// Tags de nivel de axe: wcag2a, wcag21aa, wcag22aa, wcag2aaa... El numero de
// version va opcional porque axe no repite el nivel por cada version de WCAG.
const AAA_TAG = /^wcag2\d?aaa$/;
const AA_TAG = /^wcag2\d?aa$/;
const A_TAG = /^wcag2\d?a$/;

/**
 * Nivel de una regla a partir de sus tags de axe.
 *
 * AAA gana a todo: si una regla lleva wcag2aaa, no es exigible legalmente
 * aunque tambien lleve otros tags. Lo que no tiene ningun tag de nivel cuenta
 * como buena practica: en axe 4.13 solo son las `best-practice` y dos reglas
 * obsoletas (`duplicate-id*`, tag `wcag2a-obsolete`) que ya no exige WCAG 2.2.
 */
export const ruleLevel = (tags: readonly string[]): RuleLevel => {
  if (tags.some((tag) => AAA_TAG.test(tag))) return 'AAA';
  if (tags.some((tag) => AA_TAG.test(tag))) return 'AA';
  if (tags.some((tag) => A_TAG.test(tag))) return 'A';
  return 'best-practice';
};

/** Ley 11/2023 / EN 301 549 exigen WCAG A y AA; el resto es mejora. */
export const complianceGroup = (level: RuleLevel): ComplianceGroupKey =>
  level === 'A' || level === 'AA' ? 'legal' : 'improvements';

/** Criterios WCAG de los tags tipo `wcag412` → `4.1.2`, `wcag1410` → `1.4.10`. */
export const wcagCriteria = (tags: readonly string[]): string[] =>
  tags.flatMap((tag) => {
    const match = /^wcag(\d)(\d)(\d+)$/.exec(tag);
    return match ? [`${match[1]}.${match[2]}.${match[3]}`] : [];
  });

/** Apartados de EN 301 549 de los tags tipo `EN-9.4.1.2`. `EN-301-549` es el tag del conjunto, no un apartado. */
export const en301549Clauses = (tags: readonly string[]): string[] =>
  tags.flatMap((tag) => {
    const match = /^EN-(\d+(?:\.\d+)+)$/.exec(tag);
    return match?.[1] ? [match[1]] : [];
  });

/**
 * Nivel por id de regla, para las filas de `page_issues` guardadas antes de que
 * existiera la columna `level`. Sale de los metadatos de la version de axe
 * instalada, que son los mismos tags que acompanan a cada resultado.
 */
const LEVEL_BY_RULE = new Map(axe.getRules().map((rule) => [rule.ruleId, ruleLevel(rule.tags)]));

export const levelOfRule = (ruleId: string): RuleLevel => LEVEL_BY_RULE.get(ruleId) ?? 'best-practice';
