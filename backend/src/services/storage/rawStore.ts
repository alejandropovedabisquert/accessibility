import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import config from '../../config/config';
import type { AxeResults } from '../../types/audit.types';

/**
 * Guarda en disco el JSON crudo de axe. No va a SQLite a proposito: el array
 * `passes` de una pagina grande puede pesar varios MB y la BD solo necesita
 * los contadores para listar y comparar.
 */
class RawStore {
  private auditDir(auditId: string): string {
    // auditId es un UUID generado por nosotros; basename corta cualquier intento
    // de traversal si alguna vez llegase desde fuera.
    return path.join(config.resultsDir, path.basename(auditId));
  }

  public rawPath(auditId: string, pageId: string): string {
    return path.join(this.auditDir(auditId), `${path.basename(pageId)}.json`);
  }

  public pdfPath(auditId: string, pageId: string): string {
    return path.join(this.auditDir(auditId), `${path.basename(pageId)}.pdf`);
  }

  public async saveRaw(auditId: string, pageId: string, results: AxeResults): Promise<void> {
    const target = this.rawPath(auditId, pageId);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, JSON.stringify(results), 'utf-8');
  }

  public async readRaw(auditId: string, pageId: string): Promise<AxeResults | null> {
    try {
      const content = await fs.readFile(this.rawPath(auditId, pageId), 'utf-8');
      return JSON.parse(content) as AxeResults;
    } catch {
      return null;
    }
  }

  public exists(filePath: string): boolean {
    return fsSync.existsSync(filePath);
  }

  public async removeAudit(auditId: string): Promise<void> {
    await fs.rm(this.auditDir(auditId), { recursive: true, force: true });
  }
}

export default new RawStore();
