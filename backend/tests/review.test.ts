import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../src/app';
import { closeDb } from '../src/db/client';
import browserPool from '../src/services/scanner/browserPool';
import auditService from '../src/services/audit/audit.service';
import { deriveOutcome } from '../src/services/review/review.service';
import type { CheckReview, ManualFinding, PageReview } from '../src/types/audit.types';
import { startFixtureServer, type FixtureServer } from './helpers/fixtureServer';
import { waitForAudit } from './helpers/waitFor';

/**
 * Texto sobre degradado: axe no puede calcular el contraste y lo deja en
 * `incomplete` (color-contrast → 1.4.3). La imagen sin alt es una violacion
 * (image-alt → 1.1.1).
 */
const REVIEW_PAGE = `<!doctype html>
<html lang="es">
  <head><meta charset="utf-8"><title>Pagina para revisar</title></head>
  <body style="background:#ffffff">
    <main>
      <h1 style="color:#111111">Titulo</h1>
      <p style="color:#777777;background-image:linear-gradient(90deg,#ffffff,#999999)">Texto sobre degradado</p>
      <p style="color:#777777;background-image:linear-gradient(90deg,#ffffff,#888888)">Otro texto sobre degradado</p>
      <img src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==">
    </main>
  </body>
</html>`;

const AI = { type: 'ai', name: 'Claude', model: 'claude-opus-5-5' };
const HUMAN = { type: 'human', name: 'Revisora IAAP', assistiveTech: 'NVDA 2025.1 + Firefox' };

let fixture: FixtureServer;
let auditId = '';
let pageId = '';
let host = '';

const reviewUrl = () => `/api/audits/${auditId}/pages/${pageId}/review`;
const checkOf = (review: PageReview, checkId: string): CheckReview => {
  const check = review.checks.find((item) => item.checkId === checkId);
  if (!check) throw new Error(`Falta el criterio ${checkId} en la revision`);
  return check;
};
const contrastProposal = (review: PageReview): ManualFinding => {
  const finding = checkOf(review, 'contrast-minimum').findings.find((item) => item.source.kind === 'axe-needs-review');
  if (!finding) throw new Error('Falta la propuesta de axe de contraste');
  return finding;
};

beforeAll(async () => {
  fixture = await startFixtureServer({ '/revisar': REVIEW_PAGE });
  host = new URL(fixture.url('/revisar')).host;

  const res = await request(app).post('/api/audits').send({ urls: [fixture.url('/revisar')] }).expect(202);
  auditId = res.body.id;
  const audit = await waitForAudit(app, auditId);
  expect(audit.status).toBe('completed');
  pageId = audit.pages[0].id;
});

afterAll(async () => {
  await auditService.drain();
  await browserPool.closeAll();
  await fixture.close();
  closeDb();
});

describe('GET /api/checks', () => {
  it('publica el catalogo con las reglas de axe ya calculadas', async () => {
    const res = await request(app).get('/api/checks').expect(200);
    expect(res.body.id).toBe('wcag22-aa');
    expect(res.body.checks).toHaveLength(55);
    const contrast = res.body.checks.find((check: { id: string }) => check.id === 'contrast-minimum');
    expect(contrast.axeRules).toContain('color-contrast');
    expect(contrast.coverage).toBe('partial');
  });
});

describe('revision de una pagina', () => {
  it('convierte las needs-review de axe en propuestas y las violaciones en fallos', async () => {
    const res = await request(app).get(reviewUrl()).expect(200);
    const review = res.body as PageReview;

    expect(review.checks.every((check) => check.checkId !== 'multiple-ways')).toBe(true);
    expect(review.checks).toHaveLength(51);
    expect(Object.values(review.summary).reduce((sum, value) => sum + value, 0)).toBe(51);

    const contrast = checkOf(review, 'contrast-minimum');
    expect(contrast.outcome).toBe('cantTell');
    expect(contrast.axe.needsReview).toContain('color-contrast');
    expect(contrast.pendingReview).toBe(1);

    const proposal = contrastProposal(review);
    expect(proposal.outcome).toBe('cantTell');
    expect(proposal.assertedBy.type).toBe('tool');
    expect(proposal.assertedBy.name).toMatch(/^axe-core \d/);
    expect(proposal.targetCount).toBe(2);
    expect(proposal.targets[0]?.selector).toBeTruthy();

    const image = checkOf(review, 'non-text-content');
    expect(image.outcome).toBe('failed');
    expect(image.axe.violations).toContain('image-alt');

    expect(checkOf(review, 'focus-order').outcome).toBe('untested');
    expect(review.site).toBeNull();
  });

  it('abrirla dos veces no duplica las propuestas', async () => {
    const first = (await request(app).get(reviewUrl()).expect(200)).body as PageReview;
    const second = (await request(app).get(reviewUrl()).expect(200)).body as PageReview;
    expect(checkOf(second, 'contrast-minimum').findings).toHaveLength(1);
    expect(contrastProposal(second).id).toBe(contrastProposal(first).id);
  });

  it('maxTargets recorta los nodos pero conserva el total', async () => {
    const review = (await request(app).get(`${reviewUrl()}?maxTargets=1`).expect(200)).body as PageReview;
    const proposal = contrastProposal(review);
    expect(proposal.targets).toHaveLength(1);
    expect(proposal.targetCount).toBe(2);
  });

  it('404 si la pagina no es de esa auditoria', async () => {
    await request(app).get(`/api/audits/${auditId}/pages/no-existe/review`).expect(404);
  });
});

describe('ciclo de un hallazgo: capa 2 propone, capa 3 valida', () => {
  it('la capa 2 cierra la propuesta de axe y pasa a ser su autora', async () => {
    const proposal = contrastProposal((await request(app).get(reviewUrl()).expect(200)).body);
    const res = await request(app)
      .patch(`/api/findings/${proposal.id}`)
      .send({ outcome: 'passed', description: 'Ambos textos superan 4,5:1 en el punto mas oscuro del degradado', assertedBy: AI })
      .expect(200);

    expect(res.body.outcome).toBe('passed');
    expect(res.body.assertedBy).toEqual({ ...AI, assistiveTech: null });
    expect(res.body.source).toEqual({ kind: 'axe-needs-review', ruleId: 'color-contrast', checkId: 'contrast-minimum' });
    expect(res.body.targetCount).toBe(2);

    const review = (await request(app).get(reviewUrl()).expect(200)).body as PageReview;
    expect(checkOf(review, 'contrast-minimum').outcome).toBe('passed');
  });

  it('la capa 2 registra un criterio que axe no mira', async () => {
    const res = await request(app)
      .post(`/api/audits/${auditId}/pages/${pageId}/findings`)
      .send({
        checkId: 'focus-order',
        outcome: 'failed',
        targets: [{ selector: 'main > img', html: '<img src="data:...">' }],
        description: 'El foco salta del título a la imagen saltándose el texto',
        assertedBy: AI,
      })
      .expect(201);

    expect(res.headers.location).toBe(`/api/findings/${res.body.id}`);
    expect(res.body.review).toEqual({ status: 'proposed', by: null, at: null, note: null });
    expect(res.body.source).toEqual({ kind: 'check', checkId: 'focus-order', catalogVersion: 1 });
    expect(res.body.targetCount).toBe(1);
  });

  it('la capa 3 valida y a partir de ahi el contenido queda cerrado', async () => {
    const proposal = contrastProposal((await request(app).get(reviewUrl()).expect(200)).body);

    const validated = await request(app)
      .patch(`/api/findings/${proposal.id}/review`)
      .send({ status: 'validated', by: HUMAN.name, note: 'Comprobado con el analizador de contraste' })
      .expect(200);
    expect(validated.body.review.status).toBe('validated');
    expect(validated.body.review.by).toBe(HUMAN.name);
    expect(validated.body.review.at).toBeTruthy();

    await request(app).patch(`/api/findings/${proposal.id}`).send({ outcome: 'failed', assertedBy: AI }).expect(409);
  });

  it('la capa 3 corrige (amended) cambiando el resultado', async () => {
    const created = await request(app)
      .post(`/api/audits/${auditId}/pages/${pageId}/findings`)
      .send({ checkId: 'page-titled', outcome: 'passed', description: 'Título descriptivo', assertedBy: AI })
      .expect(201);

    await request(app)
      .patch(`/api/findings/${created.body.id}/review`)
      .send({ status: 'amended', by: HUMAN.name })
      .expect(400);
    await request(app)
      .patch(`/api/findings/${created.body.id}/review`)
      .send({ status: 'validated', by: HUMAN.name, outcome: 'failed' })
      .expect(400);

    const amended = await request(app)
      .patch(`/api/findings/${created.body.id}/review`)
      .send({ status: 'amended', by: HUMAN.name, outcome: 'failed', note: '"Pagina para revisar" no dice de qué va' })
      .expect(200);
    expect(amended.body.outcome).toBe('failed');
    expect(amended.body.review.status).toBe('amended');
  });

  it('no deja validar un cantTell, pero si rechazarlo', async () => {
    const created = await request(app)
      .post(`/api/audits/${auditId}/pages/${pageId}/findings`)
      .send({ checkId: 'reflow', outcome: 'cantTell', description: 'No se pudo comprobar', assertedBy: AI })
      .expect(201);

    await request(app)
      .patch(`/api/findings/${created.body.id}/review`)
      .send({ status: 'validated', by: HUMAN.name })
      .expect(400);
    await request(app)
      .patch(`/api/findings/${created.body.id}/review`)
      .send({ status: 'rejected', by: HUMAN.name })
      .expect(200);

    const review = (await request(app).get(reviewUrl()).expect(200)).body as PageReview;
    expect(checkOf(review, 'reflow').outcome).toBe('untested');
  });

  it.each<[string, Record<string, unknown>]>([
    ['criterio desconocido', { checkId: 'telepatia', outcome: 'passed', description: 'x', assertedBy: AI }],
    ['criterio de sitio en una pagina', { checkId: 'multiple-ways', outcome: 'passed', description: 'x', assertedBy: AI }],
    ['autor tool', { checkId: 'reflow', outcome: 'passed', description: 'x', assertedBy: { type: 'tool', name: 'yo' } }],
    ['resultado untested', { checkId: 'reflow', outcome: 'untested', description: 'x', assertedBy: AI }],
    ['sin descripcion', { checkId: 'reflow', outcome: 'passed', assertedBy: AI }],
    [
      'targetCount menor que los targets',
      { checkId: 'reflow', outcome: 'failed', description: 'x', assertedBy: AI, targetCount: 0, targets: [{ selector: 'main' }] },
    ],
  ])('rechaza con 400: %s', async (_name, body) => {
    await request(app).post(`/api/audits/${auditId}/pages/${pageId}/findings`).send(body).expect(400);
  });
});

describe('sitios', () => {
  let siteId = '';

  it('crea un sitio a partir de una URL pegada y casa las paginas por host', async () => {
    const res = await request(app)
      .post('/api/sites')
      .send({ name: 'Web de prueba', hosts: [fixture.url('/revisar'), host] })
      .expect(201);
    siteId = res.body.id;
    expect(res.body.origins).toEqual([host]);

    const detail = await request(app).get(`/api/sites/${siteId}`).expect(200);
    expect(detail.body.pages.map((page: { id: string }) => page.id)).toContain(pageId);

    const review = (await request(app).get(reviewUrl()).expect(200)).body as PageReview;
    expect(review.site?.id).toBe(siteId);
  });

  it('un host no puede ser de dos sitios', async () => {
    const res = await request(app).post('/api/sites').send({ name: 'Otra', hosts: [host] }).expect(409);
    expect(res.body.error).toContain('Web de prueba');
  });

  it('los criterios de sitio van al sitio, no a la pagina', async () => {
    await request(app)
      .post(`/api/sites/${siteId}/findings`)
      .send({ checkId: 'focus-order', outcome: 'passed', description: 'x', assertedBy: AI })
      .expect(400);

    const created = await request(app)
      .post(`/api/sites/${siteId}/findings`)
      .send({ checkId: 'consistent-navigation', outcome: 'passed', description: 'Mismo menú en toda la muestra', assertedBy: AI })
      .expect(201);
    expect(created.body.subject).toEqual({ kind: 'site', siteId });

    const detail = await request(app).get(`/api/sites/${siteId}`).expect(200);
    expect(detail.body.findings.map((finding: { id: string }) => finding.id)).toEqual([created.body.id]);
  });

  it('borrar el sitio borra sus hallazgos pero no las paginas', async () => {
    await request(app).delete(`/api/sites/${siteId}`).expect(204);
    await request(app).get(`/api/sites/${siteId}`).expect(404);
    const review = (await request(app).get(reviewUrl()).expect(200)).body as PageReview;
    expect(review.site).toBeNull();
  });
});

describe('falsos positivos de axe (capa 3)', () => {
  const url = () => `/api/audits/${auditId}/pages/${pageId}/false-positives`;
  const nonText = async () =>
    checkOf((await request(app).get(reviewUrl()).expect(200)).body as PageReview, 'non-text-content');

  it('validan y quitan la violacion del calculo, sin dar el criterio por cumplido', async () => {
    const res = await request(app)
      .post(url())
      .send({ checkId: 'non-text-content', ruleId: 'image-alt', by: HUMAN.name, note: 'Es un píxel de seguimiento oculto' })
      .expect(201);
    expect(res.body.source).toEqual({ kind: 'axe-false-positive', ruleId: 'image-alt', checkId: 'non-text-content' });
    expect(res.body.review).toMatchObject({ status: 'validated', by: HUMAN.name, note: 'Es un píxel de seguimiento oculto' });
    expect(res.body.assertedBy.type).toBe('human');

    const check = await nonText();
    expect(check.axe.violations).toEqual([]);
    expect(check.axe.falsePositives).toEqual(['image-alt']);
    expect(check.outcome).toBe('untested');
  });

  it('no se duplican, piden justificacion y solo valen para violaciones reales del criterio', async () => {
    await request(app)
      .post(url())
      .send({ checkId: 'non-text-content', ruleId: 'image-alt', by: HUMAN.name, note: 'otra vez' })
      .expect(409);
    await request(app).post(url()).send({ checkId: 'non-text-content', ruleId: 'image-alt', by: HUMAN.name }).expect(400);
    await request(app)
      .post(url())
      .send({ checkId: 'contrast-minimum', ruleId: 'image-alt', by: HUMAN.name, note: 'x' })
      .expect(400);
    await request(app)
      .post(url())
      .send({ checkId: 'non-text-content', ruleId: 'svg-img-alt', by: HUMAN.name, note: 'x' })
      .expect(400);
  });

  it('rechazarlo devuelve la violacion', async () => {
    const fp = (await nonText()).findings.find((finding) => finding.source.kind === 'axe-false-positive');
    await request(app).patch(`/api/findings/${fp?.id}/review`).send({ status: 'rejected', by: HUMAN.name }).expect(200);
    const check = await nonText();
    expect(check.axe.violations).toEqual(['image-alt']);
    expect(check.outcome).toBe('failed');
  });
});

describe('deriveOutcome', () => {
  const finding = (
    outcome: ManualFinding['outcome'],
    status: ManualFinding['review']['status'] = 'proposed',
    source: ManualFinding['source'] = { kind: 'check', checkId: 'x', catalogVersion: 1 },
  ) => ({ outcome, review: { status }, source }) as ManualFinding;
  const falsePositive = (ruleId: string, status: ManualFinding['review']['status'] = 'validated') =>
    finding('passed', status, { kind: 'axe-false-positive', ruleId, checkId: 'x' });

  it('una violacion de axe manda sobre cualquier hallazgo', () => {
    expect(deriveOutcome(['image-alt'], [finding('passed', 'validated')])).toBe('failed');
  });

  it('un falso positivo quita su regla, no las demas, y no cuenta como cumple', () => {
    expect(deriveOutcome(['image-alt'], [falsePositive('image-alt')])).toBe('untested');
    expect(deriveOutcome(['image-alt', 'role-img-alt'], [falsePositive('image-alt')])).toBe('failed');
    expect(deriveOutcome(['image-alt'], [falsePositive('image-alt', 'rejected')])).toBe('failed');
    expect(deriveOutcome(['image-alt'], [falsePositive('image-alt'), finding('cantTell')])).toBe('cantTell');
  });

  it('manda lo peor de los hallazgos no rechazados', () => {
    expect(deriveOutcome([], [finding('passed'), finding('cantTell')])).toBe('cantTell');
    expect(deriveOutcome([], [finding('passed'), finding('failed', 'rejected')])).toBe('passed');
    expect(deriveOutcome([], [finding('inapplicable'), finding('passed')])).toBe('passed');
    expect(deriveOutcome([], [])).toBe('untested');
  });
});
