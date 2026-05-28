import { Request, Response, NextFunction } from "express";
import scanWorkflowService from "../services/scanner/scanWorkflow.service";

interface ScanBody {
    urls?: string[];
    device?: string;
    browser?: string;
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
        });

        res.status(200).json(result);
    } catch (error) {
        next(error);
    }
};