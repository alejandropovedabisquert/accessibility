import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'fs';
import request from 'supertest';
import app from '../src/app';
import { closeDb, getDb } from '../src/db/client';
import browserPool from '../src/services/scanner/browserPool';
import auditService from '../src/services/audit/audit.service';
import rawStore from '../src/services/storage/rawStore';
import {
  BROKEN_PAGE,
  CARDS_PAGE,
  CLEAN_PAGE,
  ELEMENTOR_PAGE_A,
  ELEMENTOR_PAGE_B,
  LONG_PAGE,
  RESPONSIVE_PAGE,
  SECTIONED_PAGE,
  startFixtureServer,
  type FixtureServer,
} from './helpers/fixtureServer';
import { waitForAudit } from './helpers/waitFor';
import { SCAN_LOCALE as esLocale } from '../src/services/scanner/locale';

let fixture: FixtureServer;

beforeAll(async () => {
  fixture = await startFixtureServer({
    '/roto': BROKEN_PAGE,
    '/limpio': CLEAN_PAGE,
    '/secciones': SECTIONED_PAGE,
    // Misma pagina limpia en otra ruta, para no alterar las busquedas por '/limpio'.
    '/correcta': CLEAN_PAGE,
    '/larga': LONG_PAGE,
    '/responsive': RESPONSIVE_PAGE,
    '/elementor-a': ELEMENTOR_PAGE_A,
    '/elementor-b': ELEMENTOR_PAGE_B,
    '/tarjetas': CARDS_PAGE,
  });
});

afterAll(async () => {
  await auditService.drain();
  await browserPool.closeAll();
  await fixture.close();
  closeDb();
});

describe('ciclo completo de una auditoria', () => {
  let auditId = '';
  let brokenPageId = '';

  it('acepta la auditoria con 202 sin esperar al escaneo', async () => {
    const res = await request(app)
      .post('/api/audits')
      .send({
        urls: [fixture.url('/roto'), fixture.url('/limpio')],
        label: 'Auditoria de prueba',
        tags: ['wcag2a', 'wcag2aa'],
      })
      .expect(202);

    expect(res.body.status).toBe('queued');
    expect(res.body.totalPages).toBe(2);
    expect(res.body.label).toBe('Auditoria de prueba');
    expect(res.headers.location).toBe(`/api/audits/${res.body.id}`);
    auditId = res.body.id;
  });

  it('termina y agrega los contadores de las dos paginas', async () => {
    const audit = await waitForAudit(app, auditId);

    expect(audit.status).toBe('completed');
    expect(audit.completedPages).toBe(2);
    expect(audit.failedPages).toBe(0);
    expect(audit.pages).toHaveLength(2);

    const broken = audit.pages.find((p: { url: string }) => p.url.endsWith('/roto'));
    const clean = audit.pages.find((p: { url: string }) => p.url.endsWith('/limpio'));
    brokenPageId = broken.id;

    // La pagina rota tiene incumplimientos conocidos; la limpia no deberia tener ninguno.
    expect(broken.violations).toBeGreaterThan(0);
    expect(clean.violations).toBe(0);
    expect(clean.score).toBe(100);

    // El agregado de la auditoria es la suma de sus paginas.
    expect(audit.violations).toBe(broken.violations + clean.violations);
    expect(audit.score).toBeCloseTo((broken.score + clean.score) / 2, 0);
  });

  it('lista los incumplimientos concretos de la pagina rota', async () => {
    const res = await request(app).get(`/api/audits/${auditId}/pages/${brokenPageId}`).expect(200);

    const rules = res.body.issues.map((i: { ruleId: string }) => i.ruleId);
    expect(rules).toContain('image-alt');
    expect(rules).toContain('html-has-lang');

    // Los textos salen de la traduccion `es` de axe, no del ingles por defecto.
    const imageAlt = res.body.issues.find((i: { ruleId: string }) => i.ruleId === 'image-alt');
    expect(imageAlt.help).toBe((esLocale.rules?.['image-alt'] as { help?: string } | undefined)?.help);

    // Ordenados por impacto: lo critico primero.
    const impacts = res.body.issues.map((i: { impact: string }) => i.impact);
    const order = ['critical', 'serious', 'moderate', 'minor'];
    const positions = impacts.map((i: string) => order.indexOf(i));
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('devuelve el resultado crudo de axe guardado en disco', async () => {
    const res = await request(app)
      .get(`/api/audits/${auditId}/pages/${brokenPageId}/results`)
      .expect(200);

    expect(res.body.results.violations.length).toBeGreaterThan(0);
    expect(res.body.results.passes).toBeDefined();
    expect(rawStore.exists(rawStore.rawPath(auditId, brokenPageId))).toBe(true);
  });

  it('genera el PDF bajo demanda y lo cachea', async () => {
    const pdfPath = rawStore.pdfPath(auditId, brokenPageId);
    expect(rawStore.exists(pdfPath)).toBe(false);

    const res = await request(app)
      .get(`/api/audits/${auditId}/pages/${brokenPageId}/report.pdf`)
      .expect(200);

    expect(res.headers['content-type']).toContain('pdf');
    expect(res.headers['content-disposition']).toContain('informe-accesibilidad-');
    expect(res.body.subarray(0, 4).toString()).toBe('%PDF');
    expect(rawStore.exists(pdfPath)).toBe(true);

    const mtime = fs.statSync(pdfPath).mtimeMs;
    await request(app).get(`/api/audits/${auditId}/pages/${brokenPageId}/report.pdf`).expect(200);
    // La segunda descarga reutiliza el fichero, no lo regenera.
    expect(fs.statSync(pdfPath).mtimeMs).toBe(mtime);
  });

  it('no encuentra diferencias cuando es el primer escaneo de la URL', async () => {
    const res = await request(app)
      .get(`/api/audits/${auditId}/pages/${brokenPageId}/diff`)
      .expect(200);

    expect(res.body.previous).toBeNull();
    expect(res.body.added).toEqual([]);
  });
});

describe('historico y comparacion entre auditorias', () => {
  it('compara un segundo escaneo con el anterior de la misma URL', async () => {
    const first = await request(app)
      .post('/api/audits')
      .send({ urls: [fixture.url('/roto')] })
      .expect(202);
    await waitForAudit(app, first.body.id);

    const second = await request(app).post(`/api/audits/${first.body.id}/rerun`).expect(202);
    const rerun = await waitForAudit(app, second.body.id);
    const pageId = rerun.pages[0].id;

    const diff = await request(app)
      .get(`/api/audits/${second.body.id}/pages/${pageId}/diff`)
      .expect(200);

    // La pagina no ha cambiado entre escaneos: todo debe quedar como "sin cambios".
    expect(diff.body.previous).not.toBeNull();
    expect(diff.body.added).toEqual([]);
    expect(diff.body.resolved).toEqual([]);
    expect(diff.body.changed).toEqual([]);
    expect(diff.body.unchanged).toBeGreaterThan(0);
  });

  it('acumula la serie temporal de la URL', async () => {
    const res = await request(app)
      .get('/api/history')
      .query({ url: fixture.url('/roto') })
      .expect(200);

    expect(res.body.points.length).toBeGreaterThanOrEqual(3);
    const timestamps = res.body.points.map((p: { finishedAt: string }) => p.finishedAt);
    // De mas antiguo a mas reciente.
    expect([...timestamps].sort()).toEqual(timestamps);
  });

  it('lista las URLs auditadas con su numero de ejecuciones', async () => {
    const res = await request(app).get('/api/history/urls').expect(200);
    const broken = res.body.find((u: { url: string }) => u.url.endsWith('/roto'));
    expect(broken.runs).toBeGreaterThanOrEqual(3);
  });
});

describe('escaneo acotado a una seccion', () => {
  let auditId = '';
  let headerPageId = '';
  let mainPageId = '';

  it('analiza cabecera y contenido principal de la misma URL por separado', async () => {
    const created = await request(app)
      .post('/api/audits')
      .send({
        urls: [
          { url: fixture.url('/secciones'), include: 'header' },
          { url: fixture.url('/secciones'), include: 'main' },
        ],
        label: 'Por secciones',
      })
      .expect(202);

    auditId = created.body.id;
    expect(created.body.totalPages).toBe(2);

    const audit = await waitForAudit(app, auditId);
    expect(audit.status).toBe('completed');
    expect(audit.completedPages).toBe(2);

    const header = audit.pages.find((p: { include: string }) => p.include === 'header');
    const main = audit.pages.find((p: { include: string }) => p.include === 'main');
    headerPageId = header.id;
    mainPageId = main.id;

    // Los fallos de la fixture (img sin alt, contraste) estan solo en la cabecera.
    expect(header.violations).toBeGreaterThan(0);
    expect(main.violations).toBe(0);
  });

  it('deja fuera de la seccion los incumplimientos del resto de la pagina', async () => {
    const res = await request(app).get(`/api/audits/${auditId}/pages/${headerPageId}`).expect(200);
    const rules = res.body.issues.map((i: { ruleId: string }) => i.ruleId);

    expect(rules).toContain('image-alt');
    // El input sin etiqueta esta en el footer, fuera del ambito analizado.
    expect(rules).not.toContain('label');
  });

  it('guarda la seccion en la pagina y la conserva al relanzar', async () => {
    const rerun = await request(app).post(`/api/audits/${auditId}/rerun`).expect(202);
    const audit = await waitForAudit(app, rerun.body.id);

    const scopes = audit.pages.map((p: { include: string | null }) => p.include).sort();
    expect(scopes).toEqual(['header', 'main']);
  });

  it('separa el historico y el diff por seccion', async () => {
    // El primer escaneo de "main" no tiene con que compararse pese a haber
    // escaneos previos de "header" sobre la misma URL.
    const soloHeader = await request(app)
      .get('/api/history')
      .query({ url: fixture.url('/secciones'), include: 'header' })
      .expect(200);
    const paginaEntera = await request(app)
      .get('/api/history')
      .query({ url: fixture.url('/secciones') })
      .expect(200);

    expect(soloHeader.body.include).toBe('header');
    expect(soloHeader.body.points.length).toBeGreaterThanOrEqual(2);
    // Nadie ha escaneado esta URL entera: su serie esta vacia.
    expect(paginaEntera.body.points).toEqual([]);

    const diff = await request(app)
      .get(`/api/audits/${auditId}/pages/${mainPageId}/diff`)
      .expect(200);
    expect(diff.body.previous).toBeNull();
  });

  it('lista cada seccion como una serie propia del historico', async () => {
    const res = await request(app).get('/api/history/urls').expect(200);
    const series = res.body.filter((u: { url: string }) => u.url.endsWith('/secciones'));

    expect(series.map((s: { include: string }) => s.include).sort()).toEqual(['header', 'main']);
  });

  it('marca la pagina como fallida si el selector no casa con nada', async () => {
    const created = await request(app)
      .post('/api/audits')
      .send({ urls: [{ url: fixture.url('/secciones'), include: '.no-existe' }] })
      .expect(202);

    const audit = await waitForAudit(app, created.body.id);
    expect(audit.pages[0].status).toBe('failed');
    expect(audit.pages[0].error).toContain('no encontro ningun elemento');
  });

  it('marca la pagina como fallida si el selector no es CSS valido', async () => {
    const created = await request(app)
      .post('/api/audits')
      .send({ urls: [{ url: fixture.url('/secciones'), include: '>>>' }] })
      .expect(202);

    const audit = await waitForAudit(app, created.body.id);
    expect(audit.pages[0].status).toBe('failed');
    expect(audit.pages[0].error).toContain('no es un selector CSS valido');
  });

  it('excluye del analisis lo que casa con el selector de exclusion', async () => {
    const created = await request(app)
      .post('/api/audits')
      .send({ urls: [{ url: fixture.url('/secciones'), include: 'header', exclude: 'img' }] })
      .expect(202);

    const audit = await waitForAudit(app, created.body.id);
    const res = await request(app)
      .get(`/api/audits/${created.body.id}/pages/${audit.pages[0].id}`)
      .expect(200);

    const rules = res.body.issues.map((i: { ruleId: string }) => i.ruleId);
    expect(rules).not.toContain('image-alt');
  });
});

describe('cumplimiento legal separado de mejoras', () => {
  let auditId = '';
  let pageId = '';

  it('separa las reglas A/AA de las AAA y buenas practicas', async () => {
    const created = await request(app)
      .post('/api/audits')
      .send({ urls: [fixture.url('/roto')], tags: ['wcag2a', 'wcag2aa', 'wcag2aaa', 'best-practice'] })
      .expect(202);
    auditId = created.body.id;

    const audit = await waitForAudit(app, auditId);
    const page = audit.pages[0];
    pageId = page.id;

    const { legal, improvements } = page.compliance;
    // image-alt, html-has-lang, label (A) y color-contrast (AA) son legales;
    // color-contrast-enhanced (AAA) y region (buena practica) son mejoras.
    expect(legal.violations).toBeGreaterThanOrEqual(4);
    expect(improvements.violations).toBeGreaterThanOrEqual(2);
    expect(legal.violations + improvements.violations).toBe(page.violations);
    expect(legal.score).toBeLessThan(100);
    expect(improvements.score).not.toBeNull();

    // El score global de siempre no cambia de significado.
    expect(page.score).toBeTypeOf('number');
    expect(audit.compliance.legal.violations).toBe(legal.violations);
  });

  it('etiqueta cada incumplimiento con su nivel', async () => {
    const res = await request(app).get(`/api/audits/${auditId}/pages/${pageId}`).expect(200);
    const levelOf = (id: string) =>
      res.body.issues.find((i: { ruleId: string }) => i.ruleId === id)?.level;

    expect(levelOf('image-alt')).toBe('A');
    expect(levelOf('color-contrast')).toBe('AA');
    expect(levelOf('color-contrast-enhanced')).toBe('AAA');
    expect(levelOf('region')).toBe('best-practice');
  });

  it('con las normas por defecto no evalua mejoras', async () => {
    const created = await request(app).post('/api/audits').send({ urls: [fixture.url('/correcta')] }).expect(202);
    const audit = await waitForAudit(app, created.body.id);

    expect(audit.pages[0].compliance.legal.score).toBe(100);
    expect(audit.pages[0].compliance.improvements.score).toBeNull();
  });

  it('recalcula el desglose de las paginas antiguas desde el JSON crudo', async () => {
    const before = (await request(app).get(`/api/audits/${auditId}`).expect(200)).body;
    getDb().prepare('UPDATE audit_pages SET compliance = NULL WHERE audit_id = ?').run(auditId);
    getDb().prepare('UPDATE audits SET compliance = NULL WHERE id = ?').run(auditId);
    getDb().prepare('UPDATE page_issues SET level = NULL WHERE page_id = ?').run(pageId);

    const nulled = (await request(app).get(`/api/audits/${auditId}`).expect(200)).body;
    expect(nulled.compliance).toBeNull();

    const { pages } = await auditService.backfillCompliance();
    expect(pages).toBeGreaterThanOrEqual(1);

    const after = (await request(app).get(`/api/audits/${auditId}`).expect(200)).body;
    expect(after.pages[0].compliance).toEqual(before.pages[0].compliance);
    expect(after.compliance).toEqual(before.compliance);

    // Sin columna `level`, el nivel se deduce del id de la regla.
    const detail = await request(app).get(`/api/audits/${auditId}/pages/${pageId}`).expect(200);
    const imageAlt = detail.body.issues.find((i: { ruleId: string }) => i.ruleId === 'image-alt');
    expect(imageAlt.level).toBe('A');
  });

  it('incluye el bloque legal antes que el de mejoras en el PDF', async () => {
    const res = await request(app).get(`/api/audits/${auditId}/pages/${pageId}/report.pdf`).expect(200);
    expect(res.body.subarray(0, 4).toString()).toBe('%PDF');
  });
});

describe('exportacion compacta para IA', () => {
  let auditId = '';
  let pageId = '';

  beforeAll(async () => {
    const created = await request(app)
      .post('/api/audits')
      .send({ urls: [fixture.url('/roto')], tags: ['wcag2a', 'wcag2aa', 'best-practice'] })
      .expect(202);
    const audit = await waitForAudit(app, created.body.id);
    auditId = audit.id;
    pageId = audit.pages[0].id;
  });

  const sizes = async (id: string, page: string) => {
    const raw = await request(app).get(`/api/audits/${id}/pages/${page}/results`).expect(200);
    const compact = await request(app)
      .get(`/api/audits/${id}/pages/${page}/results`)
      .query({ format: 'compact' })
      .expect(200);
    return { raw: Buffer.byteLength(raw.text), compact: Buffer.byteLength(compact.text), text: compact.text };
  };

  it('es mucho mas pequena que el JSON crudo de axe', async () => {
    const created = await request(app).post('/api/audits').send({ urls: [fixture.url('/larga')] }).expect(202);
    const audit = await waitForAudit(app, created.body.id);
    const long = await sizes(audit.id, audit.pages[0].id);
    const short = await sizes(auditId, pageId);

    for (const [name, size] of [['/larga', long], ['/roto', short]] as const) {
      console.log(`[tamano] ${name}: crudo ${size.raw} B, compacto ${size.compact} B (${((size.compact / size.raw) * 100).toFixed(1)} %)`);
    }

    // En una pagina con volumen real, `passes` se lo come todo.
    expect(long.compact).toBeLessThan(long.raw / 20);
    // Incluso en una pagina minima con casi todo fallando, sigue siendo una fraccion.
    expect(short.compact).toBeLessThan(short.raw / 5);
    // Sin espacios: ni saltos de linea ni indentacion.
    expect(short.text).not.toMatch(/\n|": /);
  });

  it('sigue el esquema acordado', async () => {
    const { body } = await request(app)
      .get(`/api/audits/${auditId}/pages/${pageId}/results`)
      .query({ format: 'compact' })
      .expect(200);

    expect(body.schemaVersion).toBe('1.0');
    expect(body.tool.axe).toMatch(/^\d+\.\d+/);
    expect(body.tool.tags).toEqual(['wcag2a', 'wcag2aa', 'best-practice']);
    expect(body.page).toMatchObject({ url: fixture.url('/roto'), include: null, exclude: null });
    expect(body.page.viewport).toEqual({ width: 1366, height: 768 });
    expect(body.summary.passes).toBeGreaterThan(0);
    expect(body.passes).toBeUndefined();

    const label = body.findings.find((f: { rule: string }) => f.rule === 'label');
    expect(label).toMatchObject({ status: 'fail', level: 'A', wcag: ['4.1.2'], count: 1 });
    expect(label.en301549).toContain('9.4.1.2');
    expect(label.nodes[0].selector).toBe('input');
    expect(label.nodes[0].message).not.toBe('');

    // Los fallos de nivel A/AA van antes que las buenas practicas.
    const levels = body.findings.map((f: { level: string }) => f.level);
    expect(levels.indexOf('best-practice')).toBeGreaterThan(levels.lastIndexOf('AA'));
  });

  it('respeta maxNodes, lo valida y permite descargar', async () => {
    await request(app)
      .get(`/api/audits/${auditId}/pages/${pageId}/results`)
      .query({ format: 'compact', maxNodes: 0 })
      .expect(400);
    await request(app)
      .get(`/api/audits/${auditId}/pages/${pageId}/results`)
      .query({ format: 'xml' })
      .expect(400);

    const res = await request(app)
      .get(`/api/audits/${auditId}/pages/${pageId}/results`)
      .query({ format: 'compact', maxNodes: 1, download: 1 })
      .expect(200);
    expect(res.headers['content-disposition']).toContain('accesibilidad-ia-');
    const body = JSON.parse(res.text);
    expect(body.findings.every((f: { nodes: unknown[] }) => f.nodes.length <= 1)).toBe(true);
  });
});

describe('varios viewports por URL', () => {
  const DESKTOP = { width: 1366, height: 768 };
  const MOBILE = { width: 390, height: 844 };
  let first: { id: string; pages: Array<{ id: string; viewport: typeof DESKTOP; violations: number }> };

  const pageAt = (audit: typeof first, viewport: typeof DESKTOP) =>
    audit.pages.find((p) => p.viewport.width === viewport.width)!;

  it('escanea cada URL en todas las resoluciones', async () => {
    const created = await request(app)
      .post('/api/audits')
      .send({ urls: [fixture.url('/responsive')], viewports: [DESKTOP, MOBILE] })
      .expect(202);
    expect(created.body.totalPages).toBe(2);
    expect(created.body.config.viewports).toEqual([DESKTOP, MOBILE]);
    expect(created.body.config.viewport).toEqual(DESKTOP);

    first = await waitForAudit(app, created.body.id);
    expect(first.pages.map((p) => p.viewport)).toEqual([DESKTOP, MOBILE]);

    // La imagen sin alt solo se ve en movil.
    expect(pageAt(first, DESKTOP).violations).toBe(0);
    expect(pageAt(first, MOBILE).violations).toBeGreaterThan(0);
  });

  it('compara cada viewport solo con el mismo viewport', async () => {
    const rerun = await request(app).post(`/api/audits/${first.id}/rerun`).expect(202);
    const second = await waitForAudit(app, rerun.body.id);
    expect(second.pages).toHaveLength(2);

    for (const viewport of [DESKTOP, MOBILE]) {
      const diff = await request(app)
        .get(`/api/audits/${second.id}/pages/${pageAt(second, viewport).id}/diff`)
        .expect(200);
      expect(diff.body.previous.pageId).toBe(pageAt(first, viewport).id);
      // Si se hubiera comparado movil con escritorio, image-alt saldria como nuevo o resuelto.
      expect(diff.body.added).toEqual([]);
      expect(diff.body.resolved).toEqual([]);
    }
  });

  it('separa el historico por viewport y mantiene la consulta sin viewport', async () => {
    const mobile = await request(app)
      .get('/api/history')
      .query({ url: fixture.url('/responsive'), viewport: '390x844' })
      .expect(200);
    const all = await request(app).get('/api/history').query({ url: fixture.url('/responsive') }).expect(200);

    expect(mobile.body.viewport).toEqual(MOBILE);
    expect(mobile.body.points).toHaveLength(2);
    expect(mobile.body.points.every((p: { viewport: typeof MOBILE }) => p.viewport.width === 390)).toBe(true);
    expect(all.body.points).toHaveLength(4);

    await request(app).get('/api/history').query({ url: fixture.url('/responsive'), viewport: 'grande' }).expect(400);
  });

  it('lista cada viewport como una serie propia', async () => {
    const res = await request(app).get('/api/history/urls').expect(200);
    const series = res.body.filter((u: { url: string }) => u.url.endsWith('/responsive'));
    expect(series.map((s: { viewport: typeof DESKTOP }) => s.viewport.width).sort()).toEqual([1366, 390]);
    expect(series.every((s: { runs: number; device: null }) => s.runs === 2 && s.device === null)).toBe(true);
  });

  it('incluye el viewport de la pagina en la exportacion compacta', async () => {
    const { body } = await request(app)
      .get(`/api/audits/${first.id}/pages/${pageAt(first, MOBILE).id}/results`)
      .query({ format: 'compact' })
      .expect(200);
    expect(body.page.viewport).toEqual(MOBILE);
    expect(body.findings.map((f: { rule: string }) => f.rule)).toContain('image-alt');
  });

  it('guarda el viewport de la resolucion unica y el del dispositivo', async () => {
    const created = await request(app)
      .post('/api/audits')
      .send({ urls: [fixture.url('/correcta')], device: 'iPhone 15' })
      .expect(202);
    const audit = await waitForAudit(app, created.body.id);
    expect(audit.config.viewports).toEqual([]);
    expect(audit.pages[0].device).toBe('iPhone 15');
    expect(audit.pages[0].viewport).not.toBeNull();

    const single = await request(app)
      .post('/api/audits')
      .send({ urls: [fixture.url('/correcta')], viewport: { width: 800, height: 600 } })
      .expect(202);
    expect(single.body.config.viewports).toEqual([{ width: 800, height: 600 }]);
  });
});

describe('exportacion agregada de la auditoria', () => {
  const DESKTOP = { width: 1366, height: 768 };
  const MOBILE = { width: 390, height: 844 };
  let auditId = '';

  type PageRef = [number, number];
  interface Finding {
    rule: string;
    status: string;
    level: string;
    count: number;
    fingerprint: string;
    nodes: Array<{ selector: string; html: string }>;
    pages: PageRef[];
    viewports?: unknown;
  }
  interface Improvement {
    rule: string;
    status: string;
    level: string;
    impact: string | null;
    help: string;
    helpUrl: string;
    groups: number;
    count: number;
    pages: number[];
    nodes: unknown[];
  }
  interface Group {
    violations: number;
    ruleOccurrences: number;
  }
  interface Exported {
    schemaVersion: string;
    detail: string;
    audit: { id: string; label: string };
    pages: Array<{ url: string; viewport: typeof DESKTOP }>;
    failedPages: Array<{ url: string; error: string }>;
    summary: { nodes: number; groups: number; legal: Group; improvements: Group };
    findings: Finding[];
    improvements?: Improvement[];
  }

  beforeAll(async () => {
    const created = await request(app)
      .post('/api/audits')
      .send({
        urls: [fixture.url('/elementor-a'), fixture.url('/elementor-b'), 'http://127.0.0.1:1/caida'],
        viewports: [DESKTOP, MOBILE],
        timeout: 5000,
        label: 'Sitio Elementor',
      })
      .expect(202);
    auditId = created.body.id;
    await waitForAudit(app, auditId);
  });

  const exportAudit = async (query: Record<string, string> = {}, id = auditId) =>
    (await request(app).get(`/api/audits/${id}/export`).query({ format: 'compact', ...query }).expect(200)).body as Exported;

  /** Lo que antes iba en findings[].pages y findings[].viewports, reconstruido desde los indices. */
  const pagesOf = (body: Exported, finding: Pick<Finding, 'pages'>) => finding.pages.map(([index]) => body.pages[index]!);

  it('agrupa el mismo componente de pie aunque sus ids generados cambien', async () => {
    const body = await exportAudit();
    const byRule = (rule: string) => body.findings.filter((f) => f.rule === rule && f.status === 'fail');

    // Un solo grupo por fallo del pie, con las dos URLs en las dos resoluciones.
    for (const rule of ['label', 'link-name']) {
      const groups = byRule(rule);
      expect(groups).toHaveLength(1);
      const [group] = groups;
      expect(group!.pages).toHaveLength(4);
      expect(group!.count).toBe(4);
      const pages = pagesOf(body, group!);
      expect(new Set(pages.map((p) => p.url))).toEqual(new Set([fixture.url('/elementor-a'), fixture.url('/elementor-b')]));
      expect(new Set(pages.map((p) => `${p.viewport.width}x${p.viewport.height}`))).toEqual(new Set(['1366x768', '390x844']));
    }

    // El fallo propio de una sola pagina queda aparte, solo con esa URL.
    const imageAlt = byRule('image-alt');
    expect(imageAlt).toHaveLength(1);
    expect(new Set(pagesOf(body, imageAlt[0]!).map((p) => p.url))).toEqual(new Set([fixture.url('/elementor-a')]));
  });

  it('referencia las paginas por indice en la version 1.1', async () => {
    const body = await exportAudit();
    expect(body.schemaVersion).toBe('1.1');
    expect(body.detail).toBe('full');
    expect(body.improvements).toBeUndefined();

    for (const finding of body.findings) {
      expect(finding.viewports).toBeUndefined();
      const indices = finding.pages.map(([index]) => index);
      // Indices validos, sin repetir, y los nodos de cada pagina suman el total.
      expect(indices.every((index) => Number.isInteger(index) && index >= 0 && index < body.pages.length)).toBe(true);
      expect(new Set(indices).size).toBe(indices.length);
      expect(finding.pages.reduce((sum, [, count]) => sum + count, 0)).toBe(finding.count);
    }
  });

  it('da ejemplos distintos, resume y deja constancia de lo que no se pudo escanear', async () => {
    const body = await exportAudit();
    const label = body.findings.find((f) => f.rule === 'label')!;

    // Los ids cambian entre paginas, asi que hay dos selectores de ejemplo.
    expect(label.nodes.map((n) => n.selector).sort()).toEqual(['#e-form-input-31a11f8', '#e-form-input-77aa0b1']);
    expect(label.fingerprint).toMatch(/^[0-9a-f]{12}$/);

    expect(body.audit).toMatchObject({ id: auditId, label: 'Sitio Elementor' });
    expect(body.pages).toHaveLength(4);
    expect(body.failedPages).toHaveLength(2);
    expect(body.failedPages[0]!.error).toBeTruthy();
    expect(body.summary.groups).toBe(body.findings.length);
    expect(body.summary.nodes).toBeGreaterThan(body.summary.groups);
  });

  it('llama ruleOccurrences a las reglas incumplidas sumadas por pagina y mantiene violations', async () => {
    const { summary } = await exportAudit();
    // label, link-name (x4 paginas) e image-alt (x2 resoluciones de una pagina).
    expect(summary.legal.ruleOccurrences).toBeGreaterThanOrEqual(10);
    expect(summary.legal.violations).toBe(summary.legal.ruleOccurrences);
    expect(summary.improvements.violations).toBe(summary.improvements.ruleOccurrences);
  });

  it('ordena por estado, nivel e impacto y, a igualdad, lo que afecta a mas paginas', async () => {
    const { findings } = await exportAudit();
    const statuses = findings.map((f) => f.status);
    expect(statuses.indexOf('needs-review') === -1 || statuses.lastIndexOf('fail') < statuses.indexOf('needs-review')).toBe(true);

    const critical = findings.filter((f) => f.status === 'fail' && f.rule !== 'color-contrast');
    const imageAlt = critical.findIndex((f) => f.rule === 'image-alt');
    const label = critical.findIndex((f) => f.rule === 'label');
    // Mismo nivel (A) e impacto (critical): el del pie, en 4 paginas, va antes que el de 1.
    expect(label).toBeLessThan(imageAlt);
  });

  it('exige format=compact y valida el resto de parametros', async () => {
    await request(app).get(`/api/audits/${auditId}/export`).expect(400);
    await request(app).get(`/api/audits/${auditId}/export`).query({ format: 'pdf' }).expect(400);
    await request(app).get(`/api/audits/${auditId}/export`).query({ format: 'compact', maxNodes: 99 }).expect(400);
    await request(app).get(`/api/audits/${auditId}/export`).query({ format: 'compact', detail: 'todo' }).expect(400);
    await request(app).get('/api/audits/00000000-0000-0000-0000-000000000000/export').query({ format: 'compact' }).expect(404);

    const res = await request(app)
      .get(`/api/audits/${auditId}/export`)
      .query({ format: 'compact', maxNodes: 1, download: 1 })
      .expect(200);
    expect(res.headers['content-disposition']).toContain('accesibilidad-ia-auditoria-');
    expect(res.text).not.toMatch(/\n/);
    expect(JSON.parse(res.text).findings.every((f: Finding) => f.nodes.length === 1)).toBe(true);

    const legal = await request(app)
      .get(`/api/audits/${auditId}/export`)
      .query({ format: 'compact', detail: 'legal', download: 1 })
      .expect(200);
    expect(legal.headers['content-disposition']).toContain('-legal.json');
  });

  describe('tarjetas de una plantilla y detail=legal', () => {
    let cardsAuditId = '';

    beforeAll(async () => {
      const created = await request(app)
        .post('/api/audits')
        .send({ urls: [fixture.url('/tarjetas'), fixture.url('/elementor-a')], tags: ['wcag2a', 'wcag2aa', 'best-practice'] })
        .expect(202);
      cardsAuditId = created.body.id;
      await waitForAudit(app, cardsAuditId);
    });

    it('junta en un grupo las tarjetas con distinto enlace y texto', async () => {
      const body = await exportAudit({}, cardsAuditId);
      const cardsIndex = body.pages.findIndex((p) => p.url.endsWith('/tarjetas'));

      for (const rule of ['image-alt', 'empty-heading']) {
        const groups = body.findings.filter(
          (f) => f.rule === rule && f.status === 'fail' && f.pages.some(([index]) => index === cardsIndex)
        );
        expect(groups, rule).toHaveLength(1);
        expect(groups[0]!.count).toBe(3);
        expect(groups[0]!.pages).toEqual([[cardsIndex, 3]]);
        // Los ejemplos siguen trayendo el HTML real de cada tarjeta.
        expect(new Set(groups[0]!.nodes.map((n) => n.html)).size).toBeGreaterThan(rule === 'image-alt' ? 1 : 0);
      }
    });

    it('con detail=legal deja el detalle solo para A y AA y resume las mejoras por regla', async () => {
      const full = await exportAudit({}, cardsAuditId);
      const legal = await exportAudit({ detail: 'legal' }, cardsAuditId);

      expect(legal.detail).toBe('legal');
      expect(legal.findings.length).toBeGreaterThan(0);
      expect(legal.findings.every((f) => f.level === 'A' || f.level === 'AA')).toBe(true);
      expect(legal.findings).toEqual(full.findings.filter((f) => f.level === 'A' || f.level === 'AA'));
      // El resumen describe toda la auditoria, pidas el detalle que pidas.
      expect(legal.summary).toEqual(full.summary);

      const improvementGroups = full.findings.filter((f) => f.level === 'AAA' || f.level === 'best-practice');
      expect(improvementGroups.length).toBeGreaterThan(0);
      const improvements = legal.improvements!;

      // Una entrada por regla + estado, que agrupa todos sus grupos.
      const keys = improvements.map((i) => `${i.status}:${i.rule}`);
      expect(new Set(keys).size).toBe(keys.length);
      expect(improvements.reduce((sum, i) => sum + i.groups, 0)).toBe(improvementGroups.length);
      expect(improvements.reduce((sum, i) => sum + i.count, 0)).toBe(improvementGroups.reduce((sum, f) => sum + f.count, 0));

      const emptyHeading = improvements.find((i) => i.rule === 'empty-heading')!;
      expect(Object.keys(emptyHeading).sort()).toEqual(
        ['count', 'groups', 'help', 'helpUrl', 'impact', 'level', 'nodes', 'pages', 'rule', 'status'].sort()
      );
      expect(emptyHeading).toMatchObject({ status: 'fail', level: 'best-practice', count: 3, groups: 1 });
      expect(emptyHeading.pages).toEqual([legal.pages.findIndex((p) => p.url.endsWith('/tarjetas'))]);

      for (const entry of improvements) {
        expect(entry.nodes.length).toBeLessThanOrEqual(3);
        expect([...entry.pages].sort((a, b) => a - b)).toEqual(entry.pages);
        expect(new Set(entry.pages).size).toBe(entry.pages.length);
      }

      const size = (body: unknown) => Buffer.byteLength(JSON.stringify(body));
      expect(size(legal)).toBeLessThan(size(full));
    });
  });
});

describe('constancia de lo excluido', () => {
  it('lo recoge en la exportacion por pagina y en la agregada', async () => {
    const created = await request(app)
      .post('/api/audits')
      .send({
        urls: [
          { url: fixture.url('/secciones'), exclude: 'footer' },
          { url: fixture.url('/roto'), exclude: 'img' },
          { url: fixture.url('/correcta'), exclude: 'footer' },
        ],
      })
      .expect(202);
    const audit = await waitForAudit(app, created.body.id);
    const sectioned = audit.pages.find((p: { url: string }) => p.url.endsWith('/secciones'));

    const page = await request(app)
      .get(`/api/audits/${audit.id}/pages/${sectioned.id}/results`)
      .query({ format: 'compact' })
      .expect(200);
    expect(page.body.page.exclude).toBe('footer');
    expect(page.body.warnings.join(' ')).toContain('"footer"');
    // El input sin etiqueta del footer no se ha auditado, asi que no esta.
    expect(page.body.findings.map((f: { rule: string }) => f.rule)).not.toContain('label');

    const all = await request(app).get(`/api/audits/${audit.id}/export`).query({ format: 'compact' }).expect(200);
    expect(all.body.excluded).toEqual([
      { selector: 'footer', pages: 2 },
      { selector: 'img', pages: 1 },
    ]);
    expect(all.body.warnings).toHaveLength(2);
  });
});

describe('paginacion, filtros y borrado', () => {
  it('pagina el listado', async () => {
    const res = await request(app).get('/api/audits').query({ page: 1, pageSize: 2 }).expect(200);

    expect(res.body.items.length).toBeLessThanOrEqual(2);
    expect(res.body.total).toBeGreaterThanOrEqual(3);
    expect(res.body.totalPages).toBeGreaterThanOrEqual(2);
  });

  it('filtra por estado y busca por URL', async () => {
    const byStatus = await request(app).get('/api/audits').query({ status: 'completed' }).expect(200);
    expect(byStatus.body.items.every((a: { status: string }) => a.status === 'completed')).toBe(true);

    const bySearch = await request(app).get('/api/audits').query({ search: '/limpio' }).expect(200);
    expect(bySearch.body.total).toBe(1);

    const noMatch = await request(app).get('/api/audits').query({ search: 'zzz-inexistente' }).expect(200);
    expect(noMatch.body.total).toBe(0);
  });

  it('borra la auditoria y sus ficheros', async () => {
    const created = await request(app)
      .post('/api/audits')
      .send({ urls: [fixture.url('/limpio')] })
      .expect(202);
    const audit = await waitForAudit(app, created.body.id);
    const pageId = audit.pages[0].id;

    expect(rawStore.exists(rawStore.rawPath(audit.id, pageId))).toBe(true);

    await request(app).delete(`/api/audits/${audit.id}`).expect(204);
    await request(app).get(`/api/audits/${audit.id}`).expect(404);
    expect(rawStore.exists(rawStore.rawPath(audit.id, pageId))).toBe(false);
  });
});

describe('resiliencia', () => {
  it('marca la pagina como fallida sin tumbar la auditoria', async () => {
    const created = await request(app)
      .post('/api/audits')
      .send({
        urls: ['http://127.0.0.1:1/no-escucha', fixture.url('/limpio')],
        timeout: 5000,
      })
      .expect(202);

    const audit = await waitForAudit(app, created.body.id);

    expect(audit.status).toBe('completed');
    expect(audit.failedPages).toBe(1);
    expect(audit.completedPages).toBe(1);

    const failed = audit.pages.find((p: { status: string }) => p.status === 'failed');
    expect(failed.error).toBeTruthy();
  });
});
