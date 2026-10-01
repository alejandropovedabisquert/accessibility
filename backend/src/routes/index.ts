import { Router } from 'express';
import {
  createAudit,
  deleteAudit,
  exportAudit,
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
import {
  validateApplicability,
  getBaseline,
  getBaselineCandidates,
  linkBaseline,
  unlinkBaseline,
  createFalsePositive,
  createSignOff,
  getSignOff,
  getSignOffEarl,
  getSignOffPdf,
  getSignOffPreview,
  listSignOffs,
  createPageFinding,
  createSite,
  createSiteFinding,
  deleteSite,
  getChecks,
  getEvidenceFile,
  getPageEvidence,
  getFinding,
  getPageReview,
  getSite,
  listSites,
  reviewFinding,
  updateFinding,
} from '../controllers/review.controller';

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
router.get('/audits/:id/export', exportAudit);

router.get('/audits/:id/pages/:pageId', getPage);
router.get('/audits/:id/pages/:pageId/results', getPageResults);
router.get('/audits/:id/pages/:pageId/diff', getPageDiff);
router.get('/audits/:id/pages/:pageId/report.pdf', getPagePdf);
router.get('/audits/:id/pages/:pageId/review', getPageReview);
router.post('/audits/:id/pages/:pageId/findings', createPageFinding);
// Solo capa 3: el MCP no lo expone.
router.post('/audits/:id/pages/:pageId/false-positives', createFalsePositive);
router.post('/audits/:id/pages/:pageId/findings/validate-inapplicable', validateApplicability);
router.get('/audits/:id/pages/:pageId/evidence', getPageEvidence);
// Enlazar una linea base es de la capa 3: hereda hallazgos ya validados.
router.get('/audits/:id/pages/:pageId/baseline', getBaseline);
router.get('/audits/:id/pages/:pageId/baseline-candidates', getBaselineCandidates);
router.put('/audits/:id/pages/:pageId/baseline', linkBaseline);
router.delete('/audits/:id/pages/:pageId/baseline', unlinkBaseline);
router.get('/audits/:id/pages/:pageId/evidence/files/:name', getEvidenceFile);

router.get('/checks', getChecks);

router.get('/sites', listSites);
router.post('/sites', createSite);
router.get('/sites/:id', getSite);
router.delete('/sites/:id', deleteSite);
router.post('/sites/:id/findings', createSiteFinding);
router.get('/sites/:id/sign-off-preview', getSignOffPreview);
// Solo capa 3: el MCP puede ver la vista previa, pero no firmar.
router.post('/sites/:id/sign-offs', createSignOff);
router.get('/sites/:id/sign-offs', listSignOffs);

router.get('/sign-offs/:id', getSignOff);
router.get('/sign-offs/:id/earl', getSignOffEarl);
router.get('/sign-offs/:id/report.pdf', getSignOffPdf);

router.get('/findings/:id', getFinding);
router.patch('/findings/:id', updateFinding);
router.patch('/findings/:id/review', reviewFinding);

export default router;
