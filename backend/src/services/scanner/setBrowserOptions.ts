import { chromium, firefox, webkit } from 'playwright';
import { AppError } from '../../middlewares/errorHandler';

export async function setBrowserOptions(browserName: string) {
    switch (browserName.toLowerCase()) {
        case 'chromium':
            return await chromium.launch({ headless: true });
        case 'firefox':
            return await firefox.launch({ headless: true });
        case 'webkit':
            return await webkit.launch({ headless: true });
        default:
            const err = new Error('unsupported browser') as AppError;
            err.status = 400;
            throw err;
    }
}