import fs from 'fs/promises';
import path from 'path';
import browserPool from '../scanner/browserPool';
import rawStore from '../storage/rawStore';
import repository from '../../db/audit.repository';
import { AsyncTaskQueue } from '../shared/AsyncTaskQueue';
import { auditReportHtml, reportName, type AuditReportPage } from './auditReport';
import { footerTemplate } from './reportBase';
import { pageInfo } from '../export/export.service';
import { slugifyUrl } from '../../utils/url';
import { conflict, notFound } from '../../utils/errors';
import type { AuditWithPages } from '../../types/audit.types';

export interface PdfResult {
  filePath: string;
  fileName: string;
}

/** Pinta un HTML autocontenido en un PDF A4 con el navegador del pool. Con `footer`, numera las hojas. */
export const htmlToPdf = async (html: string, filePath: string, options: { footer?: string } = {}): Promise<void> => {
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
        margin: { top: '12mm', bottom: options.footer ? '16mm' : '12mm', left: '10mm', right: '10mm' },
        ...(options.footer
          ? { displayHeaderFooter: true, headerTemplate: '<span></span>', footerTemplate: footerTemplate(options.footer) }
          : {}),
      });
    } finally {
      await context.close().catch(() => undefined);
    }
  } finally {
    browserPool.release('chromium');
  }
};

/**
 * Un PDF por auditoria, generado la primera vez que alguien lo pide y cacheado
 * en disco. Se puede cachear sin invalidar porque una auditoria terminada no
 * cambia: volver a lanzarla crea otra.
 *
 * Antes habia uno por URL, y antes aun se generaba en cada escaneo arrancando
 * un Chromium por informe: casi ninguno se descargaba.
 */
class PdfService {
  private readonly queue = new AsyncTaskQueue<string, PdfResult>((auditId) => this.render(auditId), 1, 'pdf');

  public async getOrCreate(auditId: string): Promise<PdfResult> {
    const audit = this.finishedAudit(auditId);
    const filePath = rawStore.auditPdfPath(auditId);
    if (rawStore.exists(filePath)) return { filePath, fileName: this.fileName(audit) };
    return this.queue.enqueue(auditId);
  }

  private finishedAudit(auditId: string): AuditWithPages {
    const audit = repository.findAuditWithPages(auditId);
    if (!audit) throw notFound('Auditoria no encontrada');
    if (audit.status === 'queued' || audit.status === 'running') {
      throw conflict('La auditoria sigue en curso: el informe se puede descargar cuando termine');
    }
    if (audit.completedPages === 0) throw notFound('Esta auditoria no tiene ninguna pagina escaneada');
    return audit;
  }

  private fileName(audit: AuditWithPages): string {
    return `informe-accesibilidad-${slugifyUrl(reportName(audit, audit.pages))}-${(audit.finishedAt ?? audit.createdAt).slice(0, 10)}.pdf`;
  }

  private async render(auditId: string): Promise<PdfResult> {
    const audit = this.finishedAudit(auditId);
    const filePath = rawStore.auditPdfPath(auditId);

    // Otra peticion en cola pudo generarlo mientras esperabamos turno.
    if (!rawStore.exists(filePath)) {
      const pages: AuditReportPage[] = [];
      for (const page of audit.pages) {
        const results = page.status === 'completed' ? await rawStore.readRaw(auditId, page.id) : null;
        pages.push({ page, info: pageInfo(page, audit, results?.timestamp ?? page.finishedAt), results });
      }
      const html = auditReportHtml({ audit, pages }, new Date().toISOString());
      await htmlToPdf(html, filePath, { footer: `Informe automático de accesibilidad · ${reportName(audit, audit.pages)}` });
    }

    return { filePath, fileName: this.fileName(audit) };
  }
}

export default new PdfService();
