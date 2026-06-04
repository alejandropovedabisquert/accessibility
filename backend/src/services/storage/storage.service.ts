import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';
import { reportHtmlBuilder } from './reportHtmlBuilder';
import { AsyncTaskQueue } from '../shared/AsyncTaskQueue';
import { ScanWorkflowResult } from '../../types/scanWorkflow.type';
import { removeHttpProtocol } from '../../utils/url';
import { formatDate } from '../../utils/date';

type SaveReportJob = {
    report: ScanWorkflowResult;
    runDirectory: string;
};

class StorageService {
    private filePath: string;
    private readonly storageQueue: AsyncTaskQueue<SaveReportJob, string | undefined>;

    constructor() {
        this.filePath = "scan-results";
        this.storageQueue = new AsyncTaskQueue<SaveReportJob, string | undefined>(
            ({ report, runDirectory }) => this.runSaveReport(report, runDirectory),
            1,
            "storage"
        );
    }

    public enqueueReport(report: ScanWorkflowResult, runDirectory: string): Promise<string | undefined> {
        return this.storageQueue.enqueue({ report, runDirectory });
    }
    public prepareRunDirectory(timestamp: string): string {
        if (!fs.existsSync(this.filePath)) {
            fs.mkdirSync(this.filePath);
            fs.mkdirSync(this.filePath, { recursive: true });
        }
        return this.buildDirectoryReportName(timestamp);
    }

    private async runSaveReport(report: ScanWorkflowResult, runDirectory: string): Promise<string | undefined> {
        fs.mkdirSync(path.join(runDirectory, "urls"), { recursive: true });
        const urlDirectory = path.join(runDirectory, "urls", removeHttpProtocol(report.results[0].url));
        if (!fs.existsSync(urlDirectory)) {
            fs.mkdirSync(urlDirectory);
        }

        const html = reportHtmlBuilder(report.results[0]);
        const pdfFile = await this.savePdfReport(
            html,
            urlDirectory,
        );
        const jsonFile = await this.saveJsonReport(
            report,
            urlDirectory,
        );

        const metadataFile = await this.saveJsonMetadata(
            report,
            urlDirectory,
        );

        return `Report saved: ${pdfFile}, ${jsonFile}, ${metadataFile}`;
    }

    private buildDirectoryReportName(timestamp: string) {
        const formatedTimestamp = formatDate(new Date(timestamp), true);
        const directoryName = `run-${formatedTimestamp}`;
        const directory = path.join(this.filePath, directoryName);
        if (!fs.existsSync(directory)) {
            fs.mkdirSync(directory, { recursive: true });
        }
        return directory;
    }

    private async savePdfReport(html: string, directory: string) {
        const fileName = "report.pdf";
        const filePath = path.join(directory, fileName);
        const browser = await chromium.launch();
        const context = await browser.newContext();
        const page = await context.newPage();
        await page.setContent(html);
        await page.pdf({ path: filePath, format: 'A4', printBackground: true });
        await browser.close();
        return fileName;
    }

    private async saveJsonReport(report: ScanWorkflowResult, directory: string) {
        const fileName = "report.json";
        const filePath = path.join(directory, fileName);
        const reportData = {
            results: {
                passes: report.results[0].passes,
                violations: report.results[0].violations,
                incomplete: report.results[0].incomplete,
                inapplicable: report.results[0].inapplicable,
            },
        };
        fs.writeFileSync(filePath, JSON.stringify(reportData, null, 2), 'utf-8');
        return fileName;
    }

    public async saveJsonSummary(report: ScanWorkflowResult, directory: string) {
        const fileName = "summary.json";
        const filePath = path.join(directory, fileName);
        const totalUrls = report.results.length + report.failures.length;
        const summary = {
            timestamp: report.timestamp,
            status: report.failures.length > 0 ? "failure" : "success",
            totalUrls,
            scannedOk: report.results.length,
            failed: report.failures.length,
            failures: report.failures,
        };
        fs.writeFileSync(filePath, JSON.stringify(summary, null, 2), 'utf-8');
        return fileName;
    }

    public async saveJsonMetadata(report: ScanWorkflowResult, directory: string) {
        const fileName = "metadata.json";
        const filePath = path.join(directory, fileName);
        const metadata = {
            reportUrl: report.results[0].url,
            timestamp: report.results[0].timestamp,
            environment: report.results[0].testEnvironment,
        };
        fs.writeFileSync(filePath, JSON.stringify(metadata, null, 2), 'utf-8');
        return fileName;
    }
}

export default new StorageService();