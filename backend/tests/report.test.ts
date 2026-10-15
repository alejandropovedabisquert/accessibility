import { describe, expect, it } from 'vitest';
import { auditReportHtml, pageRanges, type AuditReportPage } from '../src/services/report/auditReport';
import type { Audit, AuditPage, AxeResults } from '../src/types/audit.types';

type Rule = AxeResults['violations'][number];
const rule = (id: string, tags: string[], html: string[] = []) =>
  ({
    id,
    tags,
    impact: 'serious',
    help: `ayuda ${id}`,
    helpUrl: `https://axe.test/${id}`,
    description: id,
    nodes: html.map((h, i) => ({ html: h, target: [`#n${i}`], any: [], all: [], none: [{ message: `falla ${id}` }] })),
  }) as unknown as Rule;

const results = (violations: Rule[]): AxeResults =>
  ({
    url: 'https://web.test/',
    timestamp: '2026-09-28T10:00:00.000Z',
    testEngine: { name: 'axe-core', version: '4.13.0' },
    violations,
    passes: [rule('html-has-lang', ['wcag2a', 'wcag311'])],
    incomplete: [],
    inapplicable: [],
  }) as unknown as AxeResults;

const page = (n: number, overrides: Partial<AuditPage> = {}): AuditPage =>
  ({
    id: `p${n}`,
    auditId: 'a1',
    url: `https://web.test/${n}`,
    host: 'web.test',
    status: 'completed',
    include: null,
    exclude: null,
    viewport: { width: 1366, height: 768 },
    device: null,
    finishedAt: '2026-09-28T10:00:00.000Z',
    error: null,
    ...overrides,
  }) as AuditPage;

const entry = (p: AuditPage, r: AxeResults | null): AuditReportPage => ({
  page: p,
  info: { url: p.url, include: p.include, exclude: p.exclude, viewport: p.viewport, scannedAt: '' },
  results: r,
});

const audit = {
  id: 'a1',
  label: 'Web de prueba',
  status: 'completed',
  createdAt: '2026-09-28T09:00:00.000Z',
  finishedAt: '2026-09-28T10:00:00.000Z',
  config: { browser: 'chromium', device: null, viewport: null, viewports: [], waitUntil: 'load', timeoutMs: 30000, tags: ['wcag2a'] },
} as unknown as Audit;

const imageAlt = (html: string[]) => rule('image-alt', ['wcag2a', 'wcag111'], html);

const build = () =>
  auditReportHtml(
    {
      audit,
      pages: [
        entry(page(1), results([imageAlt(['<img src="logo.png">'])])),
        entry(page(2, { exclude: '#cookies' }), results([imageAlt(['<img src="logo.png">']), rule('region', ['best-practice'], ['<div>'])])),
        entry(page(3, { status: 'failed', error: 'Timeout' }), null),
      ],
    },
    '2026-09-29T08:00:00.000Z',
  );

describe('informe PDF de una auditoria', () => {
  it('agrupa el mismo fallo de varias paginas en una sola incidencia', () => {
    const html = build();
    expect(html.match(/<h3>ayuda image-alt<\/h3>/g)).toHaveLength(1);
    expect(html).toContain('En P1, P2 · 2 elementos ·');
    // Las buenas practicas van aparte de lo exigible.
    expect(html.indexOf('ayuda region')).toBeGreaterThan(html.indexOf('Mejoras (AAA y buenas prácticas)'));
  });

  it('pone en la matriz el peor resultado de cada criterio en el sitio', () => {
    const html = build();
    const row = (criterion: string) => html.slice(html.indexOf(`<th scope="row">${criterion}`), html.indexOf('</tr>', html.indexOf(`<th scope="row">${criterion}`)));
    expect(row('1.1.1')).toContain('Fallo detectado');
    expect(row('1.1.1')).toContain('class="c x-failed">F<');
    expect(row('3.1.1')).toContain('Sin fallos detectados');
  });

  it('lista la pagina que no se pudo escanear, pero no la mete en la matriz', () => {
    const html = build();
    expect(html).toContain('No se pudo escanear</span> <span class="muted">· Timeout');
    expect(html).toContain('<th class="c">P2</th>');
    expect(html).not.toContain('<th class="c">P3</th>');
  });

  it('avisa de lo excluido y no da un estado de conformidad', () => {
    const html = build();
    expect(html).toContain('Se excluyo del analisis &quot;#cookies&quot;');
    expect(html).not.toMatch(/(Plenamente|Parcialmente) conforme/);
  });

  it('abrevia las paginas consecutivas', () => {
    expect(pageRanges([5, 1, 2, 3, 7, 8])).toBe('P1–P3, P5, P7, P8');
  });
});
