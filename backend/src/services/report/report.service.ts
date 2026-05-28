import fs from 'fs';
import path from 'path';
import { AppError } from '../../middlewares/errorHandler';
interface ReportItem {
    name: string;
    // type: 'json' | 'pdf';
    items?: ReportItem[];
}
class ReportService {
    private filePath: string;

    constructor() {
        this.filePath = 'scan-results';
    }

    public getAllReports() {
        const directory = path.join(this.filePath);
        const reports: ReportItem[] = [];
        const directoryFiles = fs.readdirSync(directory);
        directoryFiles.forEach((directories) => {
            const subDirectory = path.join(directory, directories);
            if (fs.statSync(subDirectory).isDirectory()) {
                const files = fs.readdirSync(subDirectory);
                reports.push({
                    name: directories,
                    items: files.map((file) => ({
                        name: file,
                    })),
                });
            }
        });
        return reports;
    }

    public getReportFromDirectory(directoryName: string, type: 'json' | 'pdf') {
        const safeName = path.basename(directoryName);
        const safeArchiveName = fs.readdirSync(path.join('scan-results', safeName)).find((file) => file.endsWith(`.${type}`));

        if (!safeArchiveName) {
            const err = new Error('Directory not found') as AppError;
            err.status = 404;
            throw err;
        }

        const filePath = path.join('scan-results', safeName, safeArchiveName);

        if (!fs.existsSync(filePath)) {
            const err = new Error('Report not found') as AppError;
            err.status = 404;
            throw err;
        }

        return { filePath, safeArchiveName };

    }
}

export default new ReportService();