import fs from 'fs';
import path from 'path/win32';
import { chromium } from 'playwright';
import { reportHtmlBuilder } from './reportHtmlBuilder';

class ReportStorageService {
    private filePath: string;
    constructor() {
        this.filePath = 'scan-results';
    }
    private buildArhiveReportName(timestamp: string, ext: 'json' | 'pdf') {
        return `accessibility-scan-result-${timestamp}.${ext}`;
    }
    private buildDirectoryReportName(name:string, timestamp: string) {
        const directoryName = `${timestamp}_${name}`;
        const directory = path.join(this.filePath, directoryName);
        if (!fs.existsSync(directory)) {
            fs.mkdirSync(directory, { recursive: true });
        }
        return directory;
    }

    async saveReport(reportData: any) {
        // Ensure the base directory exists
        if (!fs.lstatSync(this.filePath).isDirectory()) {
            fs.mkdirSync(this.filePath);
        }
        this.buildDirectoryReportName(reportData.scannedUrl, reportData.timestamp);
        const html = reportHtmlBuilder(reportData);
        const jsonFileName = this.saveJsonReport(reportData);
        const pdfFileName = await this.savePdfReport(html, reportData.scannedUrl, reportData.timestamp);
        return { jsonFileName, pdfFileName };
    }

    saveJsonReport(reportData: any) {
        const fileName = this.buildArhiveReportName(reportData.timestamp, 'json');
        const filePath = path.join(this.buildDirectoryReportName(reportData.scannedUrl, reportData.timestamp), fileName);
        fs.writeFileSync(filePath, JSON.stringify(reportData, null, 2));
        return fileName;
    }

    async savePdfReport(html: string, name: string, timestamp: string) {
        const fileName = this.buildArhiveReportName(timestamp, 'pdf');
        const filePath = path.join(this.buildDirectoryReportName(name, timestamp), fileName);
        const browser = await chromium.launch();
        const context = await browser.newContext();
        const page = await context.newPage();
        await page.setContent(html);
        await page.pdf({ path: filePath, format: 'A4' });
        await browser.close();
        return fileName;
    }
}

export default ReportStorageService;