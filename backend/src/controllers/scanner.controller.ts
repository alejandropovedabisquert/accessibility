import { Request, Response, NextFunction } from "express";
import scanWorkflowService from "../services/scanner/scanWorkflow.service";

interface ScanBody {
    urls?: string[];
    device?: string;
    browser?: 'chromium' | 'firefox' | 'webkit';
    timeout?: number;
    waitUntil?: 'load' | 'domcontentloaded' | 'networkidle';
    viewport?: {
        width: number;
        height: number;
    };
}

export const scanner = async (
    req: Request<{}, {}, ScanBody>,
    res: Response,
    next: NextFunction
) => {
    try {
        const result = await scanWorkflowService.execute({
            urls: req.body.urls || [],
            browser: req.body.browser,
            device: req.body.device,
            timeout: req.body.timeout,
            waitUntil: req.body.waitUntil,
            viewport: req.body.viewport,
        });

        res.status(200).json(result);
    } catch (error) {
        next(error);
    }
};