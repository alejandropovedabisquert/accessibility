import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../src/app';
import { closeDb } from '../src/db/client';
import browserPool from '../src/services/scanner/browserPool';
import auditService from '../src/services/audit/audit.service';
import reviewRepository from '../src/db/review.repository';
import rawStore from '../src/services/storage/rawStore';
import { aggregateOutcome, conformanceOf, snapshotHash } from '../src/services/review/signoff.service';
import type { CriterionResult, PageReview, SignOff, SignOffDetail, SignOffPreview, SignOffSnapshot } from '../src/types/audit.types';
import { startFixtureServer, type FixtureServer } from './helpers/fixtureServer';
import { waitForAudit } from './helpers/waitFor';

/** Una imagen sin alt: 1.1.1 falla por axe y la web no puede salir plenamente conforme. */
const PAGE = `<!doctype html>
<html lang="es">
  <head><meta charset="utf-8"><title>Web a firmar</title></head>
  <body style="background:#fff">
    <header><nav aria-label="Principal"><a href="/a">Inicio</a></nav></header>
    <main>
      <h1 style="color:#111">Titulo</h1>
      <p style="color:#111">Contenido.</p>
      <img src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==" width="40" height="40">
    </main>
  </body>
</html>`;

const SIGNER = 'Revisora IAAP';
let fixture: FixtureServer;
let siteId = '';
let auditId = '';
let pageId = '';
let otherPageId = '';
let signOff: SignOffDetail;

const preview = async (ids: string[]) =>
  (await request(app).get(`/api/sites/${siteId}/sign-off-preview?pageIds=${ids.join(',')}`).expect(200)).body as SignOffPreview;

/** Deja todos los criterios decididos y validados, como haria la capa 3 tras revisar. */
const resolveEverything = async () => {
  const review = (await request(app).get(`/api/audits/${auditId}/pages/${pageId}/review`).expect(200)).body as PageReview;
  for (const check of review.checks) {
    for (const finding of check.findings.filter((item) => item.review.status === 'proposed')) {
      const body =
        finding.outcome === 'cantTell'
          ? { status: 'amended', by: SIGNER, outcome: 'passed' }
          : { status: 'validated', by: SIGNER };
      await request(app).patch(`/api/findings/${finding.id}/review`).send(body).expect(200);
    }
    if (check.outcome === 'untested' || check.outcome === 'cantTell') {
      const created = await request(app)
        .post(`/api/audits/${auditId}/pages/${pageId}/findings`)
        .send({ checkId: check.checkId, outcome: 'passed', description: 'Comprobado', assertedBy: { type: 'human', name: SIGNER } })
        .expect(201);
      await request(app).patch(`/api/findings/${created.body.id}/review`).send({ status: 'validated', by: SIGNER }).expect(200);
    }
  }
  for (const checkId of ['multiple-ways', 'consistent-navigation', 'consistent-identification', 'consistent-help']) {
    const created = await request(app)
      .post(`/api/sites/${siteId}/findings`)
      .send({ checkId, outcome: checkId === 'multiple-ways' ? 'passed' : 'inapplicable', description: 'Una sola página', assertedBy: { type: 'human', name: SIGNER } })
      .expect(201);
    await request(app).patch(`/api/findings/${created.body.id}/review`).send({ status: 'validated', by: SIGNER }).expect(200);
  }
};

beforeAll(async () => {
  fixture = await startFixtureServer({ '/firmar': PAGE });
  const res = await request(app).post('/api/audits').send({ urls: [fixture.url('/firmar')], evidence: true }).expect(202);
  const audit = await waitForAudit(app, res.body.id);
  auditId = audit.id;
  pageId = audit.pages[0].id;

  const site = await request(app).post('/api/sites').send({ name: 'Web firmada', hosts: [fixture.url('/')] }).expect(201);
  siteId = site.body.id;

  // Pagina de otro host, para comprobar que no entra en la muestra.
  const other = await request(app).post('/api/audits').send({ urls: [fixture.url('/firmar').replace('127.0.0.1', 'localhost')] }).expect(202);
  otherPageId = (await waitForAudit(app, other.body.id)).pages[0].id;
});

afterAll(async () => {
  await auditService.drain();
  await browserPool.closeAll();
  await fixture.close();
  closeDb();
});

describe('vista previa de la firma', () => {
  it('sin revisar, enumera lo que impide firmar', async () => {
    const result = await preview([pageId]);
    expect(result.canSign).toBe(false);
    expect(result.blockers.some((blocker) => blocker.kind === 'untested')).toBe(true);
    expect(result.blockers.some((blocker) => blocker.kind === 'pending-review')).toBe(true);
    expect(result.snapshot.criteria).toHaveLength(86);
    expect(result.snapshot.criteria.find((criterion) => criterion.checkId === 'non-text-content')?.outcome).toBe('failed');
  });

  it('los AAA bloquean la firma, pero no son legales ni cuentan como WCAG 2.2', async () => {
    const result = await preview([pageId]);
    expect(result.blockers).toContainEqual(expect.objectContaining({ kind: 'untested', checkId: 'section-headings' }));
    const aaa = result.snapshot.criteria.filter((criterion) => criterion.level === 'AAA');
    expect(aaa).toHaveLength(31);
    expect(aaa.every((criterion) => !criterion.legal)).toBe(true);
    // Los no aplicables propuestos por la evidencia (sin vídeo, sin formularios...) cuentan como superados.
    expect(result.snapshot.aaa?.failed).toBe(0);
    expect((result.snapshot.aaa?.passed ?? 0) + (result.snapshot.aaa?.pending ?? 0)).toBe(31);
    expect(result.snapshot.aaa?.pending).toBeGreaterThan(0);
    expect(result.snapshot.wcag22.passed + result.snapshot.wcag22.failed + result.snapshot.wcag22.pending).toBe(6);
  });

  it('una pagina de otro host no entra en la muestra', async () => {
    const result = await preview([pageId, otherPageId]);
    expect(result.snapshot.pages.map((page) => page.id)).toEqual([pageId]);
    expect(result.blockers).toContainEqual(expect.objectContaining({ kind: 'page', pageId: otherPageId }));
  });

  it('no deja firmar con bloqueos y devuelve cuales son', async () => {
    const res = await request(app)
      .post(`/api/sites/${siteId}/sign-offs`)
      .send({ pageIds: [pageId], signer: SIGNER, statement: 'Declaro...' })
      .expect(409);
    expect(res.body.details.length).toBeGreaterThan(0);
  });
});

describe('firma', () => {
  it('con todo decidido y validado, firma y calcula la conformidad legal', async () => {
    await resolveEverything();
    const ready = await preview([pageId]);
    expect(ready.blockers).toEqual([]);
    expect(ready.canSign).toBe(true);

    const res = await request(app)
      .post(`/api/sites/${siteId}/sign-offs`)
      .send({ pageIds: [pageId], signer: SIGNER, credential: 'IAAP WAS', statement: 'Evaluado con NVDA y VoiceOver' })
      .expect(201);
    signOff = res.body;

    expect(signOff.conformance).toBe('partial');
    expect(signOff.snapshot.conformance.failed).toBe(1);
    expect(signOff.snapshot.conformance.applicable + signOff.snapshot.conformance.inapplicable).toBe(49);
    expect(signOff.snapshot.aaa).toEqual({ passed: 31, failed: 0, pending: 0 });
    expect(signOff.findingsHash).toMatch(/^[0-9a-f]{64}$/);
    expect(signOff.findingsHash).toBe(snapshotHash(signOff.snapshot));
    expect(signOff.stillMatches).toBe(true);

    const listed = await request(app).get(`/api/sites/${siteId}/sign-offs`).expect(200);
    expect(listed.body.map((item: { id: string }) => item.id)).toEqual([signOff.id]);
  });

  it('EARL: una asercion por hallazgo y por violacion de axe, con su modo', async () => {
    const res = await request(app).get(`/api/sign-offs/${signOff.id}/earl?download=1`).expect(200);
    expect(res.headers['content-type']).toContain('application/ld+json');
    expect(res.headers['content-disposition']).toContain('.jsonld');
    const earl = JSON.parse(res.text);

    expect(earl['@context'].earl).toBe('http://www.w3.org/ns/earl#');
    const assertions = earl['@graph'] as Array<Record<string, any>>;
    const axeFail = assertions.find(
      (item) => item['earl:test']['@id'] === 'WCAG22:non-text-content' && item['earl:mode']['@id'] === 'earl:automatic',
    );
    expect(axeFail?.['earl:result']['earl:outcome']['@id']).toBe('earl:failed');
    expect(assertions.some((item) => item['earl:mode']['@id'] === 'earl:manual')).toBe(true);
    expect(assertions.every((item) => item['earl:subject'])).toBe(true);
    expect(earl['a11y:signOff'].findingsHash).toBe(signOff.findingsHash);
  });

  it('el PDF se genera desde lo firmado', async () => {
    const res = await request(app).get(`/api/sign-offs/${signOff.id}/report.pdf`).expect(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(Buffer.from(res.body).subarray(0, 4).toString()).toBe('%PDF');
  });

  it('una firma del catalogo v1 (sin AAA) se recalcula con el suyo y sigue coincidiendo', async () => {
    const snapshot: SignOffSnapshot = {
      ...signOff.snapshot,
      catalog: { id: 'wcag22-aa', version: 1 },
      criteria: signOff.snapshot.criteria.filter((criterion) => criterion.level !== 'AAA'),
    };
    delete snapshot.aaa;
    const old: SignOff = {
      ...signOff,
      id: `${signOff.id}-v1`,
      catalogId: 'wcag22-aa',
      catalogVersion: 1,
      findingsHash: snapshotHash(snapshot),
    };
    await rawStore.saveSignOffSnapshot(old.id, snapshot);
    reviewRepository.insertSignOff(old);

    const detail = (await request(app).get(`/api/sign-offs/${old.id}`).expect(200)).body as SignOffDetail;
    expect(detail.stillMatches).toBe(true);
    expect(detail.snapshot.criteria).toHaveLength(55);
  });

  it('si se corrige un hallazgo despues, la firma lo nota y lo firmado no cambia', async () => {
    const finding = signOff.snapshot.criteria
      .find((criterion) => criterion.checkId === 'page-titled')
      ?.findings.find((item) => item.review.status === 'validated');
    await request(app)
      .patch(`/api/findings/${finding?.id}/review`)
      .send({ status: 'amended', by: SIGNER, outcome: 'failed', note: 'El título no dice de qué va' })
      .expect(200);

    const detail = (await request(app).get(`/api/sign-offs/${signOff.id}`).expect(200)).body as SignOffDetail;
    expect(detail.stillMatches).toBe(false);
    expect(detail.snapshot.criteria.find((criterion) => criterion.checkId === 'page-titled')?.outcome).toBe('passed');
    expect(detail.findingsHash).toBe(signOff.findingsHash);
  });

  it('valida la entrada', async () => {
    await request(app).post(`/api/sites/${siteId}/sign-offs`).send({ pageIds: [], signer: SIGNER, statement: 'x' }).expect(400);
    await request(app).post(`/api/sites/${siteId}/sign-offs`).send({ pageIds: [pageId], signer: SIGNER }).expect(400);
    await request(app).get(`/api/sites/${siteId}/sign-off-preview`).expect(400);
    await request(app).get('/api/sign-offs/no-existe').expect(404);
    await request(app).delete('/api/sign-offs/no-existe').expect(404);
  });
});

describe('borrado', () => {
  it('una firma se borra sola, con su copia congelada y su PDF', async () => {
    const pdf = rawStore.signOffPdfPath(signOff.id);
    expect(rawStore.exists(pdf)).toBe(true);

    await request(app).delete(`/api/sign-offs/${signOff.id}`).expect(204);

    await request(app).get(`/api/sign-offs/${signOff.id}`).expect(404);
    expect(await rawStore.readSignOffSnapshot(signOff.id)).toBeNull();
    expect(rawStore.exists(pdf)).toBe(false);
    // La otra firma y el sitio siguen.
    const listed = await request(app).get(`/api/sites/${siteId}/sign-offs`).expect(200);
    expect(listed.body.map((item: { id: string }) => item.id)).toEqual([`${signOff.id}-v1`]);
  });

  it('un sitio con firmas se borra con todas ellas', async () => {
    const remaining = `${signOff.id}-v1`;
    await request(app).delete(`/api/sites/${siteId}`).expect(204);

    await request(app).get(`/api/sites/${siteId}`).expect(404);
    await request(app).get(`/api/sign-offs/${remaining}`).expect(404);
    expect(await rawStore.readSignOffSnapshot(remaining)).toBeNull();
  });
});

describe('reglas de agregacion y conformidad', () => {
  const criterion = (outcome: CriterionResult['outcome'], legal = true) => ({ outcome, legal }) as CriterionResult;

  it('en la muestra, una pagina sin revisar pesa mas que otra que cumple', () => {
    expect(aggregateOutcome(['passed', 'untested'])).toBe('untested');
    expect(aggregateOutcome(['passed', 'inapplicable'])).toBe('passed');
    expect(aggregateOutcome(['inapplicable', 'inapplicable'])).toBe('inapplicable');
    expect(aggregateOutcome(['passed', 'failed', 'cantTell'])).toBe('failed');
    expect(aggregateOutcome([])).toBe('untested');
  });

  it('plenamente / parcialmente / no conforme, solo con criterios legales', () => {
    expect(conformanceOf([criterion('passed'), criterion('inapplicable'), criterion('failed', false)]).status).toBe('full');
    expect(conformanceOf([criterion('passed'), criterion('passed'), criterion('failed')]).status).toBe('partial');
    expect(conformanceOf([criterion('passed'), criterion('failed')]).status).toBe('non-conformant');
    expect(conformanceOf([criterion('failed'), criterion('inapplicable'), criterion('passed')])).toMatchObject({
      status: 'non-conformant',
      applicable: 2,
    });
  });

  it('el hash no depende del orden de las claves', () => {
    const a = { site: { id: 's', name: 'n' }, pages: [] } as unknown as SignOffSnapshot;
    const b = { pages: [], site: { name: 'n', id: 's' } } as unknown as SignOffSnapshot;
    expect(snapshotHash(a)).toBe(snapshotHash(b));
  });
});
