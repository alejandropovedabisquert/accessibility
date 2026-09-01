import { z } from 'zod';
import { devices } from 'playwright';
import config from '../config/config';
import { AVAILABLE_TAGS } from '../services/scanner/scan.service';

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

export const createAuditSchema = z
  .object({
    urls: z.array(urlSchema).min(1, 'Hay que indicar al menos una URL').max(config.maxUrlsPerAudit),
    label: z.string().trim().max(120).optional(),
    browser: z.enum(['chromium', 'firefox', 'webkit']).optional(),
    device: z
      .string()
      .refine((value) => value in devices, 'Dispositivo de Playwright no reconocido')
      .optional(),
    viewport: z
      .object({
        width: z.number().int().min(240).max(4096),
        height: z.number().int().min(240).max(4096),
      })
      .optional(),
    waitUntil: z.enum(['load', 'domcontentloaded', 'networkidle']).optional(),
    timeout: z.number().int().min(1000).max(180_000).optional(),
    tags: z.array(z.enum(TAG_IDS as [string, ...string[]])).min(1).optional(),
  })
  .strict()
  .refine((body) => !(body.device && body.viewport), {
    message: 'No se pueden combinar device y viewport: elige uno',
    path: ['viewport'],
  });

export const listAuditsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['queued', 'running', 'completed', 'failed']).optional(),
  search: z.string().trim().min(1).max(200).optional(),
});

export const historySchema = z.object({
  url: urlSchema,
  limit: z.coerce.number().int().min(1).max(200).default(30),
});

export type CreateAuditBody = z.infer<typeof createAuditSchema>;
