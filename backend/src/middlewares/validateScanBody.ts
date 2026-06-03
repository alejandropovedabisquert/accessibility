import type { NextFunction, Request, Response } from 'express';
import { chromium, devices, firefox, webkit } from 'playwright';
import type { AppError } from './errorHandler';

interface ScanBody {
    urls?: unknown;
    browser?: BrowserInfo['id'];
    device?: unknown;
    timeout?: unknown;
    waitUntil?: unknown;
    viewport?: unknown;
}
interface BrowserInfo {
    id: string;
    name: string;
}

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);
const ALLOWED_BROWSERS = new Set([
    chromium.name(),
    firefox.name(),
    webkit.name(),
]);
const ALLOWED_WAIT_UNTIL = new Set(['load', 'domcontentloaded', 'networkidle']);

const badRequest = (message: string): never => {
    const err = new Error(message) as AppError;
    err.status = 400;
    throw err;
};

export const validateScanBody = (
    req: Request<{}, {}, ScanBody>,
    _res: Response,
    next: NextFunction
) => {
    try {
        const { urls, browser, device, timeout, waitUntil, viewport } = req.body;

        if (urls === undefined) {
            badRequest('Urls is required in request body');
        }

        if (!Array.isArray(urls)) {
            badRequest('Urls must be an array');
        }

        const urlList = urls as unknown[];

        if (urlList.length === 0) {
            badRequest('Urls must not be empty');
        }

        for (const rawUrl of urlList) {
            if (typeof rawUrl !== 'string' || rawUrl.trim().length === 0) {
                badRequest('Each url must be a non-empty string');
            }

            const parsedUrlString = rawUrl as string;
            let parsedUrl: URL | null = null;
            try {
                parsedUrl = new URL(parsedUrlString);
            } catch {
                badRequest('All urls must be valid');
            }

            if (!parsedUrl || !ALLOWED_PROTOCOLS.has(parsedUrl.protocol)) {
                badRequest('Only http and https protocols are allowed');
            }
        }

        const browserValue = browser;
        if (browserValue !== undefined) {
            if (typeof browserValue !== 'string') {
                badRequest('Browser must be a string');
            }

            const normalizedBrowser = browserValue.toLowerCase();
            if (!ALLOWED_BROWSERS.has(normalizedBrowser)) {
                badRequest('Browser is not allowed');
            }
        }

        if (device !== undefined) {
            if (typeof device !== 'string' || !(device in devices)) {
                badRequest('Device is not valid');
            }
        }

        if (timeout !== undefined) {
            if (!Number.isFinite(timeout) || typeof timeout !== 'number') {
                badRequest('Timeout must be a number');
            }

            const timeoutValue = timeout as number;
            if (timeoutValue <= 0) {
                badRequest('Timeout must be greater than 0');
            }
        }

        if (waitUntil !== undefined) {
            if (typeof waitUntil !== 'string' || !ALLOWED_WAIT_UNTIL.has(waitUntil)) {
                badRequest('waitUntil must be one of: load, domcontentloaded, networkidle');
            }
        }

        if (viewport !== undefined) {
            if (typeof viewport !== 'object' || viewport === null || Array.isArray(viewport)) {
                badRequest('viewport must be an object with width and height');
            }

            const vp = viewport as { width?: unknown; height?: unknown };
            const isValidWidth = typeof vp.width === 'number' && Number.isInteger(vp.width) && vp.width > 0;
            const isValidHeight = typeof vp.height === 'number' && Number.isInteger(vp.height) && vp.height > 0;

            if (!isValidWidth || !isValidHeight) {
                badRequest('viewport width and height must be positive integers');
            }

            if (device !== undefined) {
                badRequest('viewport cannot be used together with device');
            }
        }

        next();
    } catch (error) {
        next(error);
    }
};