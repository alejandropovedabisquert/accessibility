import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../src/app';
import { closeDb } from '../src/db/client';
import browserPool from '../src/services/scanner/browserPool';

afterAll(async () => {
  await browserPool.closeAll();
  closeDb();
});

describe('GET /health', () => {
  it('responde ok', async () => {
    const res = await request(app).get('/health').expect(200);
    expect(res.body.status).toBe('ok');
  });
});

describe('GET /api/meta', () => {
  it('devuelve navegadores, dispositivos, tags y limites', async () => {
    const res = await request(app).get('/api/meta').expect(200);

    expect(res.body.browsers.map((b: { id: string }) => b.id)).toEqual([
      'chromium',
      'firefox',
      'webkit',
    ]);
    expect(res.body.devices.length).toBeGreaterThan(0);
    expect(res.body.tags.some((t: { id: string }) => t.id === 'wcag21aa')).toBe(true);
    expect(res.body.limits.maxUrlsPerAudit).toBeGreaterThan(0);
  });

  it('publica los atajos de seccion y el limite de selector', async () => {
    const res = await request(app).get('/api/meta').expect(200);

    const header = res.body.sections.find((s: { id: string }) => s.id === 'header');
    expect(header.selector).toContain('header');
    expect(res.body.limits.maxSelectorLength).toBeGreaterThan(0);
  });
});

describe('POST /api/audits (validacion)', () => {
  const cases: Array<[string, unknown, string]> = [
    ['sin body', {}, 'urls'],
    ['urls vacio', { urls: [] }, 'urls'],
    ['urls no es array', { urls: 'https://example.com' }, 'urls'],
    ['url sin protocolo valido', { urls: ['ftp://example.com'] }, 'urls'],
    ['url invalida', { urls: ['no-es-una-url'] }, 'urls'],
    ['navegador no soportado', { urls: ['https://example.com'], browser: 'edge' }, 'browser'],
    ['dispositivo inexistente', { urls: ['https://example.com'], device: 'Nokia 3310' }, 'device'],
    ['waitUntil invalido', { urls: ['https://example.com'], waitUntil: 'siempre' }, 'waitUntil'],
    ['timeout fuera de rango', { urls: ['https://example.com'], timeout: 10 }, 'timeout'],
    ['campo desconocido', { urls: ['https://example.com'], foo: 1 }, ''],
    ['objetivo sin url', { urls: [{ include: 'header' }] }, 'urls'],
    ['selector vacio', { urls: [{ url: 'https://example.com', include: '' }] }, 'urls'],
    ['selector kilometrico', { urls: [{ url: 'https://example.com', include: 'a'.repeat(201) }] }, 'urls'],
    ['clave extra en el objetivo', { urls: [{ url: 'https://example.com', scope: 'header' }] }, 'urls'],
  ];

  it.each(cases)('rechaza %s con 400', async (_name, body, field) => {
    const res = await request(app).post('/api/audits').send(body as object).expect(400);
    expect(res.body.error).toBeTruthy();
    if (field) {
      const fields = (res.body.details ?? []).map((d: { field: string }) => d.field).join(' ');
      expect(fields).toContain(field);
    }
  });

  it('rechaza combinar device y viewport', async () => {
    const res = await request(app)
      .post('/api/audits')
      .send({
        urls: ['https://example.com'],
        device: 'iPhone 15',
        viewport: { width: 800, height: 600 },
      })
      .expect(400);

    expect(JSON.stringify(res.body)).toContain('device');
  });
});

describe('rutas inexistentes', () => {
  it('devuelve 404 con JSON', async () => {
    const res = await request(app).get('/api/no-existe').expect(404);
    expect(res.body.error).toContain('no encontrada');
  });

  it('devuelve 404 para una auditoria desconocida', async () => {
    const res = await request(app)
      .get('/api/audits/00000000-0000-0000-0000-000000000000')
      .expect(404);
    expect(res.body.error).toBe('Auditoria no encontrada');
  });
});
