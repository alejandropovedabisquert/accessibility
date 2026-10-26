import repository from '../../db/audit.repository';
import { conflict, notFound } from '../../utils/errors';
import type { Audit, AuditPage } from '../../types/audit.types';

// Las mismas precondiciones en todos los servicios, para que los 404 y 409 digan lo mismo.

export function requireAudit(auditId: string): Audit {
  const audit = repository.findAudit(auditId);
  if (!audit) throw notFound('Auditoria no encontrada');
  return audit;
}

export function requirePage(auditId: string, pageId: string): AuditPage {
  const page = repository.findPage(auditId, pageId);
  if (!page) throw notFound('Pagina no encontrada en esta auditoria');
  return page;
}

/** Revisión y líneas base solo tienen sentido sobre un escaneo terminado. */
export function requireCompletedPage(auditId: string, pageId: string): AuditPage {
  const page = requirePage(auditId, pageId);
  if (page.status !== 'completed') {
    throw conflict('La página no tiene resultados que revisar: el escaneo no ha terminado o falló');
  }
  return page;
}
