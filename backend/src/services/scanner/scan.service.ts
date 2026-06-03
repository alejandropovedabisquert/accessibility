import { AxeBuilder } from "@axe-core/playwright";
import { chromium, devices, firefox, webkit } from 'playwright';
import { ScanResults } from "../../types/scanResult.type";
import { AppError } from "../../middlewares/errorHandler";
import { AsyncTaskQueue } from "../shared/AsyncTaskQueue";
import { ScanBrowser, ScanViewport, ScanWaitUntil } from "../../types/scanWorkflow.type";

type ScanJob = {
    url: string;
    browserName?: ScanBrowser;
    deviceName?: string;
    timeoutMs?: number;
    waitUntil?: ScanWaitUntil;
    viewport?: ScanViewport;
};

const DEFAULT_BROWSER: ScanBrowser = 'chromium';
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_WAIT_UNTIL: ScanWaitUntil = 'load';
const DEFAULT_VIEWPORT: ScanViewport = { width: 1366, height: 768 };

class ScanService {
    private readonly scanQueue: AsyncTaskQueue<ScanJob, ScanResults>;

    constructor() {
        this.scanQueue = new AsyncTaskQueue<ScanJob, ScanResults>(
            (job) => this.runScan(job),
            3,
            "scan"
        );
    }

    public enqueueScan(job: ScanJob): Promise<ScanResults> {
        return this.scanQueue.enqueue(job);
    }

    /**
     * El core de ejecución de Playwright (Privado, controlado por la cola)
     */
    private async runScan(job: ScanJob): Promise<ScanResults> {
        const browser = await this.setBrowserOptions(job.browserName);

        const contextOptions = this.buildContextOptions(job.deviceName, job.viewport);

        const context = await browser.newContext(contextOptions);

        const page = await context.newPage();

        try {
            await page.goto(job.url, {
                timeout: job.timeoutMs ?? DEFAULT_TIMEOUT_MS,
                waitUntil: job.waitUntil ?? DEFAULT_WAIT_UNTIL,
            });

            const results = await new AxeBuilder({ page })
                .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
                .analyze();

            return results;
        } catch (error) {
            const err = new Error(`Failed to scan ${job.url}: ${(error as Error).message}`) as AppError;
            err.status = 500;
            throw err;
        } finally {
            await context.close();
            await browser.close();
        }
    }

    private buildContextOptions(deviceName?: string, viewport?: ScanViewport) {
        if (deviceName && devices[deviceName]) {
            return {
                ...devices[deviceName],
            };
        }

        return {
            viewport: viewport || DEFAULT_VIEWPORT,
        };
    }

    /**
     * Configura las opciones del navegador según el nombre proporcionado.
     */
    private async setBrowserOptions(browserName?: ScanBrowser) {
        switch ((browserName || DEFAULT_BROWSER).toLowerCase()) {
            case 'chromium':
                return await chromium.launch({ headless: true });
            case 'firefox':
                return await firefox.launch({ headless: true });
            case 'webkit':
                return await webkit.launch({ headless: true });
            default:
                const err = new Error('Unsupported browser') as AppError;
                err.status = 400;
                throw err;
        }
    }
}

// Exportamos una única instancia del servicio (Singleton) para compartir la misma cola en toda la API
export default new ScanService();