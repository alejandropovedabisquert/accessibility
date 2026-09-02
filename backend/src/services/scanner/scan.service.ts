import { AxeBuilder } from '@axe-core/playwright';
import { devices, type Page } from 'playwright';
import config from '../../config/config';
import browserPool from './browserPool';
import { AsyncTaskQueue } from '../shared/AsyncTaskQueue';
import { toMessage } from '../../utils/errors';
import type { AuditConfig, AxeResults, ScanBrowser, ScanScope } from '../../types/audit.types';

export interface ScanJob {
  url: string;
  scope: ScanScope;
  config: AuditConfig;
}

/** Selector de seccion invalido o que no casa con nada. Su mensaje ya es para el usuario. */
class ScopeError extends Error {}

/**
 * Lo minimo del DOM que se usa dentro de `page.evaluate`.
 *
 * El tsconfig del backend no carga la lib "dom" a proposito (es codigo de Node
 * y tener `document` global seria un pie de banco), pero el callback de
 * `evaluate` si corre en el navegador.
 */
type BrowserGlobal = { document: { querySelectorAll(selector: string): { length: number } } };

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

/**
 * Atajos para las secciones habituales. El valor es CSS puro: se guarda el
 * selector resuelto, no el id del preset, para que el resultado siga siendo
 * verificable a mano contra el JSON crudo aunque esta lista cambie.
 */
export const SECTION_PRESETS = [
  { id: 'header', label: 'Cabecera', selector: 'header' },
  { id: 'main', label: 'Contenido principal', selector: 'main' },
  { id: 'footer', label: 'Pie', selector: 'footer' },
  { id: 'form', label: 'Formularios', selector: 'form' },
];

/** Longitud maxima de un selector, compartida con el esquema de validacion. */
export const MAX_SELECTOR_LENGTH = 200;

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

        const builder = new AxeBuilder({ page }).withTags(job.config.tags);

        if (job.scope.include) {
          await this.assertSelector(page, job.scope.include, true);
          builder.include(job.scope.include);
        }
        if (job.scope.exclude) {
          await this.assertSelector(page, job.scope.exclude, false);
          builder.exclude(job.scope.exclude);
        }

        return await builder.analyze();
      } finally {
        await context.close().catch(() => undefined);
      }
    } catch (error) {
      // El mensaje de un ScopeError ya esta escrito para la UI.
      if (error instanceof ScopeError) throw error;
      throw new Error(this.describeFailure(browserName, toMessage(error)));
    } finally {
      browserPool.release(browserName);
    }
  }

  /**
   * axe resuelve el contexto con `document.querySelectorAll`, asi que se
   * comprueba igual antes de lanzarlo: un selector con sintaxis mala revienta
   * dentro de axe con un mensaje ilegible, y uno que no casa con nada aborta el
   * escaneo entero con "No elements found for include in Context".
   */
  private async assertSelector(page: Page, selector: string, mustMatch: boolean): Promise<void> {
    const count = await page.evaluate((value) => {
      try {
        return (globalThis as unknown as BrowserGlobal).document.querySelectorAll(value).length;
      } catch {
        return -1;
      }
    }, selector);

    if (count === -1) {
      throw new ScopeError(`"${selector}" no es un selector CSS valido`);
    }
    if (mustMatch && count === 0) {
      throw new ScopeError(`El selector "${selector}" no encontro ningun elemento en la pagina`);
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
    // Pasa cuando el selector de exclusion se come todo lo que incluia el de seccion.
    if (message.includes('No elements found for include in Context')) {
      return 'La seccion quedo vacia: el selector de exclusion abarca todo lo incluido';
    }
    return message.split('\n')[0]?.trim() || 'Error desconocido durante el escaneo';
  }
}

export default new ScanService();
