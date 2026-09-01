import { Router } from 'express';
import {
  createAudit,
  deleteAudit,
  getAudit,
  getHistory,
  getPage,
  getPageDiff,
  getPagePdf,
  getPageResults,
  getScannedUrls,
  listAudits,
  rerunAudit,
} from '../controllers/audit.controller';
import { getMeta, getStats } from '../controllers/meta.controller';

const router = Router();

router.get('/meta', getMeta);
router.get('/stats', getStats);

router.get('/history', getHistory);
router.get('/history/urls', getScannedUrls);

router.post('/audits', createAudit);
router.get('/audits', listAudits);
router.get('/audits/:id', getAudit);
router.delete('/audits/:id', deleteAudit);
router.post('/audits/:id/rerun', rerunAudit);

router.get('/audits/:id/pages/:pageId', getPage);
router.get('/audits/:id/pages/:pageId/results', getPageResults);
router.get('/audits/:id/pages/:pageId/diff', getPageDiff);
router.get('/audits/:id/pages/:pageId/report.pdf', getPagePdf);

export default router;
