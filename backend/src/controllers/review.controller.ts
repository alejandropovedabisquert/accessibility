import type { Request, Response } from 'express';
import reviewService from '../services/review/review.service';
import {
  createFindingSchema,
  createSiteSchema,
  pageReviewQuerySchema,
  reviewFindingSchema,
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

export const createPageFinding = asyncHandler(async (req: Request<PageParams>, res: Response) => {
  const body = createFindingSchema.parse(req.body);
  const finding = reviewService.createPageFinding(req.params.id, req.params.pageId, body);
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
