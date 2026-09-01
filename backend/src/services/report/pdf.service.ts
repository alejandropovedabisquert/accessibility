import fs from 'fs/promises';
import path from 'path';
import browserPool from '../scanner/browserPool';
import rawStore from '../storage/rawStore';
import repository from '../../db/audit.repository';
import { AsyncTaskQueue } from '../shared/AsyncTaskQueue';
import { reportHtmlBuilder } from './reportHtmlBuilder';
import { slugifyUrl } from '../../utils/url';
import { notFound } from '../../utils/errors';

interface PdfJob {
  auditId: string;
  pageId: string;
}

export interface PdfResult {
  filePath: string;
  fileName: string;
}

/**
 * Genera el PDF la primera vez que alguien lo pide y lo cachea en disco.
 *
 * Antes se generaba un PDF por URL en cada escaneo, arrancando un Chromium
 * dedicado por informe. La mayoria nunca se descargaba, asi que el coste era
 * puro desperdicio en la ruta critica del escaneo.
 */
class PdfService {
  private readonly queue = new AsyncTaskQueue<PdfJob, PdfResult>(
    (job) => this.render(job),
    1,
    'pdf'
  );

  public async getOrCreate(auditId: string, pageId: string): Promise<PdfResult> {
    const page = repository.findPage(auditId, pageId);
    if (!page) throw notFound('Pagina no encontrada en esta auditoria');
    if (page.status !== 'completed') throw notFound('Esta pagina no tiene un escaneo completado');

    const filePath = rawStore.pdfPath(auditId, pageId);
    if (rawStore.exists(filePath)) {
      return { filePath, fileName: this.fileName(page.url) };
    }
    return this.queue.enqueue({ auditId, pageId });
  }

  private fileName(url: string): string {
    return `informe-accesibilidad-${slugifyUrl(url)}.pdf`;
  }

  private async render({ auditId, pageId }: PdfJob): Promise<PdfResult> {
    const filePath = rawStore.pdfPath(auditId, pageId);
    const page = repository.findPage(auditId, pageId);
    if (!page) throw notFound('Pagina no encontrada en esta auditoria');

    // Otra peticion en cola pudo generarlo mientras esperabamos turno.
    if (rawStore.exists(filePath)) {
      return { filePath, fileName: this.fileName(page.url) };
    }

    const results = await rawStore.readRaw(auditId, pageId);
    if (!results) throw notFound('No hay resultado guardado para esta pagina');

    const audit = repository.findAudit(auditId);
    if (!audit) throw notFound('Auditoria no encontrada');

    const html = reportHtmlBuilder(results, {
      config: audit.config,
      score: page.score,
      label: audit.label,
    });

    await fs.mkdir(path.dirname(filePath), { recursive: true });

    const browser = await browserPool.acquire('chromium');
    try {
      const context = await browser.newContext();
      try {
        const tab = await context.newPage();
        await tab.setContent(html, { waitUntil: 'load' });
        await tab.pdf({
          path: filePath,
          format: 'A4',
          printBackground: true,
          margin: { top: '12mm', bottom: '12mm', left: '10mm', right: '10mm' },
        });
      } finally {
        await context.close().catch(() => undefined);
      }
    } finally {
      browserPool.release('chromium');
    }

    return { filePath, fileName: this.fileName(page.url) };
  }
}

export default new PdfService();
