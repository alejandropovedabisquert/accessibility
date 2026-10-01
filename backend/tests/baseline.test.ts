import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../src/app';
import { closeDb } from '../src/db/client';
import browserPool from '../src/services/scanner/browserPool';
import auditService from '../src/services/audit/audit.service';
import type { BaselineReport, CheckReview, ManualFinding, PageReview } from '../src/types/audit.types';
import { startFixtureServer, type FixtureServer } from './helpers/fixtureServer';
import { waitForAudit } from './helpers/waitFor';

const GIF = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

/**
 * Misma plantilla: cabecera con un texto sobre degradado (needs-review de axe
 * en 1.4.3) y pie con un enlace. Cambia el contenido principal.
 */
const page = (title: string, main: string) => `<!doctype html>
<html lang="es">
  <head><meta charset="utf-8"><title>${title}</title></head>
  <body style="background:#fff">
    <header>
      <nav aria-label="Principal"><a href="/a">Inicio</a> <a href="/b">Contacto</a></nav>
      <p style="color:#777;background-image:linear-gradient(90deg,#fff,#999)">Lema sobre degradado</p>
    </header>
    <main>${main}</main>
    <footer><a href="/aviso">Aviso legal</a></footer>
  </body>
</html>`;

const BASE = page('Casa A', `<h1>Casa A</h1><img src="${GIF}" alt="Fachada de la casa A" width="40" height="40">`);
// Mismo esqueleto con otros textos: estructuralmente es la misma pagina.
const TWIN = page('Casa B', `<h1>Casa B</h1><img src="${GIF}" alt="Fachada de la casa B" width="40" height="40">`);
// El principal cambia de estructura: lo de main no se puede heredar.
const OTHER = page('Listado', `<h1>Listado</h1><ul><li>Uno</li><li>Dos</li></ul><img src="${GIF}" alt="Mapa" width="40" height="40">`);

const WHO = 'Revisora IAAP';
let fixture: FixtureServer;
let auditId = '';
const ids: Record<'base' | 'other' | 'twin', string> = { base: '', other: '', twin: '' };

const reviewOf = async (pageId: string) =>
  (await request(app).get(`/api/audits/${auditId}/pages/${pageId}/review`).expect(200)).body as PageReview;
const checkOf = (review: PageReview, checkId: string): CheckReview => {
  const check = review.checks.find((item) => item.checkId === checkId);
  if (!check) throw new Error(`Falta ${checkId}`);
  return check;
};
const human = { type: 'human', name: WHO };
const decide = async (pageId: string, body: Record<string, unknown>): Promise<ManualFinding> => {
  const created = await request(app).post(`/api/audits/${auditId}/pages/${pageId}/findings`).send({ ...body, assertedBy: human }).expect(201);
  return (await request(app).patch(`/api/findings/${created.body.id}/review`).send({ status: 'validated', by: WHO }).expect(200)).body;
};
const link = async (pageId: string, baselinePageId = ids.base) =>
  (await request(app).put(`/api/audits/${auditId}/pages/${pageId}/baseline`).send({ baselinePageId, by: WHO }).expect(200))
    .body as BaselineReport;

let focusVisibleBase: ManualFinding;

beforeAll(async () => {
  fixture = await startFixtureServer({ '/base': BASE, '/otra': OTHER, '/gemela': TWIN });
  const res = await request(app)
    .post('/api/audits')
    .send({ urls: [fixture.url('/base'), fixture.url('/otra'), fixture.url('/gemela')], evidence: true })
    .expect(202);
  const audit = await waitForAudit(app, res.body.id);
  auditId = audit.id;
  const byPath = (path: string) => audit.pages.find((item: { url: string }) => item.url.endsWith(path)).id;
  ids.base = byPath('/base');
  ids.other = byPath('/otra');
  ids.twin = byPath('/gemela');

  // La capa 3 revisa la linea base.
  const contrast = checkOf(await reviewOf(ids.base), 'contrast-minimum').findings.find(
    (finding) => finding.source.kind === 'axe-needs-review',
  );
  await request(app)
    .patch(`/api/findings/${contrast?.id}/review`)
    .send({ status: 'amended', by: WHO, outcome: 'passed', description: 'El lema supera 4,5:1 en todo el degradado' })
    .expect(200);
  await decide(ids.base, { checkId: 'non-text-content', outcome: 'passed', description: 'El alt describe la fachada', targets: [{ selector: 'main > img' }] });
  focusVisibleBase = await decide(ids.base, {
    checkId: 'focus-visible',
    outcome: 'passed',
    description: 'El enlace del pie muestra el foco',
    targets: [{ selector: 'footer > a' }],
  });
  await decide(ids.base, { checkId: 'page-titled', outcome: 'passed', description: 'El título identifica la ficha' });
});

afterAll(async () => {
  await auditService.drain();
  await browserPool.closeAll();
  await fixture.close();
  closeDb();
});

describe('candidatas a linea base', () => {
  it('son las de la misma pantalla, con cuantos hallazgos decididos tienen', async () => {
    const res = await request(app).get(`/api/audits/${auditId}/pages/${ids.other}/baseline-candidates`).expect(200);
    const base = res.body.find((item: { page: { id: string } }) => item.page.id === ids.base);
    expect(base.decidedFindings).toBe(4);
    expect(res.body.some((item: { page: { id: string } }) => item.page.id === ids.other)).toBe(false);
  });
});

describe('herencia', () => {
  it('hereda lo de las regiones iguales y explica lo que no', async () => {
    const report = await link(ids.other);

    const status = Object.fromEntries(report.regions.map((region) => [region.role, region.status]));
    expect(status).toMatchObject({ banner: 'same', contentinfo: 'same', main: 'changed' });
    expect(report.wholePageMatch).toBe(false);

    expect(report.inherited.map((item) => item.checkId).sort()).toEqual(['contrast-minimum', 'focus-visible']);
    expect(Object.fromEntries(report.notInherited.map((item) => [item.checkId, item.reason]))).toMatchObject({
      'non-text-content': 'targets-changed',
      'page-titled': 'page-changed',
    });

    const review = await reviewOf(ids.other);
    // La propuesta de axe de la pagina queda resuelta con el resultado de la linea base.
    const contrast = checkOf(review, 'contrast-minimum');
    expect(contrast.outcome).toBe('passed');
    expect(contrast.findings).toHaveLength(1);
    expect(contrast.findings[0]?.inheritedFrom?.findingId).toBeTruthy();
    expect(contrast.findings[0]?.review).toMatchObject({ status: 'amended', by: WHO });

    const focus = checkOf(review, 'focus-visible').findings[0];
    expect(focus?.review.status).toBe('validated');
    expect(focus?.review.note).toContain('/base');
    expect(checkOf(review, 'page-titled').outcome).toBe('untested');
  });

  it('una pagina gemela (otros textos, misma estructura) lo hereda todo', async () => {
    const report = await link(ids.twin);
    expect(report.wholePageMatch).toBe(true);
    expect(report.inherited.map((item) => item.checkId).sort()).toEqual([
      'contrast-minimum',
      'focus-visible',
      'non-text-content',
      'page-titled',
    ]);
    expect(report.focusSequence).toBe('same');
  });

  it('volver a enlazar no duplica', async () => {
    await link(ids.other);
    const review = await reviewOf(ids.other);
    expect(checkOf(review, 'focus-visible').findings).toHaveLength(1);
    expect(checkOf(review, 'contrast-minimum').findings).toHaveLength(1);
  });

  it('si se rechaza el original, las copias tambien', async () => {
    await request(app).patch(`/api/findings/${focusVisibleBase.id}/review`).send({ status: 'rejected', by: WHO, note: 'Era el hover' }).expect(200);
    for (const pageId of [ids.other, ids.twin]) {
      const copy = checkOf(await reviewOf(pageId), 'focus-visible').findings[0];
      expect(copy?.review.status).toBe('rejected');
      expect(copy?.review.note).toContain('Era el hover');
    }
  });

  it('quitar la linea base deja la pagina como estaba', async () => {
    await request(app).delete(`/api/audits/${auditId}/pages/${ids.other}/baseline`).expect(204);
    await request(app).get(`/api/audits/${auditId}/pages/${ids.other}/baseline`).expect(404);

    const review = await reviewOf(ids.other);
    const contrast = checkOf(review, 'contrast-minimum');
    expect(contrast.outcome).toBe('cantTell');
    expect(contrast.findings[0]).toMatchObject({ outcome: 'cantTell', inheritedFrom: null });
    expect(contrast.findings[0]?.review.status).toBe('proposed');
    expect(checkOf(review, 'focus-visible').findings).toHaveLength(0);
  });
});

describe('errores', () => {
  it('una pagina no es su propia linea base', async () => {
    await request(app).put(`/api/audits/${auditId}/pages/${ids.base}/baseline`).send({ baselinePageId: ids.base, by: WHO }).expect(400);
  });

  it('pide quien enlaza', async () => {
    await request(app).put(`/api/audits/${auditId}/pages/${ids.other}/baseline`).send({ baselinePageId: ids.base }).expect(400);
  });

  it('no compara pantallas distintas ni paginas sin DOM guardado', async () => {
    const mobile = await request(app)
      .post('/api/audits')
      .send({ urls: [fixture.url('/otra')], evidence: true, viewport: { width: 390, height: 844 } })
      .expect(202);
    const mobileAudit = await waitForAudit(app, mobile.body.id);
    await request(app)
      .put(`/api/audits/${mobileAudit.id}/pages/${mobileAudit.pages[0].id}/baseline`)
      .send({ baselinePageId: ids.base, by: WHO })
      .expect(400);

    const plain = await request(app).post('/api/audits').send({ urls: [fixture.url('/otra')] }).expect(202);
    const plainAudit = await waitForAudit(app, plain.body.id);
    const res = await request(app)
      .put(`/api/audits/${plainAudit.id}/pages/${plainAudit.pages[0].id}/baseline`)
      .send({ baselinePageId: ids.base, by: WHO })
      .expect(409);
    expect(res.body.error).toContain('DOM guardado');
  });
});
