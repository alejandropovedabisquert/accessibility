import { describe, expect, it } from 'vitest';
import { reportHtmlBuilder } from '../src/services/report/reportHtmlBuilder';
import { computeCompliance } from '../src/services/audit/summary';
import type { AxeResults } from '../src/types/audit.types';

type Rule = AxeResults['violations'][number];
const rule = (id: string, tags: string[]) =>
  ({ id, tags, impact: 'serious', help: id, helpUrl: '', description: id, nodes: [] }) as unknown as Rule;

const results = {
  url: 'https://web.test/',
  timestamp: '2026-09-28T10:00:00.000Z',
  violations: [rule('image-alt', ['wcag2a']), rule('region', ['best-practice'])],
  passes: [rule('html-has-lang', ['wcag2a'])],
  incomplete: [],
  inapplicable: [],
};

const build = (overrides: { include?: string | null; exclude?: string | null } = {}) =>
  reportHtmlBuilder(results, {
    config: { browser: 'chromium', device: null, viewport: null, viewports: [], waitUntil: 'load', timeoutMs: 30000, tags: ['wcag2a'] },
    score: 50,
    compliance: computeCompliance(results),
    viewport: { width: 390, height: 844 },
    device: null,
    ...overrides,
  });

describe('HTML del informe PDF', () => {
  it('pone el bloque de cumplimiento legal antes que el de mejoras', () => {
    const html = build();
    const legal = html.indexOf('Cumplimiento legal (WCAG A y AA)');
    const improvements = html.indexOf('Mejoras (WCAG AAA y buenas practicas)');
    expect(legal).toBeGreaterThan(-1);
    expect(improvements).toBeGreaterThan(legal);
    expect(html).toContain('Nivel:</strong> Buena practica');
  });

  it('indica la pantalla de la pagina', () => {
    expect(build()).toContain('<strong>Pantalla:</strong> 390x844');
  });

  it('deja constancia de lo excluido y de que hay que revisarlo aparte', () => {
    const html = build({ exclude: '#cookies' });
    expect(html).toContain('<strong>Excluido:</strong> <code>#cookies</code>');
    expect(html).toContain('no se ha auditado');
    expect(html).toContain('revisarlo por separado');
    expect(build()).not.toContain('Contenido excluido');
  });
});
