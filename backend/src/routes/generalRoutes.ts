import { Router } from 'express';
import { scanner } from '../controllers/scannerController';
import { getDevices } from '../controllers/devicesController';
import { getBrowsers } from '../controllers/borwserController';
import { downloadReport, getReports } from '../controllers/reportController';

const router = Router();

router.post('/scan', scanner);
router.get('/devices', getDevices);
router.get('/browsers', getBrowsers);
router.get('/reports', getReports);
router.get('/reports/:type/:directoryName', downloadReport);

export default router;