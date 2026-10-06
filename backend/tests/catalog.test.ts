import axe from 'axe-core';
import { describe, expect, it } from 'vitest';
import { buildCatalog, catalog, checksForAxeRule, checksOfVersion, findCheck } from '../src/services/review/catalog';
import rawCatalog from '../src/services/review/catalog/wcag22.v2.json';

// Criterios de WCAG 2.2 por nivel, copiados de la especificacion y no del
// catalogo, para que un criterio olvidado o duplicado en el JSON se note.
const WCAG22_A = [
  '1.1.1', '1.2.1', '1.2.2', '1.2.3', '1.3.1', '1.3.2', '1.3.3', '1.4.1', '1.4.2',
  '2.1.1', '2.1.2', '2.1.4', '2.2.1', '2.2.2', '2.3.1', '2.4.1', '2.4.2', '2.4.3',
  '2.4.4', '2.5.1', '2.5.2', '2.5.3', '2.5.4', '3.1.1', '3.2.1', '3.2.2', '3.2.6',
  '3.3.1', '3.3.2', '3.3.7', '4.1.2',
];
const WCAG22_AA = [
  '1.2.4', '1.2.5', '1.3.4', '1.3.5', '1.4.3', '1.4.4', '1.4.5', '1.4.10', '1.4.11',
  '1.4.12', '1.4.13', '2.4.5', '2.4.6', '2.4.7', '2.4.11', '2.5.7', '2.5.8', '3.1.2',
  '3.2.3', '3.2.4', '3.3.3', '3.3.4', '3.3.8', '4.1.3',
];
const WCAG22_AAA = [
  '1.2.6', '1.2.7', '1.2.8', '1.2.9', '1.3.6', '1.4.6', '1.4.7', '1.4.8', '1.4.9',
  '2.1.3', '2.2.3', '2.2.4', '2.2.5', '2.2.6', '2.3.2', '2.3.3', '2.4.8', '2.4.9',
  '2.4.10', '2.4.12', '2.4.13', '2.5.5', '2.5.6', '3.1.3', '3.1.4', '3.1.5', '3.1.6',
  '3.2.5', '3.3.5', '3.3.6', '3.3.9',
];
const NEW_IN_22 = ['2.4.11', '2.5.7', '2.5.8', '3.2.6', '3.3.7', '3.3.8', '2.4.12', '2.4.13', '3.3.9'];

const byCriterion = (criterion: string) => catalog.checks.find((check) => check.criterion === criterion);

const specOrder = (a: string, b: string) => {
  const [x, y] = [a, b].map((criterion) => criterion.split('.').map(Number));
  return (x?.[0] ?? 0) - (y?.[0] ?? 0) || (x?.[1] ?? 0) - (y?.[1] ?? 0) || (x?.[2] ?? 0) - (y?.[2] ?? 0);
};

describe('catalogo de revision WCAG 2.2', () => {
  it('tiene exactamente los criterios A, AA y AAA, cada uno una vez y con su nivel', () => {
    const criteria = catalog.checks.map((check) => check.criterion);
    expect(new Set(criteria).size).toBe(criteria.length);
    expect([...criteria].sort()).toEqual([...WCAG22_A, ...WCAG22_AA, ...WCAG22_AAA].sort());
    for (const criterion of WCAG22_A) expect(byCriterion(criterion)?.level).toBe('A');
    for (const criterion of WCAG22_AA) expect(byCriterion(criterion)?.level).toBe('AA');
    for (const criterion of WCAG22_AAA) expect(byCriterion(criterion)?.level).toBe('AAA');
  });

  it('va en el orden de la especificacion', () => {
    const criteria = catalog.checks.map((check) => check.criterion);
    expect(criteria).toEqual([...criteria].sort(specOrder));
  });

  it('la v1 era la actual sin los AAA, para recalcular las firmas antiguas', () => {
    expect(checksOfVersion(1).map((check) => check.criterion).sort()).toEqual([...WCAG22_A, ...WCAG22_AA].sort());
    expect(checksOfVersion(catalog.version)).toEqual(catalog.checks);
  });

  it('no incluye 4.1.1, obsoleto en WCAG 2.2', () => {
    expect(byCriterion('4.1.1')).toBeUndefined();
    expect(checksForAxeRule('duplicate-id')).toEqual([]);
  });

  it('los ids son unicos', () => {
    const ids = catalog.checks.map((check) => check.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('los nuevos de 2.2 y los AAA no tienen apartado de EN 301 549; el resto, el 9.x', () => {
    for (const check of catalog.checks) {
      const isNew = NEW_IN_22.includes(check.criterion);
      expect(check.introducedIn === '2.2').toBe(isNew);
      expect(check.en301549).toBe(isNew || check.level === 'AAA' ? null : `9.${check.criterion}`);
    }
  });

  it('saca las reglas de axe de la version instalada y la cobertura de ellas', () => {
    const installed = new Set(axe.getRules().map((rule) => rule.ruleId));
    for (const check of catalog.checks) {
      for (const rule of check.axeRules) expect(installed.has(rule)).toBe(true);
      expect(check.coverage).toBe(check.axeRules.length > 0 ? 'partial' : 'manual');
    }
    expect(findCheck('contrast-minimum')?.axeRules).toContain('color-contrast');
    expect(findCheck('focus-order')?.coverage).toBe('manual');
  });

  it('una regla que toca varios criterios los devuelve todos, en orden', () => {
    expect(checksForAxeRule('link-name').map((check) => check.criterion)).toEqual(['2.4.4', '4.1.2']);
    expect(checksForAxeRule('color-contrast-enhanced').map((check) => check.id)).toEqual(['contrast-enhanced']);
    expect(checksForAxeRule('meta-refresh-no-exceptions').map((check) => check.criterion)).toEqual(['2.2.4', '3.2.5']);
  });

  it('los criterios de sitio son los que comparan paginas entre si', () => {
    const siteScoped = catalog.checks.filter((check) => check.scope === 'site').map((check) => check.criterion);
    expect(siteScoped.sort()).toEqual(['2.4.5', '3.2.3', '3.2.4', '3.2.6']);
  });

  it('rechaza un catalogo con una evidencia desconocida', () => {
    const [first, ...rest] = rawCatalog.checks;
    const broken = { ...rawCatalog, checks: [{ ...first, evidence: ['telepatia'] }, ...rest] };
    expect(() => buildCatalog(broken)).toThrow();
  });
});
