import type { Request, Response } from 'express';
import reviewService from '../services/review/review.service';
import signOffService from '../services/review/signoff.service';
import baselineService from '../services/review/baseline.service';
import { slugifyUrl } from '../utils/url';
import {
  createFindingSchema,
  baselineSchema,
  bulkValidateSchema,
  createSiteSchema,
  evidenceFileSchema,
  evidenceQuerySchema,
  falsePositiveSchema,
  pageReviewQuerySchema,
  reviewFindingSchema,
  signOffPreviewQuerySchema,
  signOffSchema,
  updateFindingSchema,
} from '../schemas/review.schema';
import { asyncHandler } from '../middlewares/asyncHandler';

type IdParams = { id: string };
type PageParams = { id: string; pageId: string };

export const getChecks = asyncHandler(async (_req: Request, res: Response) => {
  res.json(reviewService.getCatalog());
});

export const listSites = asyncHandler(async (_req: Request, res: Response) => {
  res.json(reviewService.listSites());
});

export const createSite = asyncHandler(async (req: Request, res: Response) => {
  const site = reviewService.createSite(createSiteSchema.parse(req.body));
  res.status(201).location(`/api/sites/${site.id}`).json(site);
});

export const getSite = asyncHandler(async (req: Request<IdParams>, res: Response) => {
  res.json(reviewService.getSite(req.params.id));
});

export const deleteSite = asyncHandler(async (req: Request<IdParams>, res: Response) => {
  reviewService.deleteSite(req.params.id);
  res.status(204).end();
});

export const createSiteFinding = asyncHandler(async (req: Request<IdParams>, res: Response) => {
  const finding = reviewService.createSiteFinding(req.params.id, createFindingSchema.parse(req.body));
  res.status(201).location(`/api/findings/${finding.id}`).json(finding);
});

export const getPageReview = asyncHandler(async (req: Request<PageParams>, res: Response) => {
  const { maxTargets } = pageReviewQuerySchema.parse(req.query);
  res.json(await reviewService.getPageReview(req.params.id, req.params.pageId, maxTargets));
});

export const getPageEvidence = asyncHandler(async (req: Request<PageParams>, res: Response) => {
  const { kinds } = evidenceQuerySchema.parse(req.query);
  res.json(await reviewService.getPageEvidence(req.params.id, req.params.pageId, kinds));
});

export const getEvidenceFile = asyncHandler(
  async (req: Request<PageParams & { name: string }>, res: Response) => {
    const name = evidenceFileSchema.parse(req.params.name);
    res.type('image/jpeg').sendFile(reviewService.evidenceFile(req.params.id, req.params.pageId, name));
  },
);

export const createPageFinding = asyncHandler(async (req: Request<PageParams>, res: Response) => {
  const body = createFindingSchema.parse(req.body);
  const finding = reviewService.createPageFinding(req.params.id, req.params.pageId, body);
  res.status(201).location(`/api/findings/${finding.id}`).json(finding);
});

export const createFalsePositive = asyncHandler(async (req: Request<PageParams>, res: Response) => {
  const body = falsePositiveSchema.parse(req.body);
  const finding = await reviewService.createFalsePositive(req.params.id, req.params.pageId, body);
  res.status(201).location(`/api/findings/${finding.id}`).json(finding);
});

export const getFinding = asyncHandler(async (req: Request<IdParams>, res: Response) => {
  res.json(reviewService.getFinding(req.params.id));
});

export const updateFinding = asyncHandler(async (req: Request<IdParams>, res: Response) => {
  res.json(reviewService.updateFinding(req.params.id, updateFindingSchema.parse(req.body)));
});

export const reviewFinding = asyncHandler(async (req: Request<IdParams>, res: Response) => {
  res.json(reviewService.reviewFinding(req.params.id, reviewFindingSchema.parse(req.body)));
});

export const getSignOffPreview = asyncHandler(async (req: Request<IdParams>, res: Response) => {
  const { pageIds } = signOffPreviewQuerySchema.parse(req.query);
  res.json(await signOffService.preview(req.params.id, pageIds));
});

export const createSignOff = asyncHandler(async (req: Request<IdParams>, res: Response) => {
  const signOff = await signOffService.sign(req.params.id, signOffSchema.parse(req.body));
  res.status(201).location(`/api/sign-offs/${signOff.id}`).json(signOff);
});

export const listSignOffs = asyncHandler(async (req: Request<IdParams>, res: Response) => {
  res.json(signOffService.listForSite(req.params.id));
});

export const getSignOff = asyncHandler(async (req: Request<IdParams>, res: Response) => {
  res.json(await signOffService.get(req.params.id));
});

export const getSignOffEarl = asyncHandler(async (req: Request<IdParams>, res: Response) => {
  const { signOff, siteName, earl } = await signOffService.earl(req.params.id);
  if (req.query.download === '1') {
    res.setHeader('Content-Disposition', `attachment; filename="earl-${slugifyUrl(siteName)}-${signOff.signedAt.slice(0, 10)}.jsonld"`);
  }
  res.type('application/ld+json').send(JSON.stringify(earl, null, 2));
});

export const getSignOffPdf = asyncHandler(async (req: Request<IdParams>, res: Response) => {
  const { filePath, fileName } = await signOffService.pdf(req.params.id);
  res.download(filePath, fileName);
});

export const getBaseline = asyncHandler(async (req: Request<PageParams>, res: Response) => {
  res.json(baselineService.get(req.params.id, req.params.pageId));
});

export const getBaselineCandidates = asyncHandler(async (req: Request<PageParams>, res: Response) => {
  res.json(baselineService.candidates(req.params.id, req.params.pageId));
});

export const linkBaseline = asyncHandler(async (req: Request<PageParams>, res: Response) => {
  res.json(await baselineService.link(req.params.id, req.params.pageId, baselineSchema.parse(req.body)));
});

export const unlinkBaseline = asyncHandler(async (req: Request<PageParams>, res: Response) => {
  await baselineService.unlink(req.params.id, req.params.pageId);
  res.status(204).end();
});

export const validateApplicability = asyncHandler(async (req: Request<PageParams>, res: Response) => {
  const validated = reviewService.validateApplicability(req.params.id, req.params.pageId, bulkValidateSchema.parse(req.body));
  res.json({ validated: validated.length, findings: validated });
});
