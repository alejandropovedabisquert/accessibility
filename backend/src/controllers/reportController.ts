import { Request, Response, NextFunction } from 'express';
import ReportService from '../services/report/reportservice';
import { AppError } from '../middlewares/errorHandler';

export const getReports = async (
    _req: Request,
    res: Response,
    next: NextFunction,
) => {
    try {
        const reportStorageService = new ReportService();
        const reports = await reportStorageService.getAllReports();
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

        const reportStorageService = new ReportService();

        const { filePath, safeArchiveName } = reportStorageService.getReportFromDirectory(directoryName, type as 'json' | 'pdf');

        res.download(filePath, safeArchiveName);
    } catch (error) {
        next(error);
    }
};
