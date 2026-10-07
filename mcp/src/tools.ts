import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { ApiError, type ApiClient } from './api.js';

/**
 * Herramientas de la capa 2 (revision asistida por IA).
 *
 * Deliberadamente NO hay ninguna para validar, rechazar o corregir hallazgos
 * (`PATCH /findings/:id/review`): eso es la capa 3, una persona. Si el modelo
 * pudiera validar sus propios hallazgos, la separacion de capas no serviria de
 * nada. Tampoco se exponen los borrados ni la firma: de esta solo se puede ver
 * la vista previa (que falta para poder firmar).
 */

export interface AssertorDefaults {
  name: string;
  model: string | null;
}

const EVIDENCE_KINDS = [
  'screenshot',
  'orientation',
  'focus-sequence',
  'reflow-320',
  'zoom-200',
  'text-spacing',
  'images',
  'media',
  'forms',
  'controls',
  'headings',
  'landmarks',
  'text-content',
] as const;

const OUTCOMES = ['passed', 'failed', 'cantTell', 'inapplicable', 'untested'] as const;
const FINDING_OUTCOMES = ['passed', 'failed', 'cantTell', 'inapplicable'] as const;
const LEVELS = ['A', 'AA', 'AAA'] as const;

// Lo justo de las respuestas de la API que aqui se reorganiza. El resto pasa tal cual.
interface ApiFinding {
  id: string;
  source: unknown;
  outcome: string;
  targets: unknown[];
  targetCount: number;
  description: string;
  recommendation: string | null;
  evidenceRefs: string[];
  assertedBy: { type: string; name: string };
  review: { status: string; note: string | null };
  inheritedFrom: unknown;
}

interface ApiCheckReview {
  checkId: string;
  criterion: string;
  name: string;
  level: (typeof LEVELS)[number];
  outcome: (typeof OUTCOMES)[number];
  axe: unknown;
  pendingReview: number;
  findings: ApiFinding[];
}

interface ApiPageReview {
  page: { id: string; auditId: string; url: string; include: string | null; exclude: string | null; viewport: unknown; device: string | null };
  site: { id: string; name: string } | null;
  catalog: unknown;
  evidence: unknown;
  summary: unknown;
  checks: ApiCheckReview[];
}

interface ApiAuditPage {
  id: string;
  url: string;
  include: string | null;
  exclude: string | null;
  viewport: unknown;
  device: string | null;
  status: string;
  score: number | null;
  error: string | null;
}

interface ApiAudit {
  id: string;
  label: string | null;
  status: string;
  createdAt: string;
  config: { evidence?: boolean; device: string | null; viewports: unknown; tags: string[] };
  totalPages: number;
  completedPages: number;
  failedPages: number;
  score: number | null;
  pages?: ApiAuditPage[];
}

type ToolResult = {
  content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }>;
  isError?: boolean;
};

/** JSON sin espacios: lo lee un modelo, y cada espacio son tokens. */
const json = (value: unknown): ToolResult => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });

const run = async (fn: () => Promise<ToolResult>): Promise<ToolResult> => {
  try {
    return await fn();
  } catch (error) {
    const message = error instanceof ApiError || error instanceof Error ? error.message : String(error);
    return { content: [{ type: 'text', text: message }], isError: true };
  }
};

const compactFinding = (finding: ApiFinding) => ({
  id: finding.id,
  source: finding.source,
  outcome: finding.outcome,
  description: finding.description,
  ...(finding.recommendation ? { recommendation: finding.recommendation } : {}),
  targets: finding.targets,
  targetCount: finding.targetCount,
  ...(finding.evidenceRefs.length > 0 ? { evidenceRefs: finding.evidenceRefs } : {}),
  by: `${finding.assertedBy.type}:${finding.assertedBy.name}`,
  review: finding.review.status,
  ...(finding.review.note ? { reviewNote: finding.review.note } : {}),
  // Heredado de una linea base: ya viene decidido y validado por una persona.
  ...(finding.inheritedFrom ? { inherited: true } : {}),
});

/**
 * Lo minimo de un hallazgo que no hay que trabajar (ya decidido, heredado) o
 * de uno recien escrito: quien lo lee ya sabe lo que mando, y cada respuesta se
 * queda en su contexto para el resto de la sesion.
 */
const findingRef = (finding: ApiFinding) => ({
  id: finding.id,
  outcome: finding.outcome,
  review: finding.review.status,
  by: `${finding.assertedBy.type}:${finding.assertedBy.name}`,
  ...(finding.inheritedFrom ? { inherited: true } : {}),
});

const PENDING_OUTCOMES = new Set<string>(['untested', 'cantTell']);

/** Un criterio por trabajar: sin resultado, sin decidir o con propuestas sin cerrar. */
const isOpen = (check: ApiCheckReview) =>
  PENDING_OUTCOMES.has(check.outcome) || check.findings.some((finding) => finding.review.status === 'proposed');

/**
 * Por defecto, el detalle solo de lo que hay que trabajar; de lo cerrado, el
 * resultado y de donde sale. Lo heredado o ya revisado por una persona va en
 * corto incluso dentro de un criterio abierto: no hay que tocarlo.
 */
const compactCheck = (check: ApiCheckReview, full: boolean) => {
  const { findings, ...rest } = check;
  if (full) return { ...rest, findings: findings.map(compactFinding) };
  const work = (finding: ApiFinding) => finding.review.status === 'proposed';
  if (!isOpen(check)) {
    return { checkId: check.checkId, criterion: check.criterion, level: check.level, outcome: check.outcome, axe: check.axe, findings: findings.map(findingRef) };
  }
  return { ...rest, findings: findings.map((finding) => (work(finding) ? compactFinding(finding) : findingRef(finding))) };
};

const compactPage = (page: ApiAuditPage) => ({
  id: page.id,
  url: page.url,
  ...(page.include ? { include: page.include } : {}),
  ...(page.exclude ? { exclude: page.exclude } : {}),
  viewport: page.viewport,
  ...(page.device ? { device: page.device } : {}),
  status: page.status,
  score: page.score,
  ...(page.error ? { error: page.error } : {}),
});

const compactAudit = (audit: ApiAudit) => ({
  id: audit.id,
  label: audit.label,
  status: audit.status,
  createdAt: audit.createdAt,
  evidence: audit.config.evidence ?? false,
  pages: `${audit.completedPages}/${audit.totalPages}${audit.failedPages > 0 ? ` (${audit.failedPages} fallidas)` : ''}`,
  score: audit.score,
});

const targetSchema = z.object({
  selector: z.string().min(1).describe('Selector CSS del elemento'),
  html: z.string().optional().describe('Fragmento de HTML para reconocerlo; se recorta al guardar'),
});

/** Lo que describe un hallazgo. `model` va aparte: en los lotes es uno para todos. */
const findingFields = {
  outcome: z.enum(FINDING_OUTCOMES).describe('Resultado EARL. cantTell solo si de verdad no se puede decidir con la evidencia'),
  description: z.string().min(1).describe('Qué se ha comprobado y qué se ha visto, en castellano'),
  recommendation: z.string().min(1).optional().describe('Cómo corregirlo, si es un fallo'),
  targets: z.array(targetSchema).max(50).optional().describe('Elementos afectados (unos pocos de ejemplo)'),
  targetCount: z.number().int().min(0).optional().describe('Total de elementos afectados, si son más que los de targets'),
  evidenceRefs: z
    .array(z.string().min(1))
    .max(50)
    .optional()
    .describe('Evidencia en la que se apoya: capturas (focus-3.jpg) o apartados (focus-sequence#3)'),
};

const findingContent = {
  ...findingFields,
  model: z.string().min(1).optional().describe('Modelo que hace la evaluación, si no es el configurado en el servidor'),
};

/** Lo que cabe en una llamada por lotes: de sobra para los criterios de una pagina. */
const MAX_BATCH = 60;

/**
 * Uno detras de otro y sin parar en el primer error: un hallazgo mal formado no
 * debe tirar los demas. La API no tiene escritura por lotes; lo que se ahorra es
 * el ida y vuelta con el modelo, que es lo caro.
 */
const inBatch = async <T, R>(items: T[], write: (item: T) => Promise<R>) => {
  const done: R[] = [];
  const errors: Array<{ index: number; error: string }> = [];
  for (const [index, item] of items.entries()) {
    try {
      done.push(await write(item));
    } catch (error) {
      errors.push({ index, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { done, ...(errors.length > 0 ? { errors } : {}) };
};

export const createServer = (api: ApiClient, assertor: AssertorDefaults): McpServer => {
  const server = new McpServer({ name: 'accessibility', version: '1.0.0' });
  const author = (model?: string) => ({ type: 'ai' as const, name: assertor.name, model: model ?? assertor.model });

  server.registerTool(
    'list_audits',
    {
      description: 'Lista las auditorías de accesibilidad, de la más reciente a la más antigua.',
      inputSchema: z.object({
        search: z.string().min(1).optional().describe('Texto a buscar en la etiqueta o las URLs'),
        status: z.enum(['queued', 'running', 'completed', 'failed']).optional(),
        page: z.number().int().min(1).optional(),
      }),
    },
    ({ search, status, page }) =>
      run(async () => {
        const result = await api.get<{ items: ApiAudit[]; page: number; totalPages: number; total: number }>(
          '/audits',
          { search, status, page, pageSize: 20 },
        );
        return json({ ...result, items: result.items.map(compactAudit) });
      }),
  );

  server.registerTool(
    'get_audit',
    {
      description:
        'Una auditoría con sus páginas (una por URL, sección y pantalla). Los pageId de aquí son los que piden el resto de herramientas.',
      inputSchema: z.object({ auditId: z.string().min(1) }),
    },
    ({ auditId }) =>
      run(async () => {
        const audit = await api.get<ApiAudit>(`/audits/${encodeURIComponent(auditId)}`);
        return json({ ...compactAudit(audit), config: audit.config, pages: (audit.pages ?? []).map(compactPage) });
      }),
  );

  server.registerTool(
    'create_audit',
    {
      description:
        'Lanza una auditoría (capa 1: axe) y, por defecto, recoge la evidencia para la revisión manual. Corre en segundo plano: consulta get_audit hasta que esté completed.',
      inputSchema: z.object({
        urls: z
          .array(
            z.union([
              z.string().url(),
              z.object({
                url: z.string().url(),
                include: z.string().min(1).optional().describe('Selector CSS de la sección a analizar'),
                exclude: z.string().min(1).optional().describe('Selector CSS a excluir (banners de cookies...)'),
              }),
            ]),
          )
          .min(1),
        label: z.string().min(1).optional(),
        evidence: z.boolean().default(true).describe('Recoger evidencia para la revisión manual'),
        viewports: z.array(z.object({ width: z.number().int(), height: z.number().int() })).optional(),
        device: z.string().min(1).optional().describe('Dispositivo de Playwright, p. ej. "iPhone 13"'),
        tags: z.array(z.string().min(1)).optional().describe('Tags de axe; por defecto todos (A, AA, AAA y buenas prácticas)'),
      }),
    },
    (input) =>
      run(async () => {
        const audit = await api.post<ApiAudit>('/audits', input);
        return json(compactAudit(audit));
      }),
  );

  server.registerTool(
    'list_sites',
    {
      description: 'Lista los sitios (webs). Una página es del sitio cuyo host coincide con el suyo.',
      inputSchema: z.object({}),
    },
    () => run(async () => json(await api.get('/sites'))),
  );

  server.registerTool(
    'get_site',
    {
      description:
        'Un sitio con sus páginas escaneadas y sus hallazgos de sitio (criterios que comparan páginas: 2.4.5, 3.2.3, 3.2.4, 3.2.6).',
      inputSchema: z.object({ siteId: z.string().min(1) }),
    },
    ({ siteId }) =>
      run(async () => {
        const site = await api.get<{ pages: ApiAuditPage[]; findings: ApiFinding[] } & Record<string, unknown>>(
          `/sites/${encodeURIComponent(siteId)}`,
        );
        return json({ ...site, pages: site.pages.map(compactPage), findings: site.findings.map(compactFinding) });
      }),
  );

  server.registerTool(
    'create_site',
    {
      description: 'Crea un sitio a partir de sus hosts. Acepta el host solo o una URL entera.',
      inputSchema: z.object({ name: z.string().min(1), hosts: z.array(z.string().min(1)).min(1) }),
    },
    (input) => run(async () => json(await api.post('/sites', input))),
  );

  server.registerTool(
    'get_sign_off_preview',
    {
      description:
        'Qué falta para que una persona pueda firmar la web con esta muestra de páginas: criterios sin revisar o sin decidir y hallazgos sin validar, y la conformidad que saldría. No firma.',
      inputSchema: z.object({ siteId: z.string().min(1), pageIds: z.array(z.string().min(1)).min(1).max(50) }),
    },
    ({ siteId, pageIds }) =>
      run(async () => {
        const preview = await api.get<{
          canSign: boolean;
          blockers: unknown[];
          snapshot: {
            conformance: unknown;
            wcag22: unknown;
            aaa?: unknown;
            pages: unknown[];
            criteria: Array<{ checkId: string; criterion: string; level: string; outcome: string }>;
          };
        }>(`/sites/${encodeURIComponent(siteId)}/sign-off-preview`, { pageIds: pageIds.join(',') });
        // Sin los hallazgos de cada criterio: para eso esta get_page_review.
        return json({
          canSign: preview.canSign,
          blockers: preview.blockers,
          conformance: preview.snapshot.conformance,
          wcag22: preview.snapshot.wcag22,
          aaa: preview.snapshot.aaa,
          pages: preview.snapshot.pages,
          criteria: preview.snapshot.criteria.map(({ checkId, criterion, level, outcome }) => ({ checkId, criterion, level, outcome })),
        });
      }),
  );

  server.registerTool(
    'get_checks',
    {
      description:
        'Catálogo de criterios (WCAG 2.2 A, AA y AAA): qué comprobar en cada uno, qué evidencia hace falta y qué reglas de axe lo tocan. Pásale checkIds para no traer los 86.',
      inputSchema: z.object({ checkIds: z.array(z.string().min(1)).optional() }),
    },
    ({ checkIds }) =>
      run(async () => {
        const catalog = await api.get<{ checks: Array<{ id: string }> } & Record<string, unknown>>('/checks');
        if (!checkIds) return json(catalog);
        const wanted = new Set(checkIds);
        return json({ ...catalog, checks: catalog.checks.filter((check) => wanted.has(check.id)) });
      }),
  );

  server.registerTool(
    'get_page_review',
    {
      description:
        'Estado de cada criterio en una página y sus hallazgos. Al abrirla se crean las propuestas automáticas (needs-review de axe y no aplicables). Por defecto trae el detalle solo de lo que hay que trabajar (sin resultado, sin decidir o con propuestas abiertas); de lo cerrado y lo heredado, solo el resultado. Usa outcomes y levels para acotar más (los AAA también bloquean la firma), y detail="full" solo si necesitas releer hallazgos ya cerrados.',
      inputSchema: z.object({
        auditId: z.string().min(1),
        pageId: z.string().min(1),
        outcomes: z.array(z.enum(OUTCOMES)).optional().describe('Solo los criterios con estos resultados'),
        levels: z.array(z.enum(LEVELS)).optional().describe('Solo los criterios de estos niveles WCAG'),
        maxTargets: z.number().int().min(1).max(50).optional().describe('Nodos de ejemplo por hallazgo (5 por defecto)'),
        detail: z.enum(['work', 'full']).optional().describe('work (por defecto): detalle solo de lo pendiente; full: todo'),
      }),
    },
    ({ auditId, pageId, outcomes, levels, maxTargets, detail }) =>
      run(async () => {
        const review = await api.get<ApiPageReview>(
          `/audits/${encodeURIComponent(auditId)}/pages/${encodeURIComponent(pageId)}/review`,
          { maxTargets },
        );
        const wanted = outcomes ? new Set<string>(outcomes) : null;
        const wantedLevels = levels ? new Set<string>(levels) : null;
        const checks = review.checks.filter(
          (check) => (!wanted || wanted.has(check.outcome)) && (!wantedLevels || wantedLevels.has(check.level)),
        );
        return json({
          page: review.page,
          site: review.site,
          catalog: review.catalog,
          evidence: review.evidence,
          summary: review.summary,
          open: checks.filter(isOpen).length,
          checks: checks.map((check) => compactCheck(check, detail === 'full')),
        });
      }),
  );

  server.registerTool(
    'get_evidence',
    {
      description:
        'Evidencia recogida en la página (secuencia de foco, reflujo, imágenes, formularios...). Pide solo los tipos que necesites: cada uno puede ser grande. Con exclude quitas los elementos de zonas ya juzgadas (p. ej. la cabecera, el pie y el banner de cookies heredados de la línea base). Las capturas que nombra se ven con get_evidence_image.',
      inputSchema: z.object({
        auditId: z.string().min(1),
        pageId: z.string().min(1),
        kinds: z.array(z.enum(EVIDENCE_KINDS)).min(1),
        exclude: z
          .string()
          .min(1)
          .optional()
          .describe('Selector CSS de las zonas a quitar, p. ej. "header, footer, .banner-cookies". No recorta texto, árbol de accesibilidad ni capturas'),
      }),
    },
    ({ auditId, pageId, kinds, exclude }) =>
      run(async () =>
        json(
          await api.get(`/audits/${encodeURIComponent(auditId)}/pages/${encodeURIComponent(pageId)}/evidence`, {
            kinds: kinds.join(','),
            exclude,
          }),
        ),
      ),
  );

  server.registerTool(
    'get_evidence_image',
    {
      description: 'Una captura de la evidencia (viewport.jpg, focus-3.jpg, reflow-320.jpg, image-0.jpg...).',
      inputSchema: z.object({
        auditId: z.string().min(1),
        pageId: z.string().min(1),
        name: z.string().regex(/^[a-z0-9-]+\.jpg$/),
      }),
    },
    ({ auditId, pageId, name }) =>
      run(async () => {
        const image = await api.getBase64(
          `/audits/${encodeURIComponent(auditId)}/pages/${encodeURIComponent(pageId)}/evidence/files/${name}`,
        );
        return { content: [{ type: 'image', data: image.data, mimeType: image.mimeType }] };
      }),
  );

  server.registerTool(
    'create_finding',
    {
      description:
        'Registra el resultado de un criterio de página (capa 2). Queda como propuesto hasta que lo valide una persona.',
      inputSchema: z.object({
        auditId: z.string().min(1),
        pageId: z.string().min(1),
        checkId: z.string().min(1).describe('Id del criterio en el catálogo (focus-order, reflow...)'),
        ...findingContent,
      }),
    },
    ({ auditId, pageId, model, ...finding }) =>
      run(async () =>
        json(
          findingRef(
            await api.post<ApiFinding>(
              `/audits/${encodeURIComponent(auditId)}/pages/${encodeURIComponent(pageId)}/findings`,
              { ...finding, assertedBy: author(model) },
            ),
          ),
        ),
      ),
  );

  server.registerTool(
    'create_findings',
    {
      description:
        'Registra varios resultados de criterios de una página de una vez (capa 2): mejor que create_finding uno a uno. Cada uno queda propuesto. Si alguno falla, los demás se guardan igual y el error dice cuál.',
      inputSchema: z.object({
        auditId: z.string().min(1),
        pageId: z.string().min(1),
        findings: z
          .array(z.object({ checkId: z.string().min(1), ...findingFields }))
          .min(1)
          .max(MAX_BATCH),
        model: findingContent.model,
      }),
    },
    ({ auditId, pageId, findings, model }) =>
      run(async () =>
        json(
          await inBatch(findings, async (finding) => ({
            checkId: finding.checkId,
            ...findingRef(
              await api.post<ApiFinding>(
                `/audits/${encodeURIComponent(auditId)}/pages/${encodeURIComponent(pageId)}/findings`,
                { ...finding, assertedBy: author(model) },
              ),
            ),
          })),
        ),
      ),
  );

  server.registerTool(
    'create_site_finding',
    {
      description:
        'Registra el resultado de un criterio de sitio (2.4.5, 3.2.3, 3.2.4, 3.2.6), comparando varias páginas. Queda como propuesto.',
      inputSchema: z.object({
        siteId: z.string().min(1),
        checkId: z.string().min(1),
        ...findingContent,
      }),
    },
    ({ siteId, model, ...finding }) =>
      run(async () =>
        json(
          findingRef(
            await api.post<ApiFinding>(`/sites/${encodeURIComponent(siteId)}/findings`, {
              ...finding,
              assertedBy: author(model),
            }),
          ),
        ),
      ),
  );

  server.registerTool(
    'update_finding',
    {
      description:
        'Cierra o corrige un hallazgo propuesto: así se resuelve una propuesta cantTell de axe tras revisarla. No sirve para hallazgos ya revisados por una persona.',
      inputSchema: z.object({
        findingId: z.string().min(1),
        ...findingContent,
        outcome: findingContent.outcome.optional(),
        description: findingContent.description.optional(),
      }),
    },
    ({ findingId, model, ...changes }) =>
      run(async () =>
        json(
          findingRef(
            await api.patch<ApiFinding>(`/findings/${encodeURIComponent(findingId)}`, {
              ...changes,
              assertedBy: author(model),
            }),
          ),
        ),
      ),
  );

  server.registerTool(
    'update_findings',
    {
      description:
        'Cierra o corrige varios hallazgos propuestos de una vez (p. ej. las propuestas cantTell de axe de una página). Si alguno falla, los demás se guardan igual y el error dice cuál.',
      inputSchema: z.object({
        updates: z
          .array(
            z.object({
              findingId: z.string().min(1),
              ...findingFields,
              outcome: findingFields.outcome.optional(),
              description: findingFields.description.optional(),
            }),
          )
          .min(1)
          .max(MAX_BATCH),
        model: findingContent.model,
      }),
    },
    ({ updates, model }) =>
      run(async () =>
        json(
          await inBatch(updates, async ({ findingId, ...changes }) =>
            findingRef(
              await api.patch<ApiFinding>(`/findings/${encodeURIComponent(findingId)}`, { ...changes, assertedBy: author(model) }),
            ),
          ),
        ),
      ),
  );

  return server;
};
