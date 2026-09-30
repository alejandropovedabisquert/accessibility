import { describe, expect, it } from 'vitest';
import {
  MAX_HTML_LENGTH,
  buildPageExport,
  nodeMessage,
  nodeSelector,
  toCompactNode,
} from '../src/services/export/compact';
import type { AxeResults } from '../src/types/audit.types';

type Rule = AxeResults['violations'][number];
type Node = Rule['nodes'][number];

const node = (overrides: Partial<Node> = {}): Node =>
  ({ html: '<input>', target: ['input'], any: [], all: [], none: [], ...overrides }) as Node;

const rule = (id: string, tags: string[], impact: Rule['impact'], nodes: Node[] = [node()]): Rule =>
  ({ id, tags, impact, help: `ayuda ${id}`, helpUrl: `https://x/${id}`, description: '', nodes }) as Rule;

describe('nodos de la exportacion compacta', () => {
  it('usa el ultimo elemento de target y une el shadow DOM con >>>', () => {
    expect(nodeSelector(node({ target: ['iframe#pago', '#tarjeta'] }))).toBe('#tarjeta');
    expect(nodeSelector(node({ target: [['my-widget', 'button.cerrar']] as Node['target'] }))).toBe(
      'my-widget >>> button.cerrar'
    );
  });

  it('recorta el HTML y junta los mensajes de los checks sin repetir', () => {
    const compact = toCompactNode(
      node({
        html: `<div class="${'x'.repeat(300)}">`,
        any: [{ message: 'Sin etiqueta' }, { message: 'Sin aria-label' }] as Node['any'],
        none: [{ message: 'Sin etiqueta' }] as Node['none'],
      })
    );
    expect(compact.html).toHaveLength(MAX_HTML_LENGTH);
    expect(compact.html.endsWith('…')).toBe(true);
    expect(compact.message).toBe('Sin etiqueta; Sin aria-label');
    expect(nodeMessage(node())).toBe('');
  });
});

describe('buildPageExport', () => {
  const results = {
    testEngine: { name: 'axe-core', version: '4.13.0' },
    timestamp: '2026-09-28T10:00:00.000Z',
    url: 'https://web.test/',
    violations: [
      rule('region', ['best-practice'], 'moderate'),
      rule('color-contrast', ['wcag2aa', 'wcag143', 'EN-301-549', 'EN-9.1.4.3'], 'serious'),
      rule('label', ['wcag2a', 'wcag412', 'EN-9.4.1.2'], 'critical', Array.from({ length: 19 }, () => node())),
      rule('image-alt', ['wcag2a', 'wcag111'], 'minor'),
    ],
    incomplete: [rule('aria-valid-attr-value', ['wcag2a', 'wcag412'], 'critical')],
    passes: [rule('html-has-lang', ['wcag2a'], null)],
    inapplicable: [rule('video-caption', ['wcag2a'], null), rule('x', ['best-practice'], null)],
  } as unknown as AxeResults;

  const compact = buildPageExport({
    results,
    tags: ['wcag2a', 'wcag2aa', 'best-practice'],
    maxNodes: 3,
    page: { url: results.url, include: null, exclude: null, viewport: { width: 390, height: 844 }, scannedAt: results.timestamp },
  });

  it('ordena por estado, nivel e impacto', () => {
    expect(compact.findings.map((f) => `${f.status}:${f.rule}`)).toEqual([
      'fail:label',
      'fail:image-alt',
      'fail:color-contrast',
      'fail:region',
      'needs-review:aria-valid-attr-value',
    ]);
  });

  it('limita los nodos pero conserva el recuento real', () => {
    const label = compact.findings[0]!;
    expect(label.count).toBe(19);
    expect(label.nodes).toHaveLength(3);
    expect(label.wcag).toEqual(['4.1.2']);
    expect(label.en301549).toEqual(['9.4.1.2']);
    expect(label.level).toBe('A');
  });

  it('sin seccion ni exclusion no lleva advertencias', () => {
    expect(compact.warnings).toEqual([]);
  });

  it('avisa de lo excluido y de las reglas omitidas por la seccion', () => {
    const scoped = buildPageExport({
      results,
      tags: ['wcag2a'],
      page: { url: results.url, include: 'main', exclude: '#cookies', viewport: null, scannedAt: results.timestamp },
    });
    expect(scoped.page.exclude).toBe('#cookies');
    expect(scoped.warnings).toHaveLength(2);
    expect(scoped.warnings[0]).toContain('"#cookies"');
    expect(scoped.warnings[0]).toContain('revisarlo por separado');
    expect(scoped.warnings[1]).toContain('html-has-lang');
  });

  it('solo trae recuentos de passes e inapplicable', () => {
    expect(compact.summary.passes).toBe(1);
    expect(compact.summary.inapplicable).toBe(2);
    expect(compact.summary.legal.violations).toBe(3);
    expect(compact.summary.improvements.violations).toBe(1);
    expect(JSON.stringify(compact)).not.toContain('html-has-lang');
    expect(compact.tool).toEqual({ axe: '4.13.0', tags: ['wcag2a', 'wcag2aa', 'best-practice'] });
  });
});
