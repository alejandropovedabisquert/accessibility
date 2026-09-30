import { describe, expect, it } from 'vitest';
import {
  complianceGroup,
  en301549Clauses,
  levelOfRule,
  ruleLevel,
  wcagCriteria,
} from '../src/services/audit/levels';
import { aggregateCompliance, computeCompliance } from '../src/services/audit/summary';
import type { AxeResults } from '../src/types/audit.types';

describe('clasificacion de reglas por nivel', () => {
  it.each<[string[], string]>([
    [['cat.text-alternatives', 'wcag2a', 'wcag111', 'EN-301-549', 'EN-9.1.1.1'], 'A'],
    [['cat.color', 'wcag2aa', 'wcag143', 'EN-9.1.4.3'], 'AA'],
    [['wcag21aa', 'wcag1410'], 'AA'],
    [['wcag22aa', 'wcag258'], 'AA'],
    [['wcag21a', 'wcag2411'], 'A'],
    [['cat.color', 'wcag2aaa', 'wcag146', 'ACT'], 'AAA'],
    [['cat.semantics', 'best-practice'], 'best-practice'],
    // Obsoleta en WCAG 2.2: no tiene tag de nivel vigente.
    [['cat.parsing', 'wcag2a-obsolete', 'wcag411', 'deprecated'], 'best-practice'],
  ])('%j -> %s', (tags, level) => {
    expect(ruleLevel(tags)).toBe(level);
  });

  it('AAA gana aunque la regla tenga tambien otro nivel', () => {
    expect(ruleLevel(['wcag2aa', 'wcag2aaa'])).toBe('AAA');
  });

  it('solo A y AA cuentan como cumplimiento legal', () => {
    expect(complianceGroup('A')).toBe('legal');
    expect(complianceGroup('AA')).toBe('legal');
    expect(complianceGroup('AAA')).toBe('improvements');
    expect(complianceGroup('best-practice')).toBe('improvements');
  });

  it('extrae criterios WCAG y apartados de EN 301 549 de los tags', () => {
    const tags = ['wcag2a', 'wcag412', 'wcag1410', 'EN-301-549', 'EN-9.4.1.2', 'wcag2a-obsolete'];
    expect(wcagCriteria(tags)).toEqual(['4.1.2', '1.4.10']);
    expect(en301549Clauses(tags)).toEqual(['9.4.1.2']);
  });

  it('deduce el nivel de una regla por su id con los metadatos de axe', () => {
    expect(levelOfRule('image-alt')).toBe('A');
    expect(levelOfRule('color-contrast')).toBe('AA');
    expect(levelOfRule('color-contrast-enhanced')).toBe('AAA');
    expect(levelOfRule('region')).toBe('best-practice');
  });
});

type Item = AxeResults['violations'][number];
const rule = (id: string, tags: string[], nodes = 1, impact: Item['impact'] = 'serious') =>
  ({ id, tags, impact, nodes: Array.from({ length: nodes }, () => ({})) }) as unknown as Item;

describe('metricas legal / mejoras', () => {
  const results = {
    violations: [rule('image-alt', ['wcag2a'], 2, 'critical'), rule('region', ['best-practice'], 5, 'moderate')],
    passes: [rule('html-has-lang', ['wcag2a']), rule('color-contrast', ['wcag2aa']), rule('x', ['wcag2aaa'])],
    incomplete: [rule('color-contrast-enhanced', ['wcag2aaa'])],
    inapplicable: [],
  };

  it('separa contadores y score por grupo', () => {
    const { legal, improvements } = computeCompliance(results);

    expect(legal).toEqual({
      score: 66.7,
      passes: 2,
      violations: 1,
      violationNodes: 2,
      critical: 1,
      serious: 0,
      moderate: 0,
      minor: 0,
      incomplete: 0,
    });
    expect(improvements.score).toBe(50);
    expect(improvements.violations).toBe(1);
    expect(improvements.violationNodes).toBe(5);
    expect(improvements.moderate).toBe(1);
    expect(improvements.incomplete).toBe(1);
  });

  it('deja el score a null si no se evaluo ninguna regla del grupo', () => {
    const onlyLegal = computeCompliance({ ...results, violations: [], passes: [], incomplete: [], inapplicable: [rule('a', ['wcag2a'])] });
    expect(onlyLegal.legal.score).toBe(100);
    expect(onlyLegal.improvements.score).toBeNull();
  });

  it('agrega sumando contadores y promediando scores, ignorando paginas sin desglose', () => {
    const page = computeCompliance(results);
    const aggregated = aggregateCompliance([page, null, computeCompliance({ ...results, violations: [] })]);

    expect(aggregated?.legal.violations).toBe(1);
    expect(aggregated?.legal.passes).toBe(4);
    expect(aggregated?.legal.score).toBe(83.4);
    expect(aggregateCompliance([null])).toBeNull();
  });
});
