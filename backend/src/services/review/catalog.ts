import axe from 'axe-core';
import { z } from 'zod';
import type { Check, CheckCatalog, EvidenceKind } from '../../types/audit.types';
import { wcagCriteria } from '../audit/levels';
import rawCatalog from './catalog/wcag22.v2.json';

const EVIDENCE_KINDS = [
  'screenshot',
  'orientation',
  'focus-sequence',
  'reflow-320',
  'zoom-200',
  'text-spacing',
  'images',
  'media',
  'forms',
  'controls',
  'headings',
  'landmarks',
  'text-content',
  'interaction',
] as const satisfies readonly EvidenceKind[];

const catalogSchema = z.object({
  id: z.string().min(1),
  version: z.number().int().positive(),
  wcagVersion: z.enum(['2.0', '2.1', '2.2']),
  checks: z.array(
    z.object({
      id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
      criterion: z.string().regex(/^\d\.\d\.\d+$/),
      level: z.enum(['A', 'AA', 'AAA']),
      introducedIn: z.enum(['2.0', '2.1', '2.2']),
      name: z.string().min(1),
      scope: z.enum(['page', 'site']),
      evidence: z.array(z.enum(EVIDENCE_KINDS)).min(1),
      requiresAssistiveTech: z.boolean(),
      appliesWhen: z.string().min(1).nullable(),
      instructions: z.string().min(1),
    }),
  ),
});

/**
 * Reglas de axe por criterio, sacadas de los tags de la version instalada. No
 * se escriben en el catalogo para que no se desfasen al actualizar axe. Las
 * reglas obsoletas (`duplicate-id`, criterio 4.1.1) no llegan a ningun
 * criterio del catalogo porque 4.1.1 ya no esta en WCAG 2.2.
 */
const axeRulesByCriterion = (): Map<string, string[]> => {
  const byCriterion = new Map<string, string[]>();
  for (const rule of axe.getRules()) {
    for (const criterion of wcagCriteria(rule.tags)) {
      byCriterion.set(criterion, [...(byCriterion.get(criterion) ?? []), rule.ruleId]);
    }
  }
  return byCriterion;
};

export const buildCatalog = (raw: unknown): CheckCatalog => {
  const parsed = catalogSchema.parse(raw);
  const axeRules = axeRulesByCriterion();

  const checks = parsed.checks.map((entry): Check => {
    const rules = [...(axeRules.get(entry.criterion) ?? [])].sort();
    return {
      ...entry,
      // EN 301 549 v3.2.1 incorpora WCAG 2.1 A/AA en el apartado 9 con la misma
      // numeracion; lo nuevo de 2.2 aun no tiene apartado y AAA no lo exige.
      // TODO: cuando EN 301 549 v4.1.1 (WCAG 2.2, publicada por ETSI en 09/2026) se
      // cite en el DOUE:
      //  1. Los seis criterios nuevos de WCAG 2.2 A/AA pasan a legales.
      //  2. El 4.1.1 Parsing deja de serlo.
      //  3. Version nueva del catalogo. Esto se calcula al cargar y no se guarda por
      //     version, asi que `checksOfVersion` tiene que conservar el criterio legal
      //     de la v2, o las firmas antiguas pasaran a `stillMatches: false`.
      // Revisar tambien si el OAW publica metodologia nueva y si cambia la regla de
      // `conformanceOf`, y los textos "WCAG 2.1 ... EN 301 549 v3.2.1" del PDF y la UI.
      en301549: entry.introducedIn === '2.2' || entry.level === 'AAA' ? null : `9.${entry.criterion}`,
      axeRules: rules,
      coverage: rules.length > 0 ? 'partial' : 'manual',
    };
  });

  return { id: parsed.id, version: parsed.version, wcagVersion: parsed.wcagVersion, checks };
};

/** Se valida al importar: un catalogo roto tiene que tumbar el arranque, no una revision. */
export const catalog: CheckCatalog = buildCatalog(rawCatalog);

const CHECK_BY_ID = new Map(catalog.checks.map((check) => [check.id, check]));
const CHECKS_BY_RULE = new Map<string, Check[]>();
for (const check of catalog.checks) {
  for (const rule of check.axeRules) {
    CHECKS_BY_RULE.set(rule, [...(CHECKS_BY_RULE.get(rule) ?? []), check]);
  }
}

export const findCheck = (id: string): Check | undefined => CHECK_BY_ID.get(id);

/**
 * Criterios de una version del catalogo, para recalcular una firma hecha con
 * ella: si se recalculase con los de ahora, toda firma antigua dejaria de
 * coincidir. La v1 (`wcag22-aa`) era la actual sin los AAA; la v2 solo anadio
 * criterios, asi que basta con filtrar. Una version futura que cambie textos o
 * criterios ya existentes necesitara guardar la anterior.
 */
export const checksOfVersion = (version: number): Check[] =>
  version >= 2 ? catalog.checks : catalog.checks.filter((check) => check.level !== 'AAA');

/**
 * Criterios a los que afecta una regla de axe, en orden de la especificacion.
 * Puede ser mas de uno (`link-name`: 2.4.4 y 4.1.2). Vacio si la regla es
 * una buena practica.
 */
export const checksForAxeRule = (ruleId: string): Check[] => CHECKS_BY_RULE.get(ruleId) ?? [];
