import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'fs';
import request from 'supertest';
import app from '../src/app';
import { closeDb } from '../src/db/client';
import browserPool from '../src/services/scanner/browserPool';
import auditService from '../src/services/audit/audit.service';
import rawStore from '../src/services/storage/rawStore';
import {
  BROKEN_PAGE,
  CLEAN_PAGE,
  SECTIONED_PAGE,
  startFixtureServer,
  type FixtureServer,
} from './helpers/fixtureServer';
import { waitForAudit } from './helpers/waitFor';

let fixture: FixtureServer;

beforeAll(async () => {
  fixture = await startFixtureServer({
    '/roto': BROKEN_PAGE,
    '/limpio': CLEAN_PAGE,
    '/secciones': SECTIONED_PAGE,
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
