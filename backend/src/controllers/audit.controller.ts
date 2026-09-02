import type { Request, Response } from 'express';
import auditService from '../services/audit/audit.service';
import pdfService from '../services/report/pdf.service';
import { createAuditSchema, historySchema, listAuditsSchema } from '../schemas/audit.schema';
import { asyncHandler } from '../middlewares/asyncHandler';
import { slugifyUrl } from '../utils/url';

export const createAudit = asyncHandler(async (req: Request, res: Response) => {
  const body = createAuditSchema.parse(req.body);
  const audit = auditService.create(body);

  res.status(202).location(`/api/audits/${audit.id}`).json(audit);
});

export const listAudits = asyncHandler(async (req: Request, res: Response) => {
  res.json(auditService.list(listAuditsSchema.parse(req.query)));
});

export const getAudit = asyncHandler(async (req: Request<{ id: string }>, res: Response) => {
  res.json(auditService.get(req.params.id));
});

export const deleteAudit = asyncHandler(async (req: Request<{ id: string }>, res: Response) => {
  await auditService.remove(req.params.id);
  res.status(204).end();
});

export const rerunAudit = asyncHandler(async (req: Request<{ id: string }>, res: Response) => {
  const audit = auditService.rerun(req.params.id);
  res.status(202).location(`/api/audits/${audit.id}`).json(audit);
});

type PageParams = { id: string; pageId: string };

export const getPage = asyncHandler(async (req: Request<PageParams>, res: Response) => {
  res.json(auditService.getPageDetail(req.params.id, req.params.pageId));
});

export const getPageResults = asyncHandler(async (req: Request<PageParams>, res: Response) => {
  const { page, results } = await auditService.getPageResults(req.params.id, req.params.pageId);

  if (req.query.download === '1') {
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="informe-accesibilidad-${slugifyUrl(page.url)}.json"`
    );
  }
  res.json({ page, results });
});

export const getPageDiff = asyncHandler(async (req: Request<PageParams>, res: Response) => {
  res.json(auditService.getPageDiff(req.params.id, req.params.pageId));
});

export const getPagePdf = asyncHandler(async (req: Request<PageParams>, res: Response) => {
  const { filePath, fileName } = await pdfService.getOrCreate(req.params.id, req.params.pageId);
  res.download(filePath, fileName);
});

export const getHistory = asyncHandler(async (req: Request, res: Response) => {
  const { url, include, limit } = historySchema.parse(req.query);
  const scope = include ?? null;
  res.json({ url, include: scope, points: auditService.history(url, scope, limit) });
});

export const getScannedUrls = asyncHandler(async (_req: Request, res: Response) => {
  res.json(auditService.scannedUrls());
});
