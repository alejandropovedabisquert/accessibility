import { Router } from 'express';
import { scanner } from '../controllers/scanner.controller';
import { getDevices } from '../controllers/devices.controller';
import { getBrowsers } from '../controllers/browser.controller';
import { downloadReport, getReports } from '../controllers/report.controller';
import { validateScanBody } from '../middlewares/validateScanBody';

const router = Router();

router.post('/scan', validateScanBody, scanner);
router.get('/devices', getDevices);
router.get('/browsers', getBrowsers);
router.get('/reports', getReports);
router.get('/reports/:type/:directoryName', downloadReport);

export default router;