import { z } from 'zod';
import { devices } from 'playwright';
import config from '../config/config';
import { AVAILABLE_TAGS, MAX_SELECTOR_LENGTH, MAX_VIEWPORTS } from '../services/scanner/scan.service';
import { DEFAULT_MAX_NODES, MAX_NODES_LIMIT } from '../services/export/compact';

const TAG_IDS = AVAILABLE_TAGS.map((tag) => tag.id);

const urlSchema = z
  .string()
  .trim()
  .min(1, 'La URL no puede estar vacia')
  .refine((value) => {
    try {
      const parsed = new URL(value);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }, 'Debe ser una URL http o https valida');

const selectorSchema = z
  .string()
  .trim()
  .min(1, 'El selector no puede estar vacio')
  .max(MAX_SELECTOR_LENGTH, `El selector no puede pasar de ${MAX_SELECTOR_LENGTH} caracteres`);

/**
 * Una entrada de `urls` es la URL sola (pagina entera) o un objeto con la
 * seccion a analizar. La forma corta se mantiene por compatibilidad.
 */
const targetSchema = z.union([
  urlSchema,
  z
    .object({
      url: urlSchema,
      include: selectorSchema.optional(),
      exclude: selectorSchema.optional(),
    })
    .strict(),
]);

const viewportSchema = z.object({
  width: z.number().int().min(240).max(4096),
  height: z.number().int().min(240).max(4096),
});

export const createAuditSchema = z
  .object({
    urls: z.array(targetSchema).min(1, 'Hay que indicar al menos una URL').max(config.maxUrlsPerAudit),
    label: z.string().trim().max(120).optional(),
    browser: z.enum(['chromium', 'firefox', 'webkit']).optional(),
    device: z
      .string()
      .refine((value) => value in devices, 'Dispositivo de Playwright no reconocido')
      .optional(),
    viewport: viewportSchema.optional(),
    // Cada URL se escanea en todas. `viewport` suelto sigue valiendo para una sola.
    viewports: z
      .array(viewportSchema)
      .min(1, 'Indica al menos una resolucion')
      .max(MAX_VIEWPORTS, `Maximo ${MAX_VIEWPORTS} resoluciones por auditoria`)
      .optional(),
    waitUntil: z.enum(['load', 'domcontentloaded', 'networkidle']).optional(),
    timeout: z.number().int().min(1000).max(180_000).optional(),
    tags: z.array(z.enum(TAG_IDS as [string, ...string[]])).min(1).optional(),
    // Capturas, secuencia de foco, reflujo... para la revision manual. Hace el escaneo mas lento.
    evidence: z.boolean().optional(),
  })
  .strict()
  .refine((body) => !(body.device && body.viewport), {
    message: 'No se pueden combinar device y viewport: elige uno',
    path: ['viewport'],
  })
  .refine((body) => !(body.device && body.viewports), {
    message: 'No se pueden combinar device y viewports: elige uno',
    path: ['viewports'],
  })
  .refine((body) => !(body.viewport && body.viewports), {
    message: 'Usa viewports para varias resoluciones o viewport para una, no los dos',
    path: ['viewports'],
  });

export const listAuditsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['queued', 'running', 'completed', 'failed']).optional(),
  search: z.string().trim().min(1).max(200).optional(),
});

export const historySchema = z.object({
  url: urlSchema,
  // La serie es por URL + seccion: sin `include` es la de la pagina entera.
  include: selectorSchema.optional(),
  // Y por pantalla. Sin `viewport` ni `device` se mezclan todas, como antes.
  viewport: z
    .string()
    .regex(/^\d+x\d+$/, 'Formato ANCHOxALTO, por ejemplo 1366x768')
    .transform((value) => {
      const [width, height] = value.split('x').map(Number);
      return { width: width ?? 0, height: height ?? 0 };
    })
    .optional(),
  device: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(30),
});

/** Sin `format` se devuelve el JSON crudo de siempre; `compact` es la exportacion para IA. */
export const resultsQuerySchema = z.object({
  format: z.enum(['compact']).optional(),
  maxNodes: z.coerce.number().int().min(1).max(MAX_NODES_LIMIT).default(DEFAULT_MAX_NODES),
});

/** La exportacion agregada solo existe en formato compacto: `format` es obligatorio para poder anadir otros. */
export const auditExportQuerySchema = resultsQuerySchema.extend({
  format: z.enum(['compact'], { message: 'Formato no soportado: usa format=compact' }),
  // `legal`: detalle completo solo de A/AA; AAA y buenas practicas, resumidas por regla.
  detail: z.enum(['full', 'legal'], { message: 'detail debe ser full o legal' }).default('full'),
});

export type CreateAuditBody = z.infer<typeof createAuditSchema>;
