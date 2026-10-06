import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import config from '../../config/config';
import type { AxeResults, PageEvidence } from '../../types/audit.types';

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

  private evidenceDir(auditId: string, pageId: string): string {
    return path.join(this.auditDir(auditId), 'evidence', path.basename(pageId));
  }

  /**
   * Evidencia de la revision manual: un `evidence.json` y las capturas al lado.
   * Se borra con el resto de la auditoria en `removeAudit`.
   */
  public async saveEvidence(
    auditId: string,
    pageId: string,
    evidence: PageEvidence,
    files: Array<{ name: string; data: Buffer }>,
  ): Promise<void> {
    const dir = this.evidenceDir(auditId, pageId);
    await fs.mkdir(dir, { recursive: true });
    await Promise.all(files.map((file) => fs.writeFile(path.join(dir, path.basename(file.name)), file.data)));
    await fs.writeFile(path.join(dir, 'evidence.json'), JSON.stringify(evidence), 'utf-8');
  }

  public async readEvidence(auditId: string, pageId: string): Promise<PageEvidence | null> {
    try {
      const content = await fs.readFile(path.join(this.evidenceDir(auditId, pageId), 'evidence.json'), 'utf-8');
      return JSON.parse(content) as PageEvidence;
    } catch {
      return null;
    }
  }

  public async readEvidenceText(auditId: string, pageId: string, name: string): Promise<string | null> {
    try {
      return await fs.readFile(this.evidenceFilePath(auditId, pageId, name), 'utf-8');
    } catch {
      return null;
    }
  }

  /** Ruta de una captura; el nombre ya viene validado por el esquema, basename por si acaso. */
  public evidenceFilePath(auditId: string, pageId: string, name: string): string {
    return path.join(this.evidenceDir(auditId, pageId), path.basename(name));
  }

  /** Las firmas no son de una auditoria: van aparte y no se borran con `removeAudit`. */
  private signOffDir(): string {
    return path.join(config.resultsDir, 'sign-offs');
  }

  public async saveSignOffSnapshot(id: string, snapshot: unknown): Promise<void> {
    await fs.mkdir(this.signOffDir(), { recursive: true });
    await fs.writeFile(path.join(this.signOffDir(), `${path.basename(id)}.json`), JSON.stringify(snapshot), 'utf-8');
  }

  public async readSignOffSnapshot<T>(id: string): Promise<T | null> {
    try {
      return JSON.parse(await fs.readFile(path.join(this.signOffDir(), `${path.basename(id)}.json`), 'utf-8')) as T;
    } catch {
      return null;
    }
  }

  public signOffPdfPath(id: string): string {
    return path.join(this.signOffDir(), `${path.basename(id)}.pdf`);
  }

  public exists(filePath: string): boolean {
    return fsSync.existsSync(filePath);
  }

  public async removeAudit(auditId: string): Promise<void> {
    await fs.rm(this.auditDir(auditId), { recursive: true, force: true });
  }

  /** La copia congelada y el PDF, si llego a generarse. */
  public async removeSignOff(id: string): Promise<void> {
    await Promise.all([
      fs.rm(path.join(this.signOffDir(), `${path.basename(id)}.json`), { force: true }),
      fs.rm(this.signOffPdfPath(id), { force: true }),
    ]);
  }
}

export default new RawStore();
