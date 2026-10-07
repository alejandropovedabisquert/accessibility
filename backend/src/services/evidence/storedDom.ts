import type { Page } from 'playwright';
import browserPool from '../scanner/browserPool';
import { EVIDENCE_LIMITS, installScript } from './evidence.service';

/**
 * Abre un DOM guardado (`dom.html` de la evidencia) sin red ni scripts y con los
 * probes instalados. Se trabaja sobre lo que se escaneo, no sobre la web de
 * ahora: es lo que se reviso. Sin los scripts de la pagina, que podrian rehacer
 * el DOM al cargarlo.
 */
export const withStoredDom = async <T>(html: string, fn: (page: Page) => Promise<T>): Promise<T> => {
  const browser = await browserPool.acquire('chromium');
  try {
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await page.route('**/*', (route) => route.abort());
      await page.setContent(html.replace(/<script\b[\s\S]*?<\/script\s*>/gi, ''), { waitUntil: 'domcontentloaded' });
      await page.evaluate(
        installScript({ scope: { include: null, exclude: null }, maxItems: EVIDENCE_LIMITS.maxItems, maxTextLength: 0 }),
      );
      return await fn(page);
    } finally {
      await context.close().catch(() => undefined);
    }
  } finally {
    browserPool.release('chromium');
  }
};
