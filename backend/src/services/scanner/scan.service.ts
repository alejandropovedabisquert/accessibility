import { AxeBuilder } from '@axe-core/playwright';
import { devices } from 'playwright';
import config from '../../config/config';
import browserPool from './browserPool';
import { AsyncTaskQueue } from '../shared/AsyncTaskQueue';
import { toMessage } from '../../utils/errors';
import type { AuditConfig, AxeResults, ScanBrowser } from '../../types/audit.types';

export interface ScanJob {
  url: string;
  config: AuditConfig;
}

export const DEFAULT_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
export const AVAILABLE_TAGS = [
  { id: 'wcag2a', label: 'WCAG 2.0 A' },
  { id: 'wcag2aa', label: 'WCAG 2.0 AA' },
  { id: 'wcag2aaa', label: 'WCAG 2.0 AAA' },
  { id: 'wcag21a', label: 'WCAG 2.1 A' },
  { id: 'wcag21aa', label: 'WCAG 2.1 AA' },
  { id: 'wcag22aa', label: 'WCAG 2.2 AA' },
  { id: 'best-practice', label: 'Buenas practicas' },
];

const DEFAULT_VIEWPORT = { width: 1366, height: 768 };

class ScanService {
  private readonly queue = new AsyncTaskQueue<ScanJob, AxeResults>(
    (job) => this.runScan(job),
    config.scanConcurrency,
    'scan'
  );

  public enqueue(job: ScanJob): Promise<AxeResults> {
    return this.queue.enqueue(job);
  }

  public getStats() {
    return { queue: this.queue.getStats(), browsers: browserPool.getStats() };
  }

  private async runScan(job: ScanJob): Promise<AxeResults> {
    const browserName = job.config.browser;
    const browser = await browserPool.acquire(browserName);

    try {
      const context = await browser.newContext(this.contextOptions(job.config));
      context.setDefaultTimeout(job.config.timeoutMs);

      try {
        const page = await context.newPage();
        await page.goto(job.url, {
          timeout: job.config.timeoutMs,
          waitUntil: job.config.waitUntil,
        });

        return await new AxeBuilder({ page }).withTags(job.config.tags).analyze();
      } finally {
        await context.close().catch(() => undefined);
      }
    } catch (error) {
      throw new Error(this.describeFailure(browserName, toMessage(error)));
    } finally {
      browserPool.release(browserName);
    }
  }

  private contextOptions(auditConfig: AuditConfig) {
    if (auditConfig.device) {
      const preset = devices[auditConfig.device];
      if (preset) return { ...preset };
    }
    return { viewport: auditConfig.viewport ?? DEFAULT_VIEWPORT };
  }

  /** Traduce los errores mas comunes de Playwright a algo legible en la UI. */
  private describeFailure(browser: ScanBrowser, message: string): string {
    if (message.includes('ERR_NAME_NOT_RESOLVED') || message.includes('NS_ERROR_UNKNOWN_HOST')) {
      return 'No se pudo resolver el dominio';
    }
    if (message.includes('ERR_CONNECTION_REFUSED')) {
      return 'Conexion rechazada por el servidor';
    }
    if (message.toLowerCase().includes('timeout')) {
      return `Tiempo de espera agotado al cargar la pagina (${browser})`;
    }
    if (message.includes('ERR_CERT') || message.includes('SSL_ERROR')) {
      return 'Certificado TLS no valido';
    }
    return message.split('\n')[0]?.trim() || 'Error desconocido durante el escaneo';
  }
}

export default new ScanService();
