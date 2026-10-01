import { z } from 'zod';
import type { CollectedEvidenceKind } from '../types/audit.types';
import { DEFAULT_MAX_NODES, MAX_NODES_LIMIT } from '../services/export/compact';
import { MAX_SITE_HOSTS } from '../services/review/review.service';

const TEXT_LIMIT = 4000;
const NAME_LIMIT = 120;

const nameSchema = z.string().trim().min(1, 'No puede estar vacío').max(NAME_LIMIT);

export const createSiteSchema = z
  .object({
    name: nameSchema,
    hosts: z
      .array(z.string().trim().min(1, 'El host no puede estar vacío').max(253))
      .min(1, 'Indica al menos un host')
      .max(MAX_SITE_HOSTS, `Máximo ${MAX_SITE_HOSTS} hosts por sitio`),
  })
  .strict();

const outcomeSchema = z.enum(['passed', 'failed', 'cantTell', 'inapplicable']);

const targetSchema = z
  .object({
    selector: z.string().trim().min(1).max(1000),
    // Se recorta al guardar; aqui solo se evita que manden la pagina entera.
    html: z.string().max(5000).default(''),
  })
  .strict();

/** `tool` no se acepta: solo lo pone el sistema en las propuestas de axe. */
const assertorSchema = z
  .object({
    type: z.enum(['ai', 'human']),
    name: nameSchema,
    model: z.string().trim().min(1).max(NAME_LIMIT).nullable().default(null),
    assistiveTech: z.string().trim().min(1).max(NAME_LIMIT).nullable().default(null),
  })
  .strict();

const findingFields = {
  outcome: outcomeSchema,
  targets: z.array(targetSchema).max(MAX_NODES_LIMIT),
  targetCount: z.number().int().min(0),
  description: z.string().trim().min(1, 'Describe el hallazgo').max(TEXT_LIMIT),
  recommendation: z.string().trim().min(1).max(TEXT_LIMIT).nullable(),
  evidenceRefs: z.array(z.string().trim().min(1).max(500)).max(50),
};

const targetCountCoversTargets = (body: { targets?: unknown[]; targetCount?: number }) =>
  body.targetCount === undefined || body.targets === undefined || body.targetCount >= body.targets.length;

const targetCountMessage = { message: 'targetCount no puede ser menor que el número de targets', path: ['targetCount'] };

export const createFindingSchema = z
  .object({
    checkId: z.string().trim().min(1),
    outcome: findingFields.outcome,
    targets: findingFields.targets.default([]),
    targetCount: findingFields.targetCount.optional(),
    description: findingFields.description,
    recommendation: findingFields.recommendation.default(null),
    evidenceRefs: findingFields.evidenceRefs.default([]),
    assertedBy: assertorSchema,
  })
  .strict()
  .refine(targetCountCoversTargets, targetCountMessage);

/** Quien cambia un hallazgo pasa a ser su autor: `assertedBy` es obligatorio. */
export const updateFindingSchema = z
  .object({
    outcome: findingFields.outcome.optional(),
    targets: findingFields.targets.optional(),
    targetCount: findingFields.targetCount.optional(),
    description: findingFields.description.optional(),
    recommendation: findingFields.recommendation.optional(),
    evidenceRefs: findingFields.evidenceRefs.optional(),
    assertedBy: assertorSchema,
  })
  .strict()
  .refine(targetCountCoversTargets, targetCountMessage);

export const reviewFindingSchema = z
  .object({
    status: z.enum(['validated', 'rejected', 'amended']),
    by: nameSchema,
    note: z.string().trim().min(1).max(TEXT_LIMIT).nullable().default(null),
    outcome: outcomeSchema.optional(),
    description: findingFields.description.optional(),
  })
  .strict();

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
] as const satisfies readonly CollectedEvidenceKind[];

/** `kinds=focus-sequence,images`: solo esos tipos. Sin `kinds`, todos. */
export const evidenceQuerySchema = z.object({
  kinds: z
    .string()
    .trim()
    .min(1)
    .transform((value) => value.split(',').map((kind) => kind.trim()))
    .pipe(z.array(z.enum(EVIDENCE_KINDS, { message: `Tipos válidos: ${EVIDENCE_KINDS.join(', ')}` })))
    .optional(),
});

/** Solo los nombres que genera el recolector: nada de rutas. */
export const evidenceFileSchema = z.string().regex(/^[a-z0-9-]+\.jpg$/, 'Nombre de captura no válido');

/** La justificacion es obligatoria: un falso positivo sin motivo no se puede auditar. */
export const falsePositiveSchema = z
  .object({
    checkId: z.string().trim().min(1),
    ruleId: z.string().trim().min(1),
    by: nameSchema,
    note: z.string().trim().min(1, 'Explica por qué es un falso positivo').max(TEXT_LIMIT),
  })
  .strict();

export const pageReviewQuerySchema = z.object({
  maxTargets: z.coerce.number().int().min(1).max(MAX_NODES_LIMIT).default(DEFAULT_MAX_NODES),
});
