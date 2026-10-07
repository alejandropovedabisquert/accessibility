import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import app from '../../backend/src/app';
import { closeDb } from '../../backend/src/db/client';
import auditService from '../../backend/src/services/audit/audit.service';
import browserPool from '../../backend/src/services/scanner/browserPool';
import { startFixtureServer, type FixtureServer } from '../../backend/tests/helpers/fixtureServer';
import { ApiClient } from '../src/api';
import { createServer } from '../src/tools';

/** Contraste sobre degradado (needs-review de axe) y unos cuantos elementos enfocables. */
const PAGE = `<!doctype html>
<html lang="es">
  <head><meta charset="utf-8"><title>Pagina para el MCP</title></head>
  <body style="background:#fff">
    <header><nav aria-label="Principal"><a href="/a">Inicio</a> <a href="/b">Contacto</a></nav></header>
    <main>
      <h1 style="color:#111">Titulo</h1>
      <p style="color:#777;background-image:linear-gradient(90deg,#fff,#999)">Texto sobre degradado</p>
      <label for="q">Buscar</label><input id="q" autocomplete="off"><button>Ir</button>
    </main>
  </body>
</html>`;

type TextContent = { type: 'text'; text: string };
type ToolResult = { content: Array<TextContent | { type: 'image'; data: string; mimeType: string }>; isError?: boolean };

let fixture: FixtureServer;
let backend: Server;
let client: Client;
let auditId = '';
let pageId = '';

const call = async (name: string, args: Record<string, unknown> = {}): Promise<ToolResult> =>
  (await client.callTool({ name, arguments: args })) as ToolResult;

const callJson = async <T = Record<string, unknown>>(name: string, args: Record<string, unknown> = {}): Promise<T> => {
  const result = await call(name, args);
  const first = result.content[0] as TextContent;
  if (result.isError) throw new Error(`${name} devolvio error: ${first.text}`);
  return JSON.parse(first.text) as T;
};

const connect = async (baseUrl: string) => {
  const server = createServer(new ApiClient(baseUrl), { name: 'Claude', model: 'claude-test' });
  const mcpClient = new Client({ name: 'tests', version: '1.0.0' });
  const [clientEnd, serverEnd] = InMemoryTransport.createLinkedPair();
  await server.connect(serverEnd);
  await mcpClient.connect(clientEnd);
  return mcpClient;
};

beforeAll(async () => {
  fixture = await startFixtureServer({ '/mcp': PAGE });
  backend = app.listen(0);
  await new Promise<void>((resolve) => backend.once('listening', () => resolve()));
  client = await connect(`http://127.0.0.1:${(backend.address() as AddressInfo).port}/api`);
});

afterAll(async () => {
  await client.close();
  await auditService.drain();
  await browserPool.closeAll();
  await fixture.close();
  await new Promise((resolve) => backend.close(resolve));
  closeDb();
});

describe('herramientas publicadas', () => {
  it('expone la capa 2 y nada de la capa 3', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name).sort();
    expect(names).toEqual(
      [
        'create_audit',
        'create_finding',
        'create_findings',
        'create_site',
        'create_site_finding',
        'get_audit',
        'get_checks',
        'get_evidence',
        'get_evidence_image',
        'get_page_review',
        'get_sign_off_preview',
        'get_site',
        'list_audits',
        'list_sites',
        'update_finding',
        'update_findings',
      ].sort(),
    );
    // Validar, rechazar o corregir es de una persona: no puede haber herramienta para eso.
    expect(names.some((name) => /review_finding|validate|reject|amend|delete|false_positive/.test(name))).toBe(false);
    // Firmar tampoco: solo se puede ver que falta.
    expect(names.some((name) => /sign/.test(name) && name !== 'get_sign_off_preview')).toBe(false);
  });
});

describe('flujo de la capa 2 a traves del MCP', () => {
  it('lanza la auditoria con evidencia y espera a que termine', async () => {
    const created = await callJson<{ id: string; evidence: boolean }>('create_audit', { urls: [fixture.url('/mcp')] });
    expect(created.evidence).toBe(true);
    auditId = created.id;

    const deadline = Date.now() + 90_000;
    let audit = await callJson<{ status: string; pages: Array<{ id: string }> }>('get_audit', { auditId });
    while (audit.status !== 'completed' && audit.status !== 'failed' && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      audit = await callJson('get_audit', { auditId });
    }
    expect(audit.status).toBe('completed');
    pageId = audit.pages[0]?.id ?? '';
    expect(pageId).toBeTruthy();
  });

  it('get_page_review filtra por resultado y compacta los hallazgos', async () => {
    const review = await callJson<{
      checks: Array<{ checkId: string; outcome: string; findings: Array<{ id: string; by: string; review: string }> }>;
    }>('get_page_review', { auditId, pageId, outcomes: ['cantTell'] });

    expect(review.checks.length).toBeGreaterThan(0);
    expect(review.checks.every((check) => check.outcome === 'cantTell')).toBe(true);
    const contrast = review.checks.find((check) => check.checkId === 'contrast-minimum');
    expect(contrast?.findings[0]?.by).toMatch(/^tool:axe-core/);
    expect(contrast?.findings[0]?.review).toBe('proposed');
  });

  it('get_page_review filtra por nivel', async () => {
    const review = await callJson<{ checks: Array<{ level: string }> }>('get_page_review', { auditId, pageId, levels: ['AAA'] });
    expect(review.checks.length).toBeGreaterThan(0);
    expect(review.checks.every((check) => check.level === 'AAA')).toBe(true);
  });

  it('get_checks trae solo los criterios pedidos', async () => {
    const catalog = await callJson<{ checks: Array<{ id: string }> }>('get_checks', { checkIds: ['focus-order', 'reflow'] });
    expect(catalog.checks.map((check) => check.id).sort()).toEqual(['focus-order', 'reflow']);
  });

  it('get_evidence trae solo los tipos pedidos y get_evidence_image la captura', async () => {
    const evidence = await callJson<{ items: Record<string, { stops?: Array<{ screenshot: string | null }> }> }>(
      'get_evidence',
      { auditId, pageId, kinds: ['focus-sequence'] },
    );
    expect(Object.keys(evidence.items)).toEqual(['focus-sequence']);
    const shot = evidence.items['focus-sequence']?.stops?.find((stop) => stop.screenshot)?.screenshot;
    expect(shot).toMatch(/^focus-\d+\.jpg$/);

    const image = await call('get_evidence_image', { auditId, pageId, name: shot });
    expect(image.isError).toBeFalsy();
    const content = image.content[0];
    expect(content?.type).toBe('image');
    if (content?.type === 'image') {
      expect(content.mimeType).toBe('image/jpeg');
      // Cabecera JPEG (FF D8) en base64.
      expect(content.data.startsWith('/9j/')).toBe(true);
    }
  });

  it('create_finding registra como ia con el modelo configurado, y queda propuesto', async () => {
    const finding = await callJson<{ by: string; review: string; outcome: string }>('create_finding', {
      auditId,
      pageId,
      checkId: 'focus-order',
      outcome: 'passed',
      description: 'El foco recorre menú, buscador y botón en el orden visual',
      evidenceRefs: ['focus-sequence'],
    });
    expect(finding).toMatchObject({ by: 'ai:Claude', review: 'proposed', outcome: 'passed' });
  });

  it('update_finding cierra la propuesta de axe', async () => {
    const review = await callJson<{ checks: Array<{ checkId: string; findings: Array<{ id: string }> }> }>(
      'get_page_review',
      { auditId, pageId, outcomes: ['cantTell'] },
    );
    const proposalId = review.checks.find((check) => check.checkId === 'contrast-minimum')?.findings[0]?.id;

    const closed = await callJson<{ outcome: string; by: string }>('update_finding', {
      findingId: proposalId,
      outcome: 'failed',
      description: 'El texto gris sobre la zona oscura del degradado baja de 4,5:1',
      recommendation: 'Oscurecer el texto o aclarar el degradado',
    });
    expect(closed).toMatchObject({ outcome: 'failed', by: 'ai:Claude' });

    const after = await callJson<{ checks: Array<{ checkId: string; outcome: string }> }>('get_page_review', {
      auditId,
      pageId,
    });
    expect(after.checks.find((check) => check.checkId === 'contrast-minimum')?.outcome).toBe('failed');
  });
});

describe('respuestas cortas y por lotes', () => {
  it('create_findings guarda los validos aunque uno falle, y dice cual', async () => {
    const result = await callJson<{ done: Array<{ checkId: string; id: string; review: string }>; errors?: Array<{ index: number; error: string }> }>(
      'create_findings',
      {
        auditId,
        pageId,
        findings: [
          { checkId: 'page-titled', outcome: 'passed', description: 'El título describe la página' },
          { checkId: 'multiple-ways', outcome: 'passed', description: 'Es de sitio: tiene que fallar' },
          { checkId: 'language-of-page', outcome: 'passed', description: 'lang="es" y el contenido está en castellano' },
        ],
      },
    );
    expect(result.done.map((item) => item.checkId)).toEqual(['page-titled', 'language-of-page']);
    expect(result.done.every((item) => item.review === 'proposed' && item.id)).toBe(true);
    expect(result.errors).toEqual([expect.objectContaining({ index: 1, error: expect.stringContaining('se evalúa por sitio') })]);
  });

  it('update_findings cierra varios de una vez', async () => {
    const created = await callJson<{ done: Array<{ id: string }> }>('create_findings', {
      auditId,
      pageId,
      findings: [{ checkId: 'orientation', outcome: 'cantTell', description: 'Falta ver la captura en horizontal' }],
    });
    const updated = await callJson<{ done: Array<{ id: string; outcome: string }> }>('update_findings', {
      updates: created.done.map((item) => ({ findingId: item.id, outcome: 'passed', description: 'Se ve bien en las dos orientaciones' })),
    });
    expect(updated.done).toEqual([expect.objectContaining({ id: created.done[0]?.id, outcome: 'passed' })]);
  });

  it('get_page_review da en corto lo cerrado y en detalle solo lo pendiente', async () => {
    type Check = { checkId: string; outcome: string; findings: Array<Record<string, unknown>>; instructions?: unknown };
    const work = await callJson<{ open: number; checks: Check[] }>('get_page_review', { auditId, pageId });
    const titled = work.checks.find((check) => check.checkId === 'page-titled');
    // Cerrado (propuesto pero ya con resultado): sigue abierto porque la propuesta no está validada.
    expect(titled?.findings[0]).toHaveProperty('description');

    const full = await callJson<{ checks: Check[] }>('get_page_review', { auditId, pageId, detail: 'full' });
    expect(JSON.stringify(full).length).toBeGreaterThanOrEqual(JSON.stringify(work).length);
    expect(work.open).toBeGreaterThan(0);

    // Una persona valida page-titled por la API (el MCP no puede): pasa a estar cerrado.
    const titledId = titled?.findings[0]?.id as string;
    const port = (backend.address() as AddressInfo).port;
    await fetch(`http://127.0.0.1:${port}/api/findings/${titledId}/review`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'validated', by: 'Revisora' }),
    });
    const after = await callJson<{ checks: Check[] }>('get_page_review', { auditId, pageId });
    expect(after.checks.find((check) => check.checkId === 'page-titled')).toEqual({
      checkId: 'page-titled',
      criterion: '2.4.2',
      level: 'A',
      outcome: 'passed',
      axe: expect.anything(),
      findings: [{ id: titledId, outcome: 'passed', review: 'validated', by: 'ai:Claude' }],
    });

    // Lo cerrado (con resultado y sin propuestas abiertas) va sin nombre ni detalle de hallazgos.
    const closed = after.checks.filter(
      (check) => !['untested', 'cantTell'].includes(check.outcome) && check.findings.every((finding) => finding.review !== 'proposed'),
    );
    expect(closed.length).toBeGreaterThan(0);
    for (const check of closed) {
      expect(check).not.toHaveProperty('name');
      for (const finding of check.findings) expect(finding).not.toHaveProperty('description');
    }
  });

  it('get_evidence con exclude quita los elementos de esas zonas', async () => {
    type Controls = { items: { controls: { items: Array<{ selector: string }> } }; excluded?: number };
    const all = await callJson<Controls>('get_evidence', { auditId, pageId, kinds: ['controls'] });
    const without = await callJson<Controls>('get_evidence', { auditId, pageId, kinds: ['controls'], exclude: 'body' });
    expect(all.items.controls.items.length).toBeGreaterThan(0);
    expect(without.items.controls.items).toEqual([]);
    expect(without.excluded).toBe(all.items.controls.items.length);
  });
});

describe('errores', () => {
  it('los errores de la API llegan al modelo como isError con el mensaje de la API', async () => {
    const result = await call('create_finding', {
      auditId,
      pageId,
      checkId: 'multiple-ways',
      outcome: 'passed',
      description: 'x',
    });
    expect(result.isError).toBe(true);
    expect((result.content[0] as TextContent).text).toContain('se evalúa por sitio');
  });

  it('sin backend, el error dice que no esta arrancado', async () => {
    const offline = await connect('http://127.0.0.1:1/api');
    const result = (await offline.callTool({ name: 'list_audits', arguments: {} })) as ToolResult;
    expect(result.isError).toBe(true);
    expect((result.content[0] as TextContent).text).toContain('¿Está arrancado el backend?');
    await offline.close();
  });
});
