import { Request, Response, NextFunction } from 'express';
import { AppError } from '../middlewares/errorHandler';
import reportService from '../services/report/report.service';

export const getReports = async (
    _req: Request,
    res: Response,
    next: NextFunction,
) => {
    try {
        const reports = await reportService.getAllReports();
        res.json(reports);
    } catch (error) {
        next(error);
    }
};

export const downloadReport = (
    req: Request<{ type: string; directoryName: string }>,
    res: Response,
    next: NextFunction,
) => {
    try {
        const { type, directoryName } = req.params;

        if (!['json', 'pdf'].includes(type)) {
            const err = new Error('Invalid report type') as AppError;
            err.status = 400;
            throw err;
        }

        if (!directoryName) {
            const err = new Error('Directory name is required') as AppError;
            err.status = 400;
            throw err;
        }

        const { filePath, safeArchiveName } = reportService.getReportFromDirectory(directoryName, type as 'json' | 'pdf');

        res.download(filePath, safeArchiveName);
    } catch (error) {
        next(error);
    }
};
