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

        this.buildDirectoryReportName(report.timestamp);
        fs.mkdirSync("urls", { recursive: true });
        const urlDirectory = path.join("urls", removeHttpProtocol(report.results[0].url));
        if (!fs.existsSync(urlDirectory)) {
            fs.mkdirSync(urlDirectory, { recursive: true });
        }
        const html = reportHtmlBuilder(report.results[0]);
        const pdfFile = await this.savePdfReport(
            html, 
            urlDirectory, 
            report.timestamp, 
            removeHttpProtocol(report.results[0].url)
        );

        return pdfFile;
    }

    private buildArchiveReportName(timestamp: string, ext: 'pdf' | 'json'): string {
        return `accessibility-scan-result-${timestamp}.${ext}`;
    }

    private buildDirectoryReportName(timestamp: string) {
        const directoryName = `run-${timestamp}`;
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
        await page.pdf({ path: filePath, format: 'A4', printBackground: true });
        await browser.close();
        return fileName;
    }

    private async saveJsonReport(report: ScanWorkflowResult, directory: string, timestamp: string) {
        const fileName = this.buildArchiveReportName(timestamp, 'json');
        const filePath = path.join(directory, fileName);
        fs.writeFileSync(filePath, JSON.stringify(report, null, 2), 'utf-8');
        return fileName;
    }
}

export default new StorageService();