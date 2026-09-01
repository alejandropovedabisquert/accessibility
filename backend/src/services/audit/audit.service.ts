import { randomUUID } from 'crypto';
import config from '../../config/config';
import repository from '../../db/audit.repository';
import scanService, { DEFAULT_TAGS } from '../scanner/scan.service';
import rawStore from '../storage/rawStore';
import { summarize } from './summary';
import { hostOf, normalizeUrl } from '../../utils/url';
import { AppError, badRequest, notFound, toMessage } from '../../utils/errors';
import type {
  Audit,
  AuditConfig,
  AuditWithPages,
  CreateAuditInput,
  HistoryPoint,
  ListAuditsQuery,
  PageDiff,
  PageIssue,
  Paginated,
} from '../../types/audit.types';

class AuditService {
  /** Auditorias que este proceso esta ejecutando ahora mismo. */
  private readonly running = new Map<string, Promise<void>>();

  /** Crea la auditoria, la deja encolada y devuelve sin esperar a que termine. */
  public create(input: CreateAuditInput): Audit {
    const urls = this.resolveUrls(input.urls);
    const auditConfig = this.resolveConfig(input);
    const id = randomUUID();

    repository.createAudit({
      id,
      label: input.label?.trim() || null,
      createdAt: new Date().toISOString(),
      config: auditConfig,
      urls: urls.map((url) => ({ id: randomUUID(), url, host: hostOf(url) })),
    });

    const audit = repository.findAudit(id);
    if (!audit) throw new AppError('No se pudo crear la auditoria');

    const job = this.run(id, auditConfig).finally(() => this.running.delete(id));
    this.running.set(id, job);

    return audit;
  }

  public list(query: ListAuditsQuery): Paginated<Audit> {
    return repository.list(query);
  }

  public get(id: string): AuditWithPages {
    const audit = repository.findAuditWithPages(id);
    if (!audit) throw notFound('Auditoria no encontrada');
    return audit;
  }

  public getPageDetail(auditId: string, pageId: string) {
    const page = repository.findPage(auditId, pageId);
    if (!page) throw notFound('Pagina no encontrada en esta auditoria');
    return { page, issues: repository.findIssues(pageId) };
  }

  public async getPageResults(auditId: string, pageId: string) {
    const page = repository.findPage(auditId, pageId);
    if (!page) throw notFound('Pagina no encontrada en esta auditoria');

    const results = await rawStore.readRaw(auditId, pageId);
    if (!results) throw notFound('No hay resultado guardado para esta pagina');
    return { page, results };
  }

  /** Compara una pagina con el escaneo completado anterior de la misma URL. */
  public getPageDiff(auditId: string, pageId: string): PageDiff {
    const page = repository.findPage(auditId, pageId);
    if (!page) throw notFound('Pagina no encontrada en esta auditoria');

    const audit = repository.findAudit(auditId);
    const previous = audit ? repository.findPreviousPage(page.url, audit.createdAt) : null;

    if (!previous) {
      return { previous: null, added: [], resolved: [], changed: [], unchanged: 0 };
    }

    const current = repository.findIssues(pageId);
    const before = repository.findIssues(previous.id);
    const beforeByRule = new Map(before.map((issue) => [issue.ruleId, issue]));
    const currentRules = new Set(current.map((issue) => issue.ruleId));

    const added: PageIssue[] = [];
    const changed: Array<PageIssue & { previousNodeCount: number }> = [];
    let unchanged = 0;

    for (const issue of current) {
      const old = beforeByRule.get(issue.ruleId);
      if (!old) added.push(issue);
      else if (old.nodeCount !== issue.nodeCount) changed.push({ ...issue, previousNodeCount: old.nodeCount });
      else unchanged++;
    }

    return {
      previous: { auditId: previous.auditId, pageId: previous.id, finishedAt: previous.finishedAt },
      added,
      resolved: before.filter((issue) => !currentRules.has(issue.ruleId)),
      changed,
      unchanged,
    };
  }

  public history(url: string, limit = 30): HistoryPoint[] {
    return repository.history(normalizeUrl(url), Math.min(Math.max(limit, 1), 200));
  }

  public scannedUrls() {
    return repository.scannedUrls();
  }

  public async remove(id: string): Promise<void> {
    const audit = repository.findAudit(id);
    if (!audit) throw notFound('Auditoria no encontrada');
    if (this.running.has(id)) throw new AppError('No se puede borrar una auditoria en ejecucion', 409);

    repository.deleteAudit(id);
    await rawStore.removeAudit(id);
  }

  /** Relanza una auditoria existente con exactamente la misma configuracion. */
  public rerun(id: string): Audit {
    const previous = repository.findAuditWithPages(id);
    if (!previous) throw notFound('Auditoria no encontrada');

    return this.create({
      urls: previous.pages.map((page) => page.url),
      label: previous.label ?? undefined,
      browser: previous.config.browser,
      device: previous.config.device ?? undefined,
      viewport: previous.config.viewport ?? undefined,
      waitUntil: previous.config.waitUntil,
      timeout: previous.config.timeoutMs,
      tags: previous.config.tags,
    });
  }

  public stats() {
    return { ...repository.stats(), ...scanService.getStats(), running: this.running.size };
  }

  /** Espera a que terminen las auditorias en vuelo (usado en tests y al apagar). */
  public async drain(): Promise<void> {
    await Promise.allSettled([...this.running.values()]);
  }

  // ---------------------------------------------------------------- interno

  private resolveUrls(rawUrls: string[]): string[] {
    const normalized = rawUrls.map(normalizeUrl);
    const unique = [...new Set(normalized)];

    if (unique.length === 0) throw badRequest('Hay que indicar al menos una URL');
    if (unique.length > config.maxUrlsPerAudit) {
      throw badRequest(`Maximo ${config.maxUrlsPerAudit} URLs por auditoria`);
    }
    return unique;
  }

  private resolveConfig(input: CreateAuditInput): AuditConfig {
    return {
      browser: input.browser ?? 'chromium',
      device: input.device ?? null,
      viewport: input.device ? null : input.viewport ?? null,
      waitUntil: input.waitUntil ?? 'load',
      timeoutMs: input.timeout ?? config.defaultTimeoutMs,
      tags: input.tags && input.tags.length > 0 ? input.tags : DEFAULT_TAGS,
    };
  }

  private async run(auditId: string, auditConfig: AuditConfig): Promise<void> {
    try {
      repository.markAuditRunning(auditId, new Date().toISOString());
      const pages = repository.findPages(auditId);

      // Las paginas se encolan todas a la vez; la concurrencia real la limita
      // la cola de scanService, no este bucle.
      await Promise.all(pages.map((page) => this.runPage(auditId, page.id, page.url, auditConfig)));

      repository.finalizeAudit(auditId, new Date().toISOString());
    } catch (error) {
      repository.failAudit(auditId, new Date().toISOString(), toMessage(error));
    }
  }

  private async runPage(
    auditId: string,
    pageId: string,
    url: string,
    auditConfig: AuditConfig
  ): Promise<void> {
    const startedAt = Date.now();
    repository.markPageRunning(pageId, new Date().toISOString());

    try {
      const results = await scanService.enqueue({ url, config: auditConfig });
      const { counters, score, issues } = summarize(results);

      await rawStore.saveRaw(auditId, pageId, results);
      repository.completePage({
        id: pageId,
        finishedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt,
        score,
        counters,
        issues,
      });
    } catch (error) {
      // Una URL caida no debe tumbar el resto de la auditoria.
      repository.failPage({
        id: pageId,
        finishedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt,
        error: toMessage(error),
      });
    }
  }
}

export default new AuditService();
