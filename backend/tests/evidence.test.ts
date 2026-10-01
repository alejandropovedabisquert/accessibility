import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../src/app';
import { closeDb } from '../src/db/client';
import browserPool from '../src/services/scanner/browserPool';
import auditService from '../src/services/audit/audit.service';
import type { PageEvidence, PageReview } from '../src/types/audit.types';
import { startFixtureServer, type FixtureServer } from './helpers/fixtureServer';
import { waitForAudit } from './helpers/waitFor';

const GIF = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

/**
 * Una pagina con algo que encontrar para cada recolector. El CSP prohibe
 * cualquier script de la pagina: los probes tienen que funcionar igual, porque
 * muchas webs reales lo tienen.
 */
const EVIDENCE_PAGE = `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="script-src 'none'">
    <title>Pagina con evidencia</title>
    <style>
      body { margin: 0; font: 16px sans-serif; background: #fff; color: #111; }
      #tapa { position: fixed; top: 0; left: 0; right: 0; height: 60px; background: #fff; z-index: 10; }
      #sin-foco:focus { outline: none; }
      #ancho { width: 600px; }
      #caja { height: 20px; overflow: hidden; width: 200px; }
    </style>
  </head>
  <body>
    <a id="tapado" href="#principal" style="position:absolute;top:10px;left:10px">Saltar al contenido</a>
    <div id="tapa"></div>
    <header style="margin-top:70px"><nav aria-label="Principal"><a href="/uno">Uno</a> <a href="/dos">Dos</a></nav></header>
    <main id="principal">
      <h1>Titulo</h1>
      <h2>Formulario</h2>
      <form>
        <label for="nombre">Nombre</label>
        <input id="nombre" name="nombre" required autocomplete="name">
        <input id="huerfano" name="huerfano" placeholder="Sin etiqueta">
        <button id="sin-foco" type="button">Enviar</button>
      </form>
      <p>Texto con una frase <span lang="en">in English</span> dentro.</p>
      <img id="sin-alt" src="${GIF}" width="40" height="40">
      <img id="decorativa" src="${GIF}" alt="" width="40" height="40">
      <div id="ancho">Bloque de ancho fijo</div>
      <div id="caja">Texto que cabe justo en una linea</div>
    </main>
  </body>
</html>`;

let fixture: FixtureServer;
let auditId = '';
let pageId = '';

const base = () => `/api/audits/${auditId}/pages/${pageId}`;

beforeAll(async () => {
  fixture = await startFixtureServer({ '/evidencia': EVIDENCE_PAGE });
  const res = await request(app)
    .post('/api/audits')
    .send({ urls: [fixture.url('/evidencia')], evidence: true, viewport: { width: 1024, height: 768 } })
    .expect(202);
  auditId = res.body.id;
  const audit = await waitForAudit(app, auditId);
  expect(audit.status).toBe('completed');
  expect(audit.config.evidence).toBe(true);
  pageId = audit.pages[0].id;
});

afterAll(async () => {
  await auditService.drain();
  await browserPool.closeAll();
  await fixture.close();
  closeDb();
});

describe('recoleccion de evidencia', () => {
  let evidence: PageEvidence;

  beforeAll(async () => {
    evidence = (await request(app).get(`${base()}/evidence`).expect(200)).body;
  });

  it('recoge todos los tipos sin errores, aunque la pagina prohiba sus scripts', () => {
    expect(evidence.errors).toEqual({});
    expect(Object.keys(evidence.items).sort()).toEqual(
      [
        'controls',
        'focus-sequence',
        'forms',
        'headings',
        'images',
        'landmarks',
        'media',
        'orientation',
        'reflow-320',
        'screenshot',
        'text-content',
        'text-spacing',
        'zoom-200',
      ].sort(),
    );
    expect(evidence.viewport).toEqual({ width: 1024, height: 768 });
  });

  it('secuencia de foco: orden, indicador y lo que queda tapado', () => {
    const focus = evidence.items['focus-sequence'];
    expect(focus?.stoppedBecause).toBe('cycle');
    const selectors = focus?.stops.map((stop) => stop.selector) ?? [];
    expect(selectors.slice(0, 1)).toEqual(['#tapado']);
    expect(selectors).toContain('#nombre');
    expect(selectors.indexOf('#nombre')).toBeLessThan(selectors.indexOf('#sin-foco'));

    const byId = (selector: string) => focus?.stops.find((stop) => stop.selector === selector);
    expect(byId('#tapado')?.obscured).toBe('full');
    expect(byId('#nombre')?.obscured).toBe('none');
    expect(byId('#sin-foco')?.indicator).toBe('unchanged');
    expect(byId('#nombre')?.indicator).toBe('changed');
    expect(byId('#nombre')?.screenshot).toMatch(/^focus-\d+\.jpg$/);
  });

  it('reflujo a 320 px: detecta el scroll horizontal y quien lo provoca', () => {
    const reflow = evidence.items['reflow-320'];
    expect(reflow?.viewport).toEqual({ width: 320, height: 256 });
    expect(reflow?.horizontalScroll).toBe(true);
    expect(reflow?.overflowing.map((element) => element.selector)).toContain('#ancho');
    expect(evidence.items['zoom-200']?.viewport).toEqual({ width: 512, height: 384 });
  });

  it('espaciado de texto: detecta el texto que se corta', () => {
    const spacing = evidence.items['text-spacing'];
    expect(spacing?.clipped.map((element) => element.selector)).toContain('#caja');
  });

  it('imagenes: distingue sin alt de alt vacio', () => {
    const images = evidence.items.images;
    const byId = (selector: string) => images?.items.find((image) => image.selector === selector);
    expect(byId('#sin-alt')).toMatchObject({ alt: null, decorative: false });
    expect(byId('#decorativa')).toMatchObject({ alt: '', decorative: true });
    expect(byId('#sin-alt')?.screenshot).toMatch(/^image-\d+\.jpg$/);
  });

  it('formularios, idioma, encabezados y regiones', () => {
    const fields = evidence.items.forms?.fields ?? [];
    expect(fields.find((field) => field.selector === '#nombre')).toMatchObject({
      label: 'Nombre',
      required: true,
      autocomplete: 'name',
    });
    expect(fields.find((field) => field.selector === '#huerfano')?.label).toBeNull();

    const text = evidence.items['text-content'];
    expect(text?.lang).toBe('es');
    expect(text?.langParts).toEqual([expect.objectContaining({ lang: 'en', text: 'in English' })]);

    expect(evidence.items.headings?.items.map((heading) => heading.level)).toEqual([1, 2]);
    // El <form> no tiene nombre accesible: segun ARIA no es region y no debe salir.
    expect(evidence.items.landmarks?.items.map((landmark) => landmark.role)).toEqual(['banner', 'navigation', 'main']);
    expect(evidence.items.landmarks?.ariaSnapshot).toContain('navigation "Principal"');
  });

  it('cuenta lo que casa con appliesWhen de cada criterio', () => {
    expect(evidence.applicability['captions-prerecorded']).toBe(0);
    expect(evidence.applicability['identify-input-purpose']).toBeGreaterThan(0);
  });

  it('?kinds= devuelve solo esos tipos', async () => {
    const res = await request(app).get(`${base()}/evidence?kinds=images,headings`).expect(200);
    expect(Object.keys(res.body.items).sort()).toEqual(['headings', 'images']);
    await request(app).get(`${base()}/evidence?kinds=telepatia`).expect(400);
  });
});

describe('capturas', () => {
  it('sirve las capturas como jpeg', async () => {
    const res = await request(app).get(`${base()}/evidence/files/viewport.jpg`).expect(200);
    expect(res.headers['content-type']).toBe('image/jpeg');
    expect(res.body.length).toBeGreaterThan(1000);
  });

  it('rechaza nombres que no son de capturas y da 404 si no existe', async () => {
    await request(app).get(`${base()}/evidence/files/evidence.json`).expect(400);
    await request(app).get(`${base()}/evidence/files/..%2Faudits.db`).expect(400);
    await request(app).get(`${base()}/evidence/files/focus-999.jpg`).expect(404);
  });
});

describe('revision con evidencia', () => {
  it('propone no aplicable lo que appliesWhen no encuentra, y dice que evidencia hay', async () => {
    const review = (await request(app).get(`${base()}/review`).expect(200)).body as PageReview;
    expect(review.evidence?.collected).toContain('focus-sequence');

    const captions = review.checks.find((check) => check.checkId === 'captions-prerecorded');
    expect(captions?.outcome).toBe('inapplicable');
    expect(captions?.findings[0]?.source).toEqual({
      kind: 'applicability',
      checkId: 'captions-prerecorded',
      selector: expect.stringContaining('video'),
    });
    expect(captions?.findings[0]?.assertedBy.type).toBe('tool');

    const purpose = review.checks.find((check) => check.checkId === 'identify-input-purpose');
    expect(purpose?.findings.some((finding) => finding.source.kind === 'applicability')).toBe(false);

    // Abrirla otra vez no duplica las propuestas.
    const again = (await request(app).get(`${base()}/review`).expect(200)).body as PageReview;
    expect(again.checks.find((check) => check.checkId === 'captions-prerecorded')?.findings).toHaveLength(1);
  });

  it('sin evidence: true no hay evidencia ni propuestas de no aplicable', async () => {
    const res = await request(app).post('/api/audits').send({ urls: [fixture.url('/evidencia')] }).expect(202);
    const audit = await waitForAudit(app, res.body.id);
    const otherPage = audit.pages[0].id;
    expect(audit.config.evidence).toBe(false);

    await request(app).get(`/api/audits/${audit.id}/pages/${otherPage}/evidence`).expect(404);
    const review = (await request(app).get(`/api/audits/${audit.id}/pages/${otherPage}/review`).expect(200))
      .body as PageReview;
    expect(review.evidence).toBeNull();
    expect(review.checks.find((check) => check.checkId === 'captions-prerecorded')?.outcome).toBe('untested');
  });
});
