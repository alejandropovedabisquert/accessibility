import repository from '../../db/audit.repository';
import rawStore from '../storage/rawStore';
import { resolveViewport } from '../scanner/scan.service';
import { notFound } from '../../utils/errors';
import { buildPageExport, type CompactPageExport, type CompactPageInfo } from './compact';
import { buildAuditExport, type AggregatedExport, type ExportDetail } from './aggregate';
import type { Audit, AuditPage, AxeResults } from '../../types/audit.types';

const pageInfo = (page: AuditPage, audit: Audit, scannedAt: string | null): CompactPageInfo => ({
  url: page.url,
  include: page.include,
  exclude: page.exclude,
  // Las paginas antiguas sin pantalla guardada usan la unica de su auditoria.
  viewport: page.viewport ?? resolveViewport(audit.config),
  scannedAt: scannedAt ?? '',
});

class ExportService {
  public async pageCompact(auditId: string, pageId: string, maxNodes: number): Promise<CompactPageExport> {
    const page = repository.findPage(auditId, pageId);
    if (!page) throw notFound('Pagina no encontrada en esta auditoria');
    const audit = repository.findAudit(auditId);
    if (!audit) throw notFound('Auditoria no encontrada');

    const results = await rawStore.readRaw(auditId, pageId);
    if (!results) throw notFound('No hay resultado guardado para esta pagina');

    return buildPageExport({ results, tags: audit.config.tags, maxNodes, page: pageInfo(page, audit, results.timestamp) });
  }

  /**
   * Todas las paginas de la auditoria en un solo informe, agrupando el mismo
   * fallo del mismo componente entre URLs. Se lee el JSON crudo de cada
   * pagina: es la unica fuente con los nodos.
   */
  public async auditCompact(auditId: string, maxNodes: number, detail: ExportDetail): Promise<AggregatedExport> {
    const audit = repository.findAuditWithPages(auditId);
    if (!audit) throw notFound('Auditoria no encontrada');

    const scanned: Array<{ info: CompactPageInfo; results: AxeResults }> = [];
    const failedPages: AggregatedExport['failedPages'] = [];

    for (const page of audit.pages) {
      const results = page.status === 'completed' ? await rawStore.readRaw(auditId, page.id) : null;
      if (results) {
        scanned.push({ info: pageInfo(page, audit, results.timestamp), results });
      } else if (page.status === 'failed' || page.status === 'completed') {
        failedPages.push({
          ...pageInfo(page, audit, page.finishedAt),
          error: page.error ?? 'No se conserva el resultado de esta pagina',
        });
      }
    }

    return buildAuditExport({
      audit: { id: audit.id, label: audit.label, createdAt: audit.createdAt, status: audit.status },
      tags: audit.config.tags,
      pages: scanned,
      failedPages,
      maxNodes,
      detail,
    });
  }
}

export default new ExportService();
