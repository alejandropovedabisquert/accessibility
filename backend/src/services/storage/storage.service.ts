import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';
import { reportHtmlBuilder } from './reportHtmlBuilder';
import { AsyncTaskQueue } from '../shared/AsyncTaskQueue';
import { ScanWorkflowResult } from '../../types/scanWorkflow.type';
import { removeHttpProtocol } from '../../utils/url';

type SaveReportJob = {
    report: ScanWorkflowResult;
};

class StorageService {
    private filePath: string;
    private readonly storageQueue: AsyncTaskQueue<SaveReportJob, string | undefined>;

    constructor() {
        this.filePath = "scan-results";
        this.storageQueue = new AsyncTaskQueue<SaveReportJob, string | undefined>(
            ({ report }) => this.runSaveReport(report),
            1,
            "storage"
        );
    }

    public enqueueReport(report: ScanWorkflowResult): Promise<string | undefined> {
        return this.storageQueue.enqueue({ report });
    }

    private async runSaveReport(report: ScanWorkflowResult): Promise<string | undefined> {
        if (!fs.existsSync(this.filePath)) {
            fs.mkdirSync(this.filePath);
        }

        const directory = this.buildDirectoryReportName(report.url, report.timestamp);
        const html = reportHtmlBuilder(report.results[0]);
        const pdfFile = await this.savePdfReport(
            html, 
            directory, 
            report.timestamp, 
            removeHttpProtocol(report.results[0].url)
        );

        return pdfFile;
    }

    private buildArchiveReportName(timestamp: string, ext: 'pdf') {
        return `accessibility-scan-result-${timestamp}.${ext}`;
    }

    private buildDirectoryReportName(name: string, timestamp: string) {
        const directoryName = `${timestamp}_${name}`;
        const directory = path.join(this.filePath, directoryName);
        if (!fs.existsSync(directory)) {
            fs.mkdirSync(directory, { recursive: true });
        }
        return directory;
    }

    private async savePdfReport(html: string, directory: string, timestamp: string, web: string) {
        const fileName = this.buildArchiveReportName(`${timestamp}_${web}`, 'pdf');
        const filePath = path.join(directory, fileName);
        const browser = await chromium.launch();
        const context = await browser.newContext();
        const page = await context.newPage();
        await page.setContent(html);
        await page.pdf({ path: filePath, format: 'A4' });
        await browser.close();
        return fileName;
    }
}

export default new StorageService();