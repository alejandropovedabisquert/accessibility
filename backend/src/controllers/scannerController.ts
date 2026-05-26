import { Request, Response, NextFunction } from 'express';
import type { AppError } from '../middlewares/errorHandler';
import ScannService from '../services/scanner/scanService';
import ReportStorageService from '../services/storage/reportStorageService';

interface ScanBody {
    url?: string;
    device?: string;
    browser?: string;
}

export const scanner = async (
    req: Request<{}, {}, ScanBody>,
    res: Response,
    next: NextFunction,
) => {
    const scannService = new ScannService();
    const reportStorageService = new ReportStorageService();
    try {
        const inputUrl = req.body?.url;
        const deviceName = req.body?.device;
        const browserName = req.body?.browser || 'chromium';

        if (!inputUrl) {
            const err = new Error('url is required in request body') as AppError;
            err.status = 400;
            throw err;
        }

        let parsedUrl = parseUrl(inputUrl);

        if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
            const err = new Error('only http and https protocols are allowed') as AppError;
            err.status = 400;
            throw err;
        }

        const scanResult = await scannService.runScan(parsedUrl.toString(), browserName, deviceName);

        const result = {
            scannedUrl: removeHttpProtocol(parsedUrl.toString()),
            timestamp: dateTimeStamp(),
            emulatedDevice: deviceName || 'none',
            usedBrowser: browserName,
            summary: {
                violations: scanResult.violations.length,
                passes: scanResult.passes.length,
                incomplete: scanResult.incomplete.length,
                inapplicable: scanResult.inapplicable.length,
            },
            scanResult,
        };

        await reportStorageService.saveReport(result);

        res.status(200).json(result);
    } catch (error) {
        next(error);
    }
};

function removeHttpProtocol(url: string): string {
    return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

function dateTimeStamp() {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hour = String(date.getHours()).padStart(2, '0');
    const minute = String(date.getMinutes()).padStart(2, '0');
    const second = String(date.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day}-${hour}-${minute}-${second}`;
}

function parseUrl(url: string): URL {
    try {
        return new URL(url);
    } catch {
        const err = new Error('url is not valid') as AppError;
        err.status = 400;
        throw err;
    }
}