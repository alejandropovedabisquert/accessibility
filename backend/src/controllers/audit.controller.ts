import type { Request, Response } from 'express';
import auditService from '../services/audit/audit.service';
import pdfService from '../services/report/pdf.service';
import exportService from '../services/export/export.service';
import {
  auditExportQuerySchema,
  createAuditSchema,
  historySchema,
  listAuditsSchema,
  resultsQuerySchema,
} from '../schemas/audit.schema';
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

/** El compacto se manda sin espacios a proposito: su razon de ser es pesar poco. */
const sendCompactJson = (res: Response, body: unknown, fileName: string | null) => {
  if (fileName) res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.type('application/json').send(JSON.stringify(body));
};

export const exportAudit = asyncHandler(async (req: Request<{ id: string }>, res: Response) => {
  const { maxNodes, detail } = auditExportQuerySchema.parse(req.query);
  const exported = await exportService.auditCompact(req.params.id, maxNodes, detail);
  const fileName =
    req.query.download === '1'
      ? `accesibilidad-ia-auditoria-${exported.audit.id.slice(0, 8)}${detail === 'legal' ? '-legal' : ''}.json`
      : null;
  sendCompactJson(res, exported, fileName);
});

type PageParams = { id: string; pageId: string };

export const getPage = asyncHandler(async (req: Request<PageParams>, res: Response) => {
  res.json(auditService.getPageDetail(req.params.id, req.params.pageId));
});

export const getPageResults = asyncHandler(async (req: Request<PageParams>, res: Response) => {
  const { format, maxNodes } = resultsQuerySchema.parse(req.query);

  if (format === 'compact') {
    const compact = await exportService.pageCompact(req.params.id, req.params.pageId, maxNodes);
    const fileName =
      req.query.download === '1' ? `accesibilidad-ia-${slugifyUrl(compact.page.url)}.json` : null;
    sendCompactJson(res, compact, fileName);
    return;
  }

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
  const { url, include, viewport, device, limit } = historySchema.parse(req.query);
  const scope = include ?? null;
  const screen = viewport || device ? { viewport: viewport ?? null, device: device ?? null } : undefined;
  res.json({
    url,
    include: scope,
    ...(screen ?? {}),
    points: auditService.history(url, scope, screen, limit),
  });
});

export const getScannedUrls = asyncHandler(async (_req: Request, res: Response) => {
  res.json(auditService.scannedUrls());
});
