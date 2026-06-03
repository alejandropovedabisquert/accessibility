import { AxeBuilder } from "@axe-core/playwright";
import { chromium, devices, firefox, webkit } from 'playwright';
import { ScanResults } from "../../types/scanResult.type";
import { AppError } from "../../middlewares/errorHandler";
import { AsyncTaskQueue } from "../shared/AsyncTaskQueue";

type ScanJob = {
    url: string;
    browserName: string;
    deviceName?: string;
};

class ScanService {
    private readonly scanQueue: AsyncTaskQueue<ScanJob, ScanResults>;

    constructor() {
        this.scanQueue = new AsyncTaskQueue<ScanJob, ScanResults>(
            (job) => this.runScan(job.url, job.browserName, job.deviceName),
            3,
            "scan"
        );
    }

    public enqueueScan(url: string, browserName: string, deviceName?: string): Promise<ScanResults> {
        return this.scanQueue.enqueue({ url, browserName, deviceName });
    }

    /**
     * El core de ejecución de Playwright (Privado, controlado por la cola)
     */
    private async runScan(url: string, browserName: string, deviceName?: string): Promise<ScanResults> {
        const browser = await this.setBrowserOptions(browserName);

        // Evitamos romper el código si el dispositivo no existe en el objeto de Playwright
        const deviceConfig = deviceName && devices[deviceName] ? devices[deviceName] : {};

        const context = await browser.newContext({
            ...deviceConfig,
        });

        const page = await context.newPage();

        try {
            // Establecemos un timeout máximo de 30 segundos para la carga de la página
            await page.goto(url);

            const results = await new AxeBuilder({ page })
                .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
                .analyze();

            return results;
        } finally {
            // El bloque 'finally' asegura que el navegador SIEMPRE se cierre,
            // incluso si la página dio un timeout o error 500.
            await context.close();
            await browser.close();
        }
    }

    /**
     * Configura las opciones del navegador según el nombre proporcionado.
     */
    private async setBrowserOptions(browserName: string) {
        switch (browserName.toLowerCase()) {
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